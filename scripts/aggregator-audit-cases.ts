import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCommitment,
  createReceiptCode,
  createVoteVector,
  getMerkleRoot
} from "../packages/crypto/src/index.ts";
import {
  candidates,
  counters,
  elections,
  users,
  votes,
  pendingBallots,
  challengeRecords,
  bulletinBoards,
  aggregatorReports,
  attackLogs,
  blockchainAuditRecords,
  createId
} from "../apps/api/src/state.ts";
import {
  appendVoteWithReceiptChain,
  buildArtifactContext,
  buildExportBundle,
  buildVoteAuditContext,
  createAggregatorReport,
  createAuditHashForAggregatorReport,
  createBulletinBoard,
  createPublicInputsArtifact,
  verifyAggregatorReportIntegrity
} from "../apps/api/src/utils.ts";
import type {
  AggregatorReport,
  AggregatorReportIntegrityCheck,
  Candidate,
  Election,
  InvalidVoteReason,
  User,
  Vote
} from "../packages/shared/src/index.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const contractsDir = join(projectRoot, "docs", "contracts");
const evaluationDir = join(projectRoot, "docs", "evaluation");
const reportDir = join(evaluationDir, "aggregator_reports");

interface DemoFixture {
  election: Election;
  fixtureCandidates: Candidate[];
  fixtureUsers: User[];
  fixtureVotes: Vote[];
}

interface CaseExpectation {
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  duplicateVotes: number;
  receiptChainVerified: boolean;
  requiredReasons: InvalidVoteReason[];
}

interface CaseDefinition {
  name: string;
  description: string;
  expectation: CaseExpectation;
  mutate?: (fixture: DemoFixture) => void;
}

interface CaseSummary {
  name: string;
  file: string;
  compatibilityFile: string | null;
  description: string;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  duplicateVotes: number;
  proofStatus: string;
  receiptChainVerified: boolean;
  diagnosticReasons: InvalidVoteReason[];
  validVoteIds: string[];
  invalidVoteIds: string[];
  bucketVoteCounts: Record<string, number>;
  bucketTokenRootVerified: boolean;
  partitionHash: string;
  diagnosticsHash: string;
  auditHash: string;
  integrityVerified: boolean;
  integrityFailures: string[];
}

function resetState(): void {
  users.splice(0, users.length);
  elections.splice(0, elections.length);
  candidates.splice(0, candidates.length);
  votes.splice(0, votes.length);
  pendingBallots.splice(0, pendingBallots.length);
  challengeRecords.splice(0, challengeRecords.length);
  bulletinBoards.splice(0, bulletinBoards.length);
  aggregatorReports.splice(0, aggregatorReports.length);
  attackLogs.splice(0, attackLogs.length);
  blockchainAuditRecords.clear();

  for (const key of Object.keys(counters) as Array<keyof typeof counters>) {
    counters[key] = 0;
  }
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function fixedRandomness(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function fixedTimestamp(minute: number): string {
  return new Date(Date.UTC(2026, 5, 26, 1, minute, 0)).toISOString();
}

function createFixture(): DemoFixture {
  resetState();

  const election: Election = {
    id: "election_fixture_8x4",
    title: "VeriVote Aggregator v2 Fixture",
    description: "4 candidates, 8 formal votes, deterministic A-track audit fixture.",
    status: "active",
    createdAt: "2026-06-26T00:00:00.000Z"
  };
  elections.push(election);

  const fixtureCandidates = ["Alice", "Bob", "Carol", "Dave"].map(
    (name, index): Candidate => ({
      id: `candidate_${index + 1}`,
      electionId: election.id,
      name
    })
  );
  candidates.push(...fixtureCandidates);

  const fixtureUsers = Array.from({ length: 8 }, (_, index): User => ({
    id: `user_${index + 1}`,
    name: `Fixture User ${index + 1}`,
    createdAt: "2026-06-26T00:00:00.000Z"
  }));
  users.push(...fixtureUsers);

  const candidateIds = fixtureCandidates.map((candidate) => candidate.id);
  const fixtureVotes = fixtureUsers.map((user, index) => {
    const candidateId = candidateIds[index % candidateIds.length];
    const voteVector = createVoteVector(candidateIds, candidateId);
    const randomness = fixedRandomness(index + 1);
    const createdAt = new Date(Date.UTC(2026, 5, 26, 0, index, 0)).toISOString();
    const commitment = createCommitment(election.id, voteVector, randomness);
    const receiptCode = createReceiptCode(
      election.id,
      commitment,
      user.id,
      createdAt
    );

    return appendVoteWithReceiptChain({
      id: `vote_${index + 1}`,
      electionId: election.id,
      userId: user.id,
      candidateId,
      voteVector,
      randomness,
      commitment,
      receiptCode,
      createdAt
    });
  });

  counters.user = fixtureUsers.length;
  counters.candidate = fixtureCandidates.length;
  counters.vote = fixtureVotes.length;
  counters.election = 1;

  return { election, fixtureCandidates, fixtureUsers, fixtureVotes };
}

function addDuplicateVote(source: Vote): void {
  const createdAt = fixedTimestamp(1);
  const randomness = fixedRandomness(1001);
  const commitment = createCommitment(
    source.electionId,
    source.voteVector,
    randomness
  );
  const receiptCode = createReceiptCode(
    source.electionId,
    commitment,
    source.userId,
    createdAt
  );

  appendVoteWithReceiptChain({
    ...source,
    id: createId("vote"),
    randomness,
    commitment,
    receiptCode,
    createdAt
  });
}

function addInvalidCandidateVote(election: Election): void {
  const candidateCount = candidates.filter(
    (candidate) => candidate.electionId === election.id
  ).length;
  const voteVector = Array.from({ length: candidateCount }, (_value, index) =>
    index === 0 ? 1 : 0
  );
  const userId = "attacker_invalid_candidate";
  const createdAt = fixedTimestamp(2);
  const randomness = fixedRandomness(1002);
  const commitment = createCommitment(election.id, voteVector, randomness);
  const receiptCode = createReceiptCode(election.id, commitment, userId, createdAt);

  appendVoteWithReceiptChain({
    id: createId("vote"),
    electionId: election.id,
    userId,
    candidateId: "invalid_candidate_demo",
    voteVector,
    randomness,
    commitment,
    receiptCode,
    createdAt
  });
}

function addNonOneHotVote(election: Election, fixtureCandidates: Candidate[]): void {
  const voteVector = fixtureCandidates.map((_candidate, index) =>
    index < 2 ? 1 : 0
  );
  const userId = "attacker_non_one_hot";
  const createdAt = fixedTimestamp(3);
  const randomness = fixedRandomness(1003);
  const commitment = createCommitment(election.id, voteVector, randomness);
  const receiptCode = createReceiptCode(election.id, commitment, userId, createdAt);

  appendVoteWithReceiptChain({
    id: createId("vote"),
    electionId: election.id,
    userId,
    candidateId: fixtureCandidates[0].id,
    voteVector,
    randomness,
    commitment,
    receiptCode,
    createdAt
  });
}

function addCandidateVectorMismatchVote(
  election: Election,
  fixtureCandidates: Candidate[]
): void {
  const voteVector = fixtureCandidates.map((_candidate, index) =>
    index === 0 ? 1 : 0
  );
  const userId = "attacker_candidate_vector_mismatch";
  const createdAt = fixedTimestamp(4);
  const randomness = fixedRandomness(1004);
  const commitment = createCommitment(election.id, voteVector, randomness);
  const receiptCode = createReceiptCode(election.id, commitment, userId, createdAt);

  appendVoteWithReceiptChain({
    id: createId("vote"),
    electionId: election.id,
    userId,
    candidateId: fixtureCandidates[1].id,
    voteVector,
    randomness,
    commitment,
    receiptCode,
    createdAt
  });
}

function tamperCommitment(vote: Vote): void {
  const replacement = vote.commitment.endsWith("0") ? "1" : "0";
  vote.commitment = `${vote.commitment.slice(0, -1)}${replacement}`;
}

function deleteFirstVote(vote: Vote): void {
  const index = votes.findIndex((currentVote) => currentVote.id === vote.id);
  if (index >= 0) {
    votes.splice(index, 1);
  }
}

function createValidVoteRecords(fixture: DemoFixture): unknown {
  return {
    schemaVersion: "verivote.valid-vote-records.v1.sample",
    electionId: fixture.election.id,
    candidates: fixture.fixtureCandidates,
    voteVectors: fixture.fixtureVotes.map((vote) => vote.voteVector),
    realRows: fixture.fixtureVotes.map(() => 1),
    votes: fixture.fixtureVotes.map((vote) => ({
      voteId: vote.id,
      userId: vote.userId,
      candidateId: vote.candidateId,
      voteVector: vote.voteVector,
      commitment: vote.commitment,
      receiptCode: vote.receiptCode
    })),
    tally: fixture.fixtureCandidates.map((_candidate, candidateIndex) =>
      fixture.fixtureVotes.reduce(
        (total, vote) => total + vote.voteVector[candidateIndex],
        0
      )
    )
  };
}

function createDemoSeedFixture(fixture: DemoFixture): unknown {
  return {
    schemaVersion: "verivote.demo-seed-fixture.v1",
    generatedBy: "pnpm aggregator:audit-cases",
    election: {
      title: fixture.election.title,
      description: fixture.election.description
    },
    candidates: fixture.fixtureCandidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name
    })),
    users: fixture.fixtureUsers.map((user) => ({
      id: user.id,
      name: user.name
    })),
    votes: fixture.fixtureVotes.map((vote) => ({
      userId: vote.userId,
      candidateId: vote.candidateId,
      voteVector: vote.voteVector
    })),
    expected: {
      candidateCount: fixture.fixtureCandidates.length,
      totalVotes: fixture.fixtureVotes.length,
      validVotes: fixture.fixtureVotes.length,
      invalidVotes: 0,
      tally: fixture.fixtureCandidates.map((candidate) => ({
        candidateId: candidate.id,
        candidateName: candidate.name,
        voteCount: fixture.fixtureVotes.filter(
          (vote) => vote.candidateId === candidate.id
        ).length
      }))
    }
  };
}

function getDiagnosticReasons(report: AggregatorReport): InvalidVoteReason[] {
  return Array.from(
    new Set(report.invalidVoteDiagnostics.map((diagnostic) => diagnostic.reason))
  ).sort();
}

function getBucketVoteIds(report: AggregatorReport): Set<string> {
  return new Set(
    report.partitionAudit.buckets.flatMap((bucket) => bucket.voteIds)
  );
}

function asSortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function equalStringSet(left: string[], right: string[]): boolean {
  const leftSorted = asSortedUnique(left);
  const rightSorted = asSortedUnique(right);

  return (
    left.length === leftSorted.length &&
    right.length === rightSorted.length &&
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createPedersenNullReport(report: AggregatorReport): AggregatorReport {
  const pendingReport = cloneJson(report);
  pendingReport.pedersenAggregateAudit = null;
  pendingReport.pedersenAggregateStatus = "pending";
  pendingReport.pedersenAggregateHash = null;
  pendingReport.publicInputHints.pedersenAggregateHash = null;
  delete pendingReport.pedersenTallyVerified;
  delete pendingReport.pedersenTallyMessage;
  delete pendingReport.pedersenContextHash;
  pendingReport.auditHash = createAuditHashForAggregatorReport(pendingReport);
  return pendingReport;
}

function assertExpectedReport(
  name: string,
  report: AggregatorReport,
  expectation: CaseExpectation,
  integrityCheck: AggregatorReportIntegrityCheck
): void {
  assertCase(`${name}: integrity verified`, integrityCheck.verified, {
    failures: integrityCheck.failures
  });
  assertCase(`${name}: totalVotes`, report.totalVotes === expectation.totalVotes, {
    actual: report.totalVotes,
    expected: expectation.totalVotes
  });
  assertCase(`${name}: validVotes`, report.validVotes === expectation.validVotes, {
    actual: report.validVotes,
    expected: expectation.validVotes
  });
  assertCase(
    `${name}: invalidVotes`,
    report.invalidVotes === expectation.invalidVotes,
    {
      actual: report.invalidVotes,
      expected: expectation.invalidVotes
    }
  );
  assertCase(
    `${name}: duplicateVotes`,
    report.duplicateVotes === expectation.duplicateVotes,
    {
      actual: report.duplicateVotes,
      expected: expectation.duplicateVotes
    }
  );
  assertCase(
    `${name}: proofStatus not-generated`,
    report.proofStatus === "not-generated" &&
      report.tallyProofSummary?.proofStatus === "not-generated" &&
      report.tallyProofSummary.proofId === null,
    {
      proofStatus: report.proofStatus,
      tallyProofSummary: report.tallyProofSummary
    }
  );
  assertCase(
    `${name}: receiptChainVerified`,
    report.receiptChainVerified === expectation.receiptChainVerified,
    {
      actual: report.receiptChainVerified,
      expected: expectation.receiptChainVerified
    }
  );

  const reasons = new Set(report.invalidVoteDiagnostics.map((item) => item.reason));
  for (const reason of expectation.requiredReasons) {
    assertCase(`${name}: has diagnostic ${reason}`, reasons.has(reason), {
      reasons: Array.from(reasons)
    });
  }

  const auditContext = buildVoteAuditContext(report.electionId);
  assertCase(
    `${name}: buildVoteAuditContext validCandidateIds`,
    auditContext.electionCandidates.every((candidate) =>
      auditContext.validCandidateIds.has(candidate.id)
    ) &&
      auditContext.validCandidateIds.size ===
        auditContext.electionCandidates.length,
    {
      candidateIds: auditContext.electionCandidates.map(
        (candidate) => candidate.id
      ),
      validCandidateIds: Array.from(auditContext.validCandidateIds)
    }
  );

  const bucketVoteIds = getBucketVoteIds(report);
  const bucketVoteIdList = report.partitionAudit.buckets.flatMap(
    (bucket) => bucket.voteIds
  );
  const invalidVoteIdsFromDiagnostics = asSortedUnique(
    report.invalidVoteDiagnostics.map((diagnostic) => diagnostic.voteId)
  );
  const duplicateDiagnosticTokenHashes = asSortedUnique(
    report.invalidVoteDiagnostics
      .filter((diagnostic) => diagnostic.reason === "duplicate-token")
      .map((diagnostic) => diagnostic.tokenHash)
  );
  const bucketTokenHashes = report.partitionAudit.buckets.flatMap(
    (bucket) => bucket.tokenHashes
  );
  assertCase(
    `${name}: validVoteIds match buckets`,
    equalStringSet(report.validVoteIds, bucketVoteIdList),
    {
      validVoteIds: report.validVoteIds,
      bucketVoteIds: bucketVoteIdList
    }
  );
  assertCase(
    `${name}: invalidVoteIds match diagnostics`,
    equalStringSet(report.invalidVoteIds, invalidVoteIdsFromDiagnostics),
    {
      invalidVoteIds: report.invalidVoteIds,
      diagnostics: invalidVoteIdsFromDiagnostics
    }
  );
  assertCase(
    `${name}: invalid votes excluded from buckets`,
    report.invalidVoteIds.every((voteId) => !bucketVoteIds.has(voteId)),
    {
      invalidVoteIds: report.invalidVoteIds,
      bucketVoteIds: bucketVoteIdList
    }
  );
  assertCase(
    `${name}: valid and invalid ids partition totalVotes`,
    report.validVoteIds.length + report.invalidVoteIds.length === report.totalVotes &&
      new Set([...report.validVoteIds, ...report.invalidVoteIds]).size ===
        report.totalVotes,
    {
      totalVotes: report.totalVotes,
      validVoteIds: report.validVoteIds,
      invalidVoteIds: report.invalidVoteIds
    }
  );
  assertCase(
    `${name}: bucket token roots recompute`,
    report.partitionAudit.buckets.every(
      (bucket) => bucket.tokenRoot === getMerkleRoot(bucket.tokenHashes)
    ),
    {
      buckets: report.partitionAudit.buckets.map((bucket) => ({
        candidateId: bucket.candidateId,
        tokenRoot: bucket.tokenRoot,
        tokenHashes: bucket.tokenHashes
      }))
    }
  );
  assertCase(
    `${name}: duplicate token hashes match diagnostics`,
    equalStringSet(report.duplicateTokenHashes, duplicateDiagnosticTokenHashes),
    {
      duplicateTokenHashes: report.duplicateTokenHashes,
      diagnosticTokenHashes: duplicateDiagnosticTokenHashes
    }
  );
  assertCase(
    `${name}: valid bucket token hashes unique`,
    bucketTokenHashes.length === new Set(bucketTokenHashes).size,
    {
      bucketTokenHashes
    }
  );
  assertCase(
    `${name}: top-level and nested partitionHash match`,
    report.partitionHash === report.partitionAudit.partitionHash,
    {
      partitionHash: report.partitionHash,
      nested: report.partitionAudit.partitionHash
    }
  );
  assertCase(
    `${name}: publicInputHints bind report hashes`,
    report.publicInputHints.partitionHash === report.partitionHash &&
      report.publicInputHints.diagnosticsHash === report.diagnosticsHash &&
      report.publicInputHints.validVotes === report.validVotes,
    { publicInputHints: report.publicInputHints }
  );
}

function writeCase(caseDefinition: CaseDefinition): {
  report: AggregatorReport;
  integrityCheck: AggregatorReportIntegrityCheck;
  summary: CaseSummary;
} {
  const fixture = createFixture();
  caseDefinition.mutate?.(fixture);
  const report = createAggregatorReport(fixture.election.id);
  const integrityCheck = verifyAggregatorReportIntegrity(report);

  assertExpectedReport(
    caseDefinition.name,
    report,
    caseDefinition.expectation,
    integrityCheck
  );

  const file = `aggregator_report.${caseDefinition.name}.json`;
  writeJson(join(reportDir, file), report);
  const compatibilityFile =
    caseDefinition.name === "normal"
      ? null
      : `aggregator_report.attack-${caseDefinition.name}.json`;
  if (compatibilityFile) {
    writeJson(join(reportDir, compatibilityFile), report);
  }

  const summary: CaseSummary = {
    name: caseDefinition.name,
    file: `docs/evaluation/aggregator_reports/${file}`,
    compatibilityFile: compatibilityFile
      ? `docs/evaluation/aggregator_reports/${compatibilityFile}`
      : null,
    description: caseDefinition.description,
    totalVotes: report.totalVotes,
    validVotes: report.validVotes,
    invalidVotes: report.invalidVotes,
    duplicateVotes: report.duplicateVotes,
    proofStatus: report.proofStatus,
    receiptChainVerified: report.receiptChainVerified,
    diagnosticReasons: getDiagnosticReasons(report),
    validVoteIds: report.validVoteIds,
    invalidVoteIds: report.invalidVoteIds,
    bucketVoteCounts: Object.fromEntries(
      report.partitionAudit.buckets.map((bucket) => [
        bucket.candidateId,
        bucket.voteCount
      ])
    ),
    bucketTokenRootVerified: report.partitionAudit.buckets.every(
      (bucket) => bucket.tokenRoot === getMerkleRoot(bucket.tokenHashes)
    ),
    partitionHash: report.partitionHash,
    diagnosticsHash: report.diagnosticsHash,
    auditHash: report.auditHash,
    integrityVerified: integrityCheck.verified,
    integrityFailures: integrityCheck.failures
  };

  return { report, integrityCheck, summary };
}

function createCaseMarkdown(summaries: CaseSummary[]): string {
  const summaryRows = summaries
    .map(
      (item) =>
        `| ${item.name} | ${item.totalVotes} | ${item.validVotes} | ${item.invalidVotes} | ${item.duplicateVotes} | ${item.proofStatus} | ${item.receiptChainVerified} | ${item.diagnosticReasons.join(", ") || "none"} | ${item.integrityVerified ? "PASS" : "FAIL"} |`
    )
    .join("\n");

  return `# Aggregator Audit Cases

This document is the independent A-track acceptance record for AggregatorReport v2.

## Reproduce

\`\`\`bash
pnpm aggregator:audit-cases
pnpm aggregator:verify
pnpm aggregator:api-smoke
pnpm aggregator:local-export
pnpm aggregator:ps-smoke
python scripts/api_smoke_test.py
pnpm aggregator:complete
pnpm typecheck
pnpm build
\`\`\`

The evidence script is intentionally strict: it regenerates all JSON artifacts,
recomputes AggregatorReport integrity checks, and fails fast if any expected
attack diagnostic, partition invariant, or report hash binding is missing.
The offline verifier reloads the generated JSON files from disk, strips
sample-only metadata, recomputes the same integrity contract, and proves common
tampering attempts are rejected.

## Output Files

- \`docs/contracts/aggregator_report_v2.sample.json\`: normal 4-candidate, 8-vote AggregatorReport v2.
- \`docs/contracts/aggregator_report.sample.json\`: compatibility alias for teams that still use the day-0 sample name.
- \`docs/contracts/aggregator_report_pedersen_null.sample.json\`: C-track-not-ready sample with \`pedersenAggregateAudit=null\` and a recomputed \`auditHash\`.
- \`docs/contracts/export_bundle_v2.sample.json\`: full ExportBundleV2 sample with AggregatorReport, proof placeholder, chain audit, and demo metadata.
- \`docs/contracts/public_inputs_v2.sample.json\`: public-input artifact with \`partitionHash\` and \`diagnosticsHash\`.
- \`docs/contracts/valid_vote_records_8x4.sample.json\`: fixed 8x4 vote fixture for ZK/report binding.
- \`docs/contracts/demo_seed_fixture.json\`: minimal 4-candidate/8-vote seed plan for independent API/UI demos.
- \`docs/contracts/VERIVOTE_PARALLEL_INTERFACE_CONTRACT.md\`: frozen A/B/C/D field and sample contract.
- \`docs/evaluation/AGGREGATOR_AUDIT_HANDOFF.md\`: A handoff with failure copy and screenshot checklist.
- \`docs/evaluation/aggregator_reports/summary.json\`: machine-readable A-track acceptance summary.
- \`docs/evaluation/aggregator_reports/offline_verification.json\`: disk-based verification and tamper rejection summary.
- \`docs/evaluation/aggregator_reports/api_smoke.json\`: HTTP API smoke evidence for run/report/export/attack endpoints.
- \`docs/evaluation/aggregator_reports/api_export_aggregator_report.json\`: raw HTTP export of \`aggregator_report.json\`.
- \`docs/evaluation/aggregator_reports/api_export_public_inputs.json\`: raw HTTP export of \`public_inputs.json\`.
- \`docs/evaluation/aggregator_reports/api_export_bundle.json\`: raw HTTP export of \`/elections/:id/export-bundle\`.
- \`docs/evaluation/aggregator_reports/api_aggregator_report.attack-tamper-tally.json\`: saved-report tamper negative case; the report has a recomputed \`auditHash\` but \`integrityCheck.verified=false\` and \`tallyConsistent=false\`.
- \`docs/evaluation/aggregator_reports/local_standalone/manifest.json\`: local no-server export manifest generated by \`pnpm aggregator:local-export\`.
- \`docs/evaluation/aggregator_reports/local_standalone/aggregator_report.local-normal.json\`: standalone AggregatorReport v2 generated without starting the API server.
- \`docs/evaluation/aggregator_reports/local_standalone/public_inputs.local-normal.json\`: standalone public inputs generated from the local fixture.
- \`docs/evaluation/aggregator_reports/local_standalone/export_bundle.local-normal.json\`: standalone ExportBundleV2 generated from the local fixture.
- \`docs/evaluation/aggregator_reports/powershell_api/manifest.json\`: PowerShell Invoke-RestMethod smoke manifest generated by \`pnpm aggregator:ps-smoke\`.
- \`docs/evaluation/aggregator_reports/powershell_api/aggregator_report.normal.json\`: normal AggregatorReport v2 saved by the PowerShell API smoke path.
- \`docs/evaluation/aggregator_reports/powershell_api/aggregator_report.attack-*.json\`: attack AggregatorReport v2 files saved by the PowerShell API smoke path.
- \`docs/evaluation/aggregator_reports/powershell_api/public_inputs.normal.json\`: public inputs saved through PowerShell API calls.
- \`docs/evaluation/aggregator_reports/powershell_api/export_bundle.normal.json\`: ExportBundleV2 saved through PowerShell API calls.
- \`docs/evaluation/aggregator_reports/python_api_smoke.json\`: Python/FastAPI parity smoke evidence.
- \`docs/evaluation/aggregator_reports/python_api_aggregator_report.json\`: raw Python API AggregatorReport v2 response.
- \`docs/evaluation/aggregator_reports/python_api_public_inputs.json\`: raw Python API public inputs v2 response.
- \`docs/evaluation/aggregator_reports/python_api_export_bundle.json\`: raw Python API ExportBundleV2 response.
- \`docs/evaluation/aggregator_reports/api_schema_parity.json\`: TS/Python schema parity, including \`integrityCheck.checks\` keys.
- \`docs/evaluation/aggregator_reports/task_a_traceability.json\`: machine-readable A-01 to A-20 traceability matrix.
- \`docs/evaluation/aggregator_reports/completeness_matrix.json\`: machine-readable A deliverable completeness gate.
- \`docs/evaluation/aggregator_reports/aggregator_report.normal.json\`
- \`docs/evaluation/aggregator_reports/aggregator_report.duplicate-token.json\`
- \`docs/evaluation/aggregator_reports/aggregator_report.attack-duplicate-token.json\`
- \`docs/evaluation/aggregator_reports/aggregator_report.invalid-candidate.json\`
- \`docs/evaluation/aggregator_reports/aggregator_report.attack-invalid-candidate.json\`
- \`docs/evaluation/aggregator_reports/aggregator_report.non-one-hot.json\`
- \`docs/evaluation/aggregator_reports/aggregator_report.attack-non-one-hot.json\`
- \`docs/evaluation/aggregator_reports/aggregator_report.candidate-vector-mismatch.json\`
- \`docs/evaluation/aggregator_reports/aggregator_report.attack-candidate-vector-mismatch.json\`
- \`docs/evaluation/aggregator_reports/aggregator_report.commitment-tamper.json\`
- \`docs/evaluation/aggregator_reports/aggregator_report.attack-commitment-tamper.json\`
- \`docs/evaluation/aggregator_reports/aggregator_report.receipt-chain-delete.json\`
- \`docs/evaluation/aggregator_reports/aggregator_report.attack-receipt-chain-delete.json\`

## Generated Case Summary

| Case | totalVotes | validVotes | invalidVotes | duplicateVotes | proofStatus | receiptChainVerified | diagnostic reasons | integrity |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
${summaryRows}

## A-01 To A-20 Checklist

| Task | Status | Evidence |
| --- | --- | --- |
| A-01 shared v2 types | Done | \`packages/shared/src/index.ts\`: CandidatePartitionBucket, PartitionAudit, InvalidVoteDiagnostic, AggregatorReportIntegrityCheck, AggregatorReport v2 |
| A-02 buildVoteAuditContext | Done | \`apps/api/src/utils.ts\`: gathers votes, candidates, validCandidateIds, candidateIndexMap, receipt-chain diagnostics |
| A-03 one-hot validation | Done | \`isOneHotVector\` checks length, integer, binary, and sum=1 |
| A-04 commitment opening | Done | \`verifyVoteCommitmentOpening\` recomputes Pedersen opening from electionId, vector, randomness, commitment |
| A-05 invalid diagnostics | Done | duplicate-token, invalid-candidate, invalid-one-hot, candidate-vector-mismatch, commitment-opening-failed, receipt-chain-break |
| A-06 valid vote definition | Done | only diagnostics-free outcomes enter tally and buckets |
| A-07 candidate buckets | Done | every bucket contains voteIds, tokenHashes, tokenRoot, commitmentRoot, receiptRoot |
| A-08 bucketAuditHash | Done | hash domain \`verivote.partition-bucket.v2\` covers candidateId, roots, voteCount, voteIdsHash |
| A-09 partitionHash | Done | hash domain \`verivote.partition-audit.v2\` covers bucket hashes and partition flags |
| A-10 diagnosticsHash | Done | hash domain \`verivote.invalid-vote-diagnostics.v2\` covers stable sorted diagnostics |
| A-11 auditHash binding | Done | auditHash covers partitionHash, diagnosticsHash, Pedersen aggregate hash/null, proofStatus/tallyProofSummary, and report core fields |
| A-11b C-track null boundary | Done | \`aggregator_report_pedersen_null.sample.json\` verifies \`pedersenAggregateAudit=null\` and \`pedersenAggregateHash=null\` remain hash-bound |
| A-12 publicInputs v2 | Done | \`createPublicInputsArtifact\` exports partitionHash, diagnosticsHash, tallyHash, candidateCount, validVotes |
| A-12b ExportBundleV2 | Done | \`export_bundle_v2.sample.json\` contains \`aggregatorReport\`, \`tallyProofSummary.proofStatus=not-generated\`, \`chainAudit\`, and \`demoMetadata\` |
| A-13 normal sample | Done | \`aggregator_report.normal.json\` and \`aggregator_report_v2.sample.json\` |
| A-14 duplicate sample | Done | \`aggregator_report.duplicate-token.json\`, expected duplicate-token diagnostic |
| A-15 invalid candidate sample | Done | \`aggregator_report.invalid-candidate.json\`, invalid vote excluded from buckets |
| A-16 non-one-hot sample | Done | \`aggregator_report.non-one-hot.json\`, expected invalid-one-hot diagnostic |
| A-17 commitment tamper sample | Done | \`aggregator_report.commitment-tamper.json\`, expected commitment-opening-failed and receipt-chain-break |
| A-18 receipt-chain delete sample | Done | \`aggregator_report.receipt-chain-delete.json\`, expected receiptChainVerified=false |
| A-18b saved report tamper | Done | \`api_aggregator_report.attack-tamper-tally.json\`, expected \`bucketTallyMatches=false\`, \`tallyTotalMatchesValidVotes=false\`, \`tallySumMatchesValidVotes=false\`, and \`tallyConsistent=false\` |
| A-19 Aggios wording boundary | Done | \`docs/overview/PAPER_MAPPING.md\` says Aggios-inspired partition audit surface, not full EPA |
| A-20 API/local smoke | Done | \`pnpm aggregator:api-smoke\` starts the API, seeds elections, calls run/report/export/attack endpoints including candidate-vector-mismatch, verifies SQLite restart persistence, and writes \`api_smoke.json\`; \`pnpm aggregator:local-export\` writes AggregatorReport v2/PublicInputs/ExportBundleV2 without starting the API server; \`pnpm aggregator:ps-smoke\` gives the A.5 PowerShell/Invoke-RestMethod acceptance path |
| A-20b Python API parity | Done | \`python scripts/api_smoke_test.py\` verifies the Python/FastAPI entrypoint emits AggregatorReport v2, publicInputs v2, and ExportBundleV2 |

## Completeness Gate

\`\`\`bash
pnpm aggregator:complete
\`\`\`

This gate checks the A-track handoff files and generated JSON evidence, including
the frozen interface contract, handoff checklist, demo seed fixture, normal and
attack reports, raw HTTP export files, offline tamper cases, API smoke endpoints,
SQLite persistence round-trip, explicit vote-id coverage, per-bucket token
evidence, and A-01 to A-20 traceability. It writes
\`docs/evaluation/aggregator_reports/completeness_matrix.json\`.

## Field Contract

| Field | Purpose | Integrity rule |
| --- | --- | --- |
| \`partitionAudit.buckets[]\` | Candidate partition evidence | bucket hash must recompute from roots, voteCount, voteIdsHash |
| \`partitionAudit.buckets[].tokenHashes\` | Valid-vote token leaves per candidate | \`tokenRoot\` must recompute from these leaves and token hashes must be unique across valid buckets |
| \`validVoteIds\` | Explicit valid-vote coverage set | must exactly equal the union of bucket voteIds |
| \`invalidVoteIds\` | Explicit invalid-vote coverage set | must exactly equal diagnostic voteIds and be absent from every bucket |
| \`partitionHash\` | Compact binding for all buckets and flags | top-level value must equal \`partitionAudit.partitionHash\` and recomputed value |
| \`invalidVoteDiagnostics[]\` | Per-vote rejection evidence | each evidenceHash must recompute from voteId, tokenHash, reason, detail |
| \`diagnosticsHash\` | Compact binding for diagnostics | must recompute from sorted diagnostics array |
| \`publicInputHints\` | B-track proof/report binding hints | electionIdHash, tallyHash, roots, partitionHash, diagnosticsHash must match report |
| \`proofStatus\` / \`tallyProofSummary\` | B-track proof placeholder | A exports \`not-generated\` until B supplies a tally proof |
| \`export_bundle_v2.sample.json\` | Cross-track artifact envelope | must include AggregatorReport, publicInputs, zkSummary, tallyProofSummary, chainAudit, challengeRecords, and demoMetadata |
| \`auditHash\` | Report-level tamper evidence | must recompute from AggregatorReport v2 core fields |
| \`integrityCheck\` | Machine-readable self-verification result | \`verified=true\` only when every A-track invariant passes |

## Offline Verification

\`\`\`bash
pnpm aggregator:verify
\`\`\`

The offline verifier checks every generated report file without reading
in-memory votes. It also creates negative tamper cases for malformed shape,
\`auditHash\`, bucket \`voteCount\`, bucket \`tokenHashes\`, \`validVoteIds\`,
\`duplicateTokenHashes\`, \`diagnosticsHash\`, \`publicInputHints.validVotes\`,
and \`pedersenAggregateHash\`; each one must fail with the expected
integrity-check key.

## API Smoke

\`\`\`bash
pnpm aggregator:api-smoke
\`\`\`

The smoke script starts the backend in memory mode on an isolated local port,
creates fresh 4-candidate/8-vote elections, and verifies:

- \`POST /aggregator/elections/:id/run\`
- \`GET /aggregator/elections/:id/report\`
- \`GET /elections/:id/export/aggregator_report.json\`
- \`GET /elections/:id/export/public_inputs.json\`
- \`POST /attack/elections/:id/inject-duplicate-vote\`
- \`POST /attack/elections/:id/inject-invalid-vote\`
- \`POST /attack/elections/:id/inject-non-one-hot-vote\`
- \`POST /attack/elections/:id/inject-candidate-vector-mismatch\`
- \`POST /attack/elections/:id/tamper-commitment\`
- \`POST /attack/elections/:id/delete-vote\`
- \`POST /attack/elections/:id/tamper-tally\`, as a saved-report negative case where \`auditHash\` is recomputed but integrity and tally consistency must fail
- \`report.partitionAudit.partitionHash === report.partitionHash\`
- \`report.validVoteIds\` exactly equals all bucket \`voteIds\`
- \`report.invalidVoteIds\` exactly equals diagnostic \`voteId\` values
- every \`bucket.tokenRoot\` recomputes from \`bucket.tokenHashes\`
- \`report.publicInputHints.partitionHash === report.partitionHash\`
- \`report.publicInputHints.diagnosticsHash === report.diagnosticsHash\`
- \`integrityCheck.verified === true\` for freshly generated reports

It then starts the backend in SQLite mode, writes an AggregatorReport v2,
restarts the API with the same database, reloads \`/aggregator/elections/:id/report\`,
and checks that \`validVoteIds\`, \`invalidVoteIds\`, per-bucket \`tokenHashes\`,
\`auditHash\`, every AggregatorReport v2 persistence field, and
\`integrityCheck.verified\` survive persistence round-trip.

The machine-readable result is \`docs/evaluation/aggregator_reports/api_smoke.json\`.

## PowerShell API Acceptance

\`\`\`powershell
pnpm dev:api
pnpm aggregator:ps-smoke
\`\`\`

This is the A.5 no-frontend path for Windows/PowerShell reviewers. It uses
\`Invoke-RestMethod\` to create elections, candidates, users, and votes through
the running API, calls each attack endpoint, runs the aggregator, and writes
\`aggregator_report.normal.json\`, \`aggregator_report.attack-*.json\`,
\`public_inputs.normal.json\`, \`export_bundle.normal.json\`, and
\`manifest.json\` under \`docs/evaluation/aggregator_reports/powershell_api/\`.
It fails if any report lacks \`partitionAudit\`, vote-id accounting,
per-bucket \`tokenHashes\`, \`proofStatus=not-generated\`, or a verified
\`integrityCheck\`.

## Local Standalone Export

\`\`\`bash
pnpm aggregator:local-export
\`\`\`

This command is the no-server A-track path. It creates the deterministic
4-candidate/8-vote fixture in memory, runs \`createAggregatorReport\`, verifies
\`integrityCheck.verified=true\`, and writes AggregatorReport v2, public inputs,
ExportBundleV2, and a manifest under
\`docs/evaluation/aggregator_reports/local_standalone/\`. It exists so A can be
accepted even when the frontend and API server are unavailable.

## Boundary

This is an Aggios-inspired partition audit surface. It does not claim a complete
EPA circuit or production privacy proof. The contest evidence is the reproducible
JSON/API audit layer: partition completeness, mutual exclusion, duplicate
diagnostics, invalid vote exclusion, and proof-binding hashes.
`;
}

mkdirSync(contractsDir, { recursive: true });
mkdirSync(reportDir, { recursive: true });

const cases: CaseDefinition[] = [
  {
    name: "normal",
    description: "8 valid votes across 4 candidates.",
    expectation: {
      totalVotes: 8,
      validVotes: 8,
      invalidVotes: 0,
      duplicateVotes: 0,
      receiptChainVerified: true,
      requiredReasons: []
    }
  },
  {
    name: "duplicate-token",
    description: "One extra vote reuses the first voter's token.",
    mutate: (fixture) => addDuplicateVote(fixture.fixtureVotes[0]),
    expectation: {
      totalVotes: 9,
      validVotes: 8,
      invalidVotes: 1,
      duplicateVotes: 1,
      receiptChainVerified: true,
      requiredReasons: ["duplicate-token"]
    }
  },
  {
    name: "invalid-candidate",
    description: "One vote has a legal one-hot vector but an unknown candidateId.",
    mutate: (fixture) => addInvalidCandidateVote(fixture.election),
    expectation: {
      totalVotes: 9,
      validVotes: 8,
      invalidVotes: 1,
      duplicateVotes: 0,
      receiptChainVerified: true,
      requiredReasons: ["invalid-candidate"]
    }
  },
  {
    name: "non-one-hot",
    description: "One vote selects two candidates in the vote vector.",
    mutate: (fixture) =>
      addNonOneHotVote(fixture.election, fixture.fixtureCandidates),
    expectation: {
      totalVotes: 9,
      validVotes: 8,
      invalidVotes: 1,
      duplicateVotes: 0,
      receiptChainVerified: true,
      requiredReasons: ["invalid-one-hot"]
    }
  },
  {
    name: "candidate-vector-mismatch",
    description: "One vote has a valid candidateId but the one-hot vector points elsewhere.",
    mutate: (fixture) =>
      addCandidateVectorMismatchVote(fixture.election, fixture.fixtureCandidates),
    expectation: {
      totalVotes: 9,
      validVotes: 8,
      invalidVotes: 1,
      duplicateVotes: 0,
      receiptChainVerified: true,
      requiredReasons: ["candidate-vector-mismatch"]
    }
  },
  {
    name: "commitment-tamper",
    description: "The first vote commitment is modified after casting.",
    mutate: (fixture) => tamperCommitment(fixture.fixtureVotes[0]),
    expectation: {
      totalVotes: 8,
      validVotes: 7,
      invalidVotes: 1,
      duplicateVotes: 0,
      receiptChainVerified: false,
      requiredReasons: ["commitment-opening-failed", "receipt-chain-break"]
    }
  },
  {
    name: "receipt-chain-delete",
    description: "The first vote is removed, creating a conservative chain break.",
    mutate: (fixture) => deleteFirstVote(fixture.fixtureVotes[0]),
    expectation: {
      totalVotes: 7,
      validVotes: 0,
      invalidVotes: 7,
      duplicateVotes: 0,
      receiptChainVerified: false,
      requiredReasons: ["receipt-chain-break"]
    }
  }
];

const normalFixture = createFixture();
const normalReport = createAggregatorReport(normalFixture.election.id);
aggregatorReports.push(normalReport);
const normalIntegrityCheck = verifyAggregatorReportIntegrity(normalReport);
assertExpectedReport("contract-sample-normal", normalReport, cases[0].expectation, normalIntegrityCheck);
const pedersenNullReport = createPedersenNullReport(normalReport);
const pedersenNullIntegrityCheck =
  verifyAggregatorReportIntegrity(pedersenNullReport);
assertCase(
  "contract-sample-pedersen-null integrity",
  pedersenNullIntegrityCheck.verified &&
    pedersenNullReport.pedersenAggregateAudit === null &&
    pedersenNullReport.pedersenAggregateStatus === "pending" &&
    pedersenNullReport.pedersenAggregateHash === null &&
    pedersenNullReport.publicInputHints.pedersenAggregateHash === null,
  {
    failures: pedersenNullIntegrityCheck.failures,
    pedersenAggregateAudit: pedersenNullReport.pedersenAggregateAudit,
    pedersenAggregateStatus: pedersenNullReport.pedersenAggregateStatus,
    pedersenAggregateHash: pedersenNullReport.pedersenAggregateHash,
    publicInputHints: pedersenNullReport.publicInputHints
  }
);

const publicInputs = createPublicInputsArtifact({
  election: {
    ...normalFixture.election,
    candidates: normalFixture.fixtureCandidates
  },
  bulletin: createBulletinBoard(normalFixture.election.id),
  report: normalReport
});
assertCase(
  "public_inputs_v2.sample binds normal report",
  publicInputs.partitionHash === normalReport.partitionHash &&
    publicInputs.diagnosticsHash === normalReport.diagnosticsHash &&
    publicInputs.auditHash === normalReport.auditHash &&
    publicInputs.validVotes === normalReport.validVotes,
  { publicInputs }
);
const exportBundle = buildExportBundle(buildArtifactContext(normalFixture.election));
assertCase(
  "export_bundle_v2.sample includes A/B/D boundary placeholders",
  exportBundle.aggregatorReport?.auditHash === normalReport.auditHash &&
    exportBundle.tallyProofSummary.proofStatus === "not-generated" &&
    exportBundle.tallyProofSummary.proofId === null &&
    exportBundle.demoMetadata.demoSeedFile ===
      "docs/contracts/demo_seed_fixture.json" &&
    exportBundle.chainAudit.status === "not_submitted",
  {
    aggregatorAuditHash: exportBundle.aggregatorReport?.auditHash,
    tallyProofSummary: exportBundle.tallyProofSummary,
    demoMetadata: exportBundle.demoMetadata,
    chainAudit: exportBundle.chainAudit
  }
);

writeJson(join(contractsDir, "aggregator_report_v2.sample.json"), {
  schemaVersion: "verivote.aggregator-report.v2.sample",
  ...normalReport,
  integrityCheck: normalIntegrityCheck,
  fixtureDerived: {
    source: "scripts/aggregator-audit-cases.ts"
  }
});
writeJson(join(contractsDir, "aggregator_report.sample.json"), {
  schemaVersion: "verivote.aggregator-report.v2.sample",
  sampleAliasFor: "docs/contracts/aggregator_report_v2.sample.json",
  ...normalReport,
  integrityCheck: normalIntegrityCheck,
  fixtureDerived: {
    source: "scripts/aggregator-audit-cases.ts"
  }
});
writeJson(join(contractsDir, "aggregator_report_pedersen_null.sample.json"), {
  schemaVersion: "verivote.aggregator-report.v2.pedersen-null.sample",
  samplePurpose:
    "A-track export remains independently verifiable when C-track Pedersen aggregate audit is pending/not generated yet.",
  ...pedersenNullReport,
  integrityCheck: pedersenNullIntegrityCheck,
  fixtureDerived: {
    source: "scripts/aggregator-audit-cases.ts",
    baseSample: "docs/contracts/aggregator_report_v2.sample.json"
  }
});
writeJson(join(contractsDir, "export_bundle_v2.sample.json"), exportBundle);
writeJson(
  join(contractsDir, "valid_vote_records_8x4.sample.json"),
  createValidVoteRecords(normalFixture)
);
writeJson(
  join(contractsDir, "demo_seed_fixture.json"),
  createDemoSeedFixture(normalFixture)
);
writeJson(join(contractsDir, "public_inputs_v2.sample.json"), publicInputs);

const summaries = cases.map((caseDefinition) => writeCase(caseDefinition).summary);

writeJson(join(reportDir, "summary.json"), {
  schemaVersion: "verivote.aggregator-audit-summary.v2",
  generatedBy: "pnpm aggregator:audit-cases",
  caseCount: summaries.length,
  allIntegrityVerified: summaries.every((summary) => summary.integrityVerified),
  cases: summaries
});
writeFileSync(
  join(evaluationDir, "AGGREGATOR_AUDIT_CASES.md"),
  createCaseMarkdown(summaries),
  "utf8"
);

console.log(`Wrote AggregatorReport v2 evidence to ${reportDir}`);
