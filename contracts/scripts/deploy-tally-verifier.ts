import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const verifierSource = join(projectRoot, "contracts", "TallyVerifier.sol");

if (!existsSync(verifierSource)) {
  throw new Error(
    "contracts/TallyVerifier.sol was not found. Run `pnpm zk:setup` first to export the real Groth16 verifier."
  );
}

const { ethers, networkName } = await network.create();

console.log(`Deploying real TallyVerifier to ${networkName}...`);
const verifier = await ethers.deployContract("TallyVerifier");
await verifier.waitForDeployment();

const verifierAddress = await verifier.getAddress();
console.log("TallyVerifier deployed to:", verifierAddress);

console.log(`\nDeploying VeriVoteAudit with real verifier to ${networkName}...`);
const audit = await ethers.deployContract("VeriVoteAudit", [verifierAddress]);
await audit.waitForDeployment();
const auditAddress = await audit.getAddress();

console.log("VeriVoteAudit deployed to:", auditAddress);
console.log("\nUse these API env vars for real Hardhat mode:");
console.log("BLOCKCHAIN_AUDIT_MODE=hardhat");
console.log(`VERIVOTE_TALLY_VERIFIER_ADDRESS=${verifierAddress}`);
console.log(`AUDIT_CONTRACT_ADDRESS=${auditAddress}`);
