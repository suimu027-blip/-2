import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTallyCorrectnessProof,
  createTallyProofMetadataFromReport,
  encodeTallySolidityCalldata,
  recomputeTallyProofHash,
  verifyTallyProofAgainstReport
} from "../packages/zk/src/index.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const contractsDocs = join(projectRoot, "docs", "contracts");

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(contractsDocs, fileName), "utf8")) as T;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertCase(
  label: string,
  condition: boolean,
  details?: Record<string, unknown>
): void {
  if (!condition) {
    throw new Error(`${label} failed${details ? `: ${JSON.stringify(details)}` : ""}`);
  }
  console.log(`PASS ${label}`);
}

function assertThrows(label: string, fn: () => void): void {
  try {
    fn();
  } catch {
    console.log(`PASS ${label}`);
    return;
  }
  throw new Error(`${label} failed: expected throw`);
}

type ProofResponse = Record<string, unknown> & {
  publicSignals?: Record<string, unknown>;
  proof?: Record<string, unknown> & {
    publicSignals?: Record<string, unknown>;
    verifierMode?: string;
  };
};

type Report = Record<string, unknown> & {
  electionId: string;
  publicInputHints?: Record<string, unknown>;
  tallyResult?: {
    totalVotes?: number;
    results?: Array<{ voteCount: number }>;
  };
};

type VoteFixture = {
  voteVectors: number[][];
  realRows: number[];
  tally: number[];
};

const report = readJson<Report>("aggregator_report_v2.sample.json");
const validProof = readJson<ProofResponse>("tally_proof_v2.valid.sample.json");
const voteFixture = readJson<VoteFixture>("valid_vote_records_8x4.sample.json");

function verify(proofResponse: unknown, reportInput: unknown) {
  return verifyTallyProofAgainstReport({
    proofResponse,
    report: reportInput,
    expectedElectionId: report.electionId,
    expectedVerifierModes: ["real-hardhat"],
    requireRealProof: true
  });
}

const valid = verify(validProof, report);
assertCase("valid real proof binds to fixture report", valid.verified, valid.checks);

assertCase(
  "valid proof can export Solidity calldata",
  (() => {
    const calldata = encodeTallySolidityCalldata(validProof.proof);
    return calldata.input.length === 5;
  })()
);

const tamperedProofWithoutHash = cloneJson(validProof.proof);
if (
  tamperedProofWithoutHash.snarkjsProof &&
  typeof tamperedProofWithoutHash.snarkjsProof === "object" &&
  Array.isArray((tamperedProofWithoutHash.snarkjsProof as { pi_a?: unknown }).pi_a)
) {
  const piA = (tamperedProofWithoutHash.snarkjsProof as { pi_a: string[] }).pi_a;
  piA[0] = (BigInt(piA[0]) + 1n).toString();
}
assertThrows(
  "tampered proof with stale proofHash cannot export calldata",
  () => encodeTallySolidityCalldata(tamperedProofWithoutHash)
);

const tamperedProofWithHash = cloneJson(tamperedProofWithoutHash);
tamperedProofWithHash.proofHash = recomputeTallyProofHash(tamperedProofWithHash);
assertThrows(
  "tampered proof with recomputed proofHash still cannot export calldata",
  () => encodeTallySolidityCalldata(tamperedProofWithHash)
);

const positionalValid = verifyTallyProofAgainstReport(report, validProof, {
  expectedElectionId: report.electionId,
  expectedVerifierModes: ["real-hardhat"],
  requireRealProof: true
});
assertCase(
  "positional verifyTallyProofAgainstReport API remains supported",
  positionalValid.verified,
  positionalValid.checks
);

const missingPublicSignals = cloneJson(validProof);
delete missingPublicSignals.publicSignals;
const missingPublicSignalsResult = verify(missingPublicSignals, report);
assertCase(
  "missing top-level publicSignals is rejected",
  !missingPublicSignalsResult.verified &&
    missingPublicSignalsResult.checks.responseShape === false,
  missingPublicSignalsResult.checks
);

const spoofedVerifierMode = cloneJson(validProof);
spoofedVerifierMode.verifierMode = "real-hardhat";
if (spoofedVerifierMode.proof) {
  spoofedVerifierMode.proof.verifierMode = "local-mock";
}
const spoofedVerifierModeResult = verify(spoofedVerifierMode, report);
assertCase(
  "response/proof verifierMode mismatch is rejected",
  !spoofedVerifierModeResult.verified &&
    spoofedVerifierModeResult.checks.responseVerifierModeMatchesProof === false,
  spoofedVerifierModeResult.checks
);

const pollutedHintReport = cloneJson(report);
pollutedHintReport.publicInputHints = {
  ...(pollutedHintReport.publicInputHints ?? {}),
  tallyHash: "bad-tally-hash"
};
const pollutedHintResult = verify(validProof, pollutedHintReport);
assertCase(
  "polluted tallyHash hint is rejected",
  !pollutedHintResult.verified &&
    pollutedHintResult.checks.tallyHashHintMatchesReport === false,
  pollutedHintResult.checks
);

const inconsistentTallyTotal = cloneJson(report);
if (inconsistentTallyTotal.tallyResult) {
  inconsistentTallyTotal.tallyResult.totalVotes = 999;
}
const inconsistentTallyTotalResult = verify(validProof, inconsistentTallyTotal);
assertCase(
  "inconsistent tallyResult.totalVotes is rejected",
  !inconsistentTallyTotalResult.verified &&
    inconsistentTallyTotalResult.checks.tallyResultTotalVotesMatchesValidVotes === false,
  inconsistentTallyTotalResult.checks
);

const missingValidVotes = cloneJson(report);
delete missingValidVotes.validVotes;
const missingValidVotesResult = verify(validProof, missingValidVotes);
assertCase(
  "missing top-level validVotes is rejected",
  !missingValidVotesResult.verified &&
    missingValidVotesResult.checks.reportHasValidVotes === false,
  missingValidVotesResult.checks
);

const mutatedCommitmentRoot = cloneJson(report);
mutatedCommitmentRoot.commitmentRoot = "bad-commitment-root";
const mutatedCommitmentRootResult = verify(validProof, mutatedCommitmentRoot);
assertCase(
  "mutated report commitmentRoot is rejected",
  !mutatedCommitmentRootResult.verified &&
    mutatedCommitmentRootResult.checks.commitmentRootMatchesReport === false,
  mutatedCommitmentRootResult.checks
);

const missingCommitmentRoot = cloneJson(report);
delete missingCommitmentRoot.commitmentRoot;
const missingCommitmentRootResult = verify(validProof, missingCommitmentRoot);
assertCase(
  "missing top-level commitmentRoot is not silently replaced by hint",
  !missingCommitmentRootResult.verified &&
    missingCommitmentRootResult.checks.commitmentRootMatchesReport === false,
  missingCommitmentRootResult.checks
);

const missingPartitionHash = cloneJson(report);
delete missingPartitionHash.partitionHash;
const missingPartitionHashResult = verify(validProof, missingPartitionHash);
assertCase(
  "missing top-level partitionHash can use partitionAudit.partitionHash",
  missingPartitionHashResult.verified,
  missingPartitionHashResult.checks
);

const missingRequiredFieldsReport = cloneJson(report);
delete missingRequiredFieldsReport.validVotes;
delete missingRequiredFieldsReport.commitmentRoot;
delete missingRequiredFieldsReport.partitionHash;
if (
  missingRequiredFieldsReport.partitionAudit &&
  typeof missingRequiredFieldsReport.partitionAudit === "object"
) {
  delete (missingRequiredFieldsReport.partitionAudit as Record<string, unknown>).partitionHash;
}
const unavailableMetadataProof = createTallyCorrectnessProof({
  electionId: report.electionId,
  voteVectors: voteFixture.voteVectors,
  realRows: voteFixture.realRows,
  tally: voteFixture.tally,
  batchId: "fixture-8x4-unavailable-metadata",
  proofMode: "real",
  verifierMode: "real-hardhat",
  metadata: createTallyProofMetadataFromReport(missingRequiredFieldsReport, {
    batchId: "fixture-8x4-unavailable-metadata"
  })
});
const unavailableMetadataResult = verify(
  unavailableMetadataProof,
  missingRequiredFieldsReport
);
assertCase(
  "proof/report pair with unavailable required metadata is rejected",
  !unavailableMetadataResult.verified &&
    unavailableMetadataResult.checks.reportHasValidVotes === false &&
    unavailableMetadataResult.checks.reportHasCommitmentRoot === false &&
    unavailableMetadataResult.checks.reportHasPartitionHash === false,
  unavailableMetadataResult.checks
);

const mockProof = createTallyCorrectnessProof({
  electionId: report.electionId,
  voteVectors: voteFixture.voteVectors,
  realRows: voteFixture.realRows,
  tally: voteFixture.tally,
  batchId: "fixture-8x4-mock-audit",
  proofMode: "mock",
  verifierMode: "mock",
  metadata: createTallyProofMetadataFromReport(report, {
    batchId: "fixture-8x4-mock-audit"
  })
});
const mockResult = verify(mockProof, report);
assertCase(
  "mock proof cannot satisfy real submit binding",
  !mockResult.verified &&
    mockResult.checks.proofModeAllowed === false &&
    mockResult.checks.verifierModeAllowed === false,
  mockResult.checks
);

console.log("ZK binding audit completed.");
