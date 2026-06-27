import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const verifierSource = join(projectRoot, "contracts", "TallyVerifier.sol");
const calldataPath = join(projectRoot, "docs", "contracts", "calldata.sample.json");
const reportPath = join(projectRoot, "docs", "contracts", "aggregator_report_v2.sample.json");
const voteRecordsPath = join(projectRoot, "docs", "contracts", "valid_vote_records_8x4.sample.json");
const outputPath = join(projectRoot, "docs", "contracts", "chain_audit.real.sample.json");

if (!existsSync(verifierSource)) {
  throw new Error(
    "contracts/TallyVerifier.sol was not found. Run `pnpm zk:setup` before writing the real chain audit sample."
  );
}

if (!existsSync(calldataPath)) {
  throw new Error(
    "docs/contracts/calldata.sample.json was not found. Generate the real tally proof sample first."
  );
}

if (!existsSync(reportPath)) {
  throw new Error(
    "docs/contracts/aggregator_report_v2.sample.json was not found. Generate the report fixture first."
  );
}

if (!existsSync(voteRecordsPath)) {
  throw new Error(
    "docs/contracts/valid_vote_records_8x4.sample.json was not found. Generate the vote fixture first."
  );
}

interface CalldataSample {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  input: [string, string, string, string, string];
}

interface AggregatorReportSample {
  electionId: string;
  commitmentRoot: string;
  receiptRoot: string;
  auditHash: string;
  tallyResult: unknown;
}

interface VoteRecordsSample {
  votes: Array<{
    voteId: string;
    commitment: string;
    receiptCode: string;
  }>;
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function createAuditHash(input: unknown): string {
  const serialized = JSON.stringify(input);
  return hashText(serialized === undefined ? String(input) : serialized);
}

function toBytes32Hex(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (/^0x[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }
  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return `0x${normalized}`;
  }
  return `0x${hashText(value)}`;
}

function createMerkleLeaf(voteId: string, commitment: string, receiptCode: string): string {
  return hashText(`${voteId}${commitment}${receiptCode}`);
}

function hashMerklePair(left: string, right: string): string {
  return hashText(`${left}${right}`);
}

function getMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) {
    return hashText("");
  }
  let level = leaves.slice();
  while (level.length > 1) {
    const nextLevel: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      nextLevel.push(hashMerklePair(left, right));
    }
    level = nextLevel;
  }
  return level[0];
}

const calldata = JSON.parse(readFileSync(calldataPath, "utf8")) as CalldataSample;
const report = JSON.parse(readFileSync(reportPath, "utf8")) as AggregatorReportSample;
const voteRecords = JSON.parse(readFileSync(voteRecordsPath, "utf8")) as VoteRecordsSample;
const { ethers, networkName } = await network.create();

const verifier = await ethers.deployContract("TallyVerifier");
await verifier.waitForDeployment();
const verifierAddress = await verifier.getAddress();

const audit = await ethers.deployContract("VeriVoteAudit", [verifierAddress]);
await audit.waitForDeployment();
const auditAddress = await audit.getAddress();

const directVerifyGas = await verifier.verifyProof.estimateGas(
  calldata.a,
  calldata.b,
  calldata.c,
  calldata.input
);

const submittedFields = {
  electionId: report.electionId,
  electionIdHash: toBytes32Hex(report.electionId),
  merkleRoot: toBytes32Hex(
    getMerkleRoot(
      voteRecords.votes.map((vote) =>
        createMerkleLeaf(vote.voteId, vote.commitment, vote.receiptCode)
      )
    )
  ),
  commitmentRoot: toBytes32Hex(report.commitmentRoot),
  receiptRoot: toBytes32Hex(report.receiptRoot),
  auditHash: toBytes32Hex(report.auditHash),
  tallyHash: toBytes32Hex(createAuditHash(report.tallyResult))
};

const tx = await audit.submitAuditWithTallyProof(
  submittedFields.electionIdHash,
  submittedFields.merkleRoot,
  submittedFields.commitmentRoot,
  submittedFields.receiptRoot,
  submittedFields.auditHash,
  submittedFields.tallyHash,
  calldata.a,
  calldata.b,
  calldata.c,
  calldata.input
);
const receipt = await tx.wait();
const record = await audit.getAudit(submittedFields.electionIdHash);

const sample = {
  sampleKind: "hardhat-real-verifier-chain-audit",
  generatedBy: "pnpm --filter @verivote/contracts run sample:chain-audit",
  network: networkName,
  verifierMode: "real-hardhat",
  contracts: {
    tallyVerifier: verifierAddress,
    veriVoteAudit: auditAddress
  },
  transaction: {
    hash: tx.hash,
    blockNumber: receipt?.blockNumber ?? null,
    gasUsed: receipt?.gasUsed?.toString() ?? null
  },
  gas: {
    tallyVerifierVerifyProofEstimate: directVerifyGas.toString(),
    submitAuditWithTallyProof: receipt?.gasUsed?.toString() ?? null
  },
  submittedFields,
  auditRecord: {
    electionId: record.electionId,
    merkleRoot: record.merkleRoot,
    commitmentRoot: record.commitmentRoot,
    receiptRoot: record.receiptRoot,
    auditHash: record.auditHash,
    tallyHash: record.tallyHash,
    zkVerified: record.zkVerified,
    exists: record.exists
  },
  calldataSource: "docs/contracts/calldata.sample.json"
};

writeFileSync(outputPath, `${JSON.stringify(sample, null, 2)}\n`, "utf8");

console.log(`Wrote ${outputPath}`);
console.log(`TallyVerifier: ${verifierAddress}`);
console.log(`VeriVoteAudit: ${auditAddress}`);
console.log(`txHash: ${tx.hash}`);
console.log(`gas submitAuditWithTallyProof real: ${sample.gas.submitAuditWithTallyProof}`);
console.log(`gas TallyVerifier.verifyProof real: ${sample.gas.tallyVerifierVerifyProofEstimate}`);
