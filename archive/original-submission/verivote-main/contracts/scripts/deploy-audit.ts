import { network } from "hardhat";

const { ethers, networkName } = await network.create();

// --- 1. Verifier ---
// If VERIVOTE_TALLY_VERIFIER_ADDRESS is provided, reuse that (typically the
// real snarkjs-generated TallyVerifier.sol deployed separately). Otherwise
// deploy a MockTallyVerifier that always returns true so the local demo
// works without running `pnpm zk:setup` first.
const externalVerifier = process.env.VERIVOTE_TALLY_VERIFIER_ADDRESS;
let verifierAddress: string;

if (externalVerifier && externalVerifier !== "") {
  verifierAddress = externalVerifier;
  console.log(`Using external tally verifier at ${verifierAddress}`);
} else {
  console.log(`Deploying MockTallyVerifier (always-accept) to ${networkName}...`);
  const mockVerifier = await ethers.deployContract("MockTallyVerifier", [true]);
  await mockVerifier.waitForDeployment();
  verifierAddress = await mockVerifier.getAddress();
  console.log("MockTallyVerifier deployed to:", verifierAddress);
}

// --- 2. Audit ---
console.log(`\nDeploying VeriVoteAudit to ${networkName}...`);
const audit = await ethers.deployContract("VeriVoteAudit", [verifierAddress]);
await audit.waitForDeployment();
const contractAddress = await audit.getAddress();

console.log("VeriVoteAudit deployed to:", contractAddress);
console.log("\nUse these API env vars for Hardhat mode:");
console.log(`BLOCKCHAIN_AUDIT_MODE=hardhat`);
console.log(`AUDIT_CONTRACT_ADDRESS=${contractAddress}`);
console.log(`VERIVOTE_TALLY_VERIFIER_ADDRESS=${verifierAddress}`);
