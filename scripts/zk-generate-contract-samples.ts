import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  createAuditHash,
  createMerkleLeaf,
  createVoteTokenHash,
  getMerkleRoot
} from "../packages/crypto/src/index.ts";
import {
  createTallyCorrectnessProof,
  createTallyProofMetadataFromReport,
  encodeTallySolidityCalldata,
  verifyTallyCorrectnessProof,
  verifyTallyProofAgainstReport
} from "../packages/zk/src/index.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const outputDir = join(projectRoot, "docs", "contracts");
const electionId = "election_fixture_8x4";
const candidates = [
  { id: "candidate_1", electionId, name: "Alice" },
  { id: "candidate_2", electionId, name: "Bob" },
  { id: "candidate_3", electionId, name: "Carol" },
  { id: "candidate_4", electionId, name: "Dave" }
];
const voteVectors = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1]
];
const realRows = [1, 1, 1, 1, 1, 1, 1, 1];

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function writeJson(fileName: string, value: unknown): void {
  writeFileSync(join(outputDir, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonIfExists<T>(fileName: string): T | null {
  const filePath = join(outputDir, fileName);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function time<T>(fn: () => T): { value: T; ms: number } {
  const startedAt = performance.now();
  const value = fn();
  return { value, ms: Number((performance.now() - startedAt).toFixed(3)) };
}

function buildVoteFixture() {
  const votes = voteVectors.map((voteVector, index) => ({
    voteId: `vote_${index + 1}`,
    userId: `user_${index + 1}`,
    candidateId: candidates[voteVector.findIndex((value) => value === 1)].id,
    voteVector,
    commitment: `fixture_commitment_${index + 1}`,
    receiptCode: `fixture_receipt_${index + 1}`
  }));
  const tally = candidates.map((_, candidateIndex) =>
    voteVectors.reduce((total, row) => total + row[candidateIndex], 0)
  );

  return {
    schemaVersion: "verivote.valid-vote-records.v1.sample",
    electionId,
    candidates,
    voteVectors,
    realRows,
    votes,
    tally
  };
}

function buildReport(voteFixture: ReturnType<typeof buildVoteFixture>) {
  const commitmentRoot = getMerkleRoot(voteFixture.votes.map((vote) => vote.commitment));
  const receiptRoot = getMerkleRoot(voteFixture.votes.map((vote) => vote.receiptCode));
  const voteTokenHashes = voteFixture.votes.map((vote) =>
    createVoteTokenHash(electionId, vote.userId)
  );
  const tokenHashesByVoteId = new Map(
    voteFixture.votes.map((vote, index) => [vote.voteId, voteTokenHashes[index]])
  );
  const bucketAuditCore = candidates.map((candidate) => {
    const bucketVotes = voteFixture.votes.filter(
      (vote) => vote.candidateId === candidate.id
    );
    const voteIds = bucketVotes.map((vote) => vote.voteId);
    const tokenHashes = bucketVotes.map(
      (vote) => tokenHashesByVoteId.get(vote.voteId) ?? ""
    );
    const tokenRoot = getMerkleRoot(tokenHashes);
    const bucketCommitmentRoot = getMerkleRoot(
      bucketVotes.map((vote) => vote.commitment)
    );
    const bucketReceiptRoot = getMerkleRoot(
      bucketVotes.map((vote) => vote.receiptCode)
    );
    const bucketAuditHash = createAuditHash({
      domain: "verivote.partition-bucket.v2",
      candidateId: candidate.id,
      tokenRoot,
      commitmentRoot: bucketCommitmentRoot,
      receiptRoot: bucketReceiptRoot,
      voteCount: bucketVotes.length,
      voteIdsHash: hashText(JSON.stringify(voteIds))
    });

    return {
      candidate,
      voteIds,
      tokenHashes,
      tokenRoot,
      bucketCommitmentRoot,
      bucketReceiptRoot,
      bucketAuditHash
    };
  });
  const partitionFlags = {
    coverComplete: true,
    disjoint: true,
    noDuplicateValidTokenHashes: true,
    allValidVotesBucketed: true
  };
  const partitionHash = createAuditHash({
    domain: "verivote.partition-audit.v2",
    electionId,
    bucketAuditHashes: bucketAuditCore.map((bucket) => bucket.bucketAuditHash),
    ...partitionFlags
  });
  const partitionAudit = {
    buckets: bucketAuditCore.map((bucket) => ({
      candidateId: bucket.candidate.id,
      candidateName: bucket.candidate.name,
      voteCount: bucket.voteIds.length,
      voteIds: bucket.voteIds,
      tokenHashes: bucket.tokenHashes,
      tokenRoot: bucket.tokenRoot,
      commitmentRoot: bucket.bucketCommitmentRoot,
      receiptRoot: bucket.bucketReceiptRoot,
      bucketAuditHash: bucket.bucketAuditHash
    })),
    ...partitionFlags,
    partitionHash
  };
  const tallyResult = {
    electionId,
    totalVotes: voteFixture.votes.length,
    results: candidates.map((candidate, index) => ({
      candidateId: candidate.id,
      candidateName: candidate.name,
      voteCount: voteFixture.tally[index]
    }))
  };
  const duplicateTokenHashes: string[] = [];
  const invalidVoteDiagnostics: unknown[] = [];
  const validVoteIds = voteFixture.votes.map((vote) => vote.voteId);
  const invalidVoteIds: string[] = [];
  const diagnosticsHash = createAuditHash({
    domain: "verivote.invalid-vote-diagnostics.v2",
    diagnostics: invalidVoteDiagnostics
  });
  const tallyHash = createAuditHash(tallyResult);
  const tallyProofSummary = {
    proofStatus: "not-generated",
    proofId: null,
    proofMode: null,
    verifierMode: null,
    circuitId: "tally-correctness-v2",
    proofHash: null,
    publicSignals: null,
    message:
      "Tally proof has not been generated by B-track yet; A-track exports report-binding metadata only."
  };
  const publicInputHints = {
    electionIdHash: hashText(`verivote.zk.tally.election-id.v1:${electionId}`),
    candidateCount: candidates.length,
    validVotes: voteFixture.votes.length,
    tallyHash,
    commitmentRoot,
    partitionHash,
    receiptRoot,
    diagnosticsHash,
    pedersenAggregateHash: null
  };
  const coreFields = {
    electionId,
    totalVotes: voteFixture.votes.length,
    validVotes: voteFixture.votes.length,
    validVoteIds,
    invalidVotes: 0,
    invalidVoteIds,
    duplicateVotes: 0,
    proofStatus: tallyProofSummary.proofStatus,
    tallyProofSummary,
    receiptChainVerified: true,
    receiptChainBreaks: [],
    voteTokenHashes,
    duplicateTokenHashes,
    tallyResult,
    commitmentRoot,
    receiptRoot,
    partitionAudit,
    partitionHash,
    invalidVoteDiagnostics,
    diagnosticsHash,
    publicInputHints,
    pedersenAggregateAudit: null,
    pedersenAggregateStatus: "pending",
    pedersenAggregateHash: null
  };

  return {
    schemaVersion: "verivote.aggregator-report.v2.sample",
    ...coreFields,
    auditHash: createAuditHash(coreFields),
    createdAt: "2026-06-26T00:00:00.000Z",
    fixtureDerived: {
      merkleRoot: getMerkleRoot(
        voteFixture.votes.map((vote) =>
          createMerkleLeaf(vote.voteId, vote.commitment, vote.receiptCode)
        )
      ),
      source: "docs/contracts/valid_vote_records_8x4.sample.json"
    }
  };
}

mkdirSync(outputDir, { recursive: true });

const voteFixture =
  readJsonIfExists<ReturnType<typeof buildVoteFixture>>(
    "valid_vote_records_8x4.sample.json"
  ) ?? buildVoteFixture();
const report =
  readJsonIfExists<ReturnType<typeof buildReport>>(
    "aggregator_report_v2.sample.json"
  ) ?? buildReport(voteFixture);
writeJson("valid_vote_records_8x4.sample.json", voteFixture);
writeJson("aggregator_report_v2.sample.json", report);

const validBatchId = "fixture-8x4-real-valid";
const proofRun = time(() =>
  createTallyCorrectnessProof({
    electionId,
    voteVectors: voteFixture.voteVectors,
    realRows: voteFixture.realRows,
    tally: voteFixture.tally,
    batchId: validBatchId,
    proofMode: "real",
    verifierMode: "real-hardhat",
    metadata: createTallyProofMetadataFromReport(report, { batchId: validBatchId })
  })
);
const verifyRun = time(() =>
  verifyTallyCorrectnessProof({
    proof: proofRun.value.proof,
    publicSignals: proofRun.value.publicSignals
  })
);
const bindingCheck = verifyTallyProofAgainstReport({
  proofResponse: proofRun.value,
  report,
  expectedElectionId: electionId,
  expectedVerifierModes: ["real-hardhat"],
  requireRealProof: true
});

if (!proofRun.value.valid || !verifyRun.value.verified || !bindingCheck.verified) {
  throw new Error(
    `valid proof sample failed: proof=${proofRun.value.valid}, verify=${verifyRun.value.verified}, binding=${bindingCheck.verified}`
  );
}

writeJson("tally_proof_v2.valid.sample.json", {
  sampleKind: "real-groth16-valid-tally-proof-v2",
  generatedBy: "pnpm zk:samples",
  proofGenerationMs: proofRun.ms,
  proofVerificationMs: verifyRun.ms,
  verifyResult: verifyRun.value,
  bindingCheck,
  ...proofRun.value
});

const invalidTally = [3, 1, 2, 2];
const invalidBatchId = "fixture-8x4-invalid-tally";
const invalidProof = createTallyCorrectnessProof({
  electionId,
  voteVectors: voteFixture.voteVectors,
  realRows: voteFixture.realRows,
  tally: invalidTally,
  batchId: invalidBatchId,
  proofMode: "real",
  verifierMode: "real-hardhat",
  metadata: createTallyProofMetadataFromReport(report, { batchId: invalidBatchId })
});
writeJson("tally_proof_v2.invalid-tally.sample.json", {
  sampleKind: "real-groth16-invalid-tally-proof-v2",
  generatedBy: "pnpm zk:samples",
  expectedValid: false,
  invalidReason:
    "tally vector [3,1,2,2] does not match the 8x4 witness column sums [2,2,2,2]",
  request: {
    electionId,
    voteVectors: voteFixture.voteVectors,
    realRows: voteFixture.realRows,
    tally: invalidTally
  },
  ...invalidProof
});

const calldata = encodeTallySolidityCalldata(proofRun.value.proof);
writeJson("calldata.sample.json", {
  sourceProof: "docs/contracts/tally_proof_v2.valid.sample.json",
  verifierMode: "real-hardhat",
  proofHash: proofRun.value.proofHash,
  ...calldata
});

console.log(`Wrote samples to ${outputDir}`);
console.log(`proofGenerationMs=${proofRun.ms}`);
console.log(`proofVerificationMs=${verifyRun.ms}`);
console.log(`proofHash=${proofRun.value.proofHash}`);
