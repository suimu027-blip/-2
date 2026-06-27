import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCommitment,
  createReceiptCode,
  createVoteVector
} from "../packages/crypto/src/index.ts";
import {
  aggregatorReports,
  attackLogs,
  bulletinBoards,
  candidates,
  challengeRecords,
  blockchainAuditRecords,
  counters,
  elections,
  pendingBallots,
  users,
  votes
} from "../apps/api/src/state.ts";
import {
  appendVoteWithReceiptChain,
  buildArtifactContext,
  buildExportBundle,
  createAggregatorReport,
  createBulletinBoard,
  createPublicInputsArtifact,
  verifyAggregatorReportIntegrity
} from "../apps/api/src/utils.ts";
import type { Candidate, Election, User, Vote } from "../packages/shared/src/index.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultOutputDir = join(
  projectRoot,
  "docs",
  "evaluation",
  "aggregator_reports",
  "local_standalone"
);

interface Fixture {
  election: Election;
  fixtureCandidates: Candidate[];
  fixtureUsers: User[];
  fixtureVotes: Vote[];
}

function getArg(name: string): string | null {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) {
    return exact.slice(name.length + 1);
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
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

function fixedRandomness(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function createStandaloneFixture(): Fixture {
  resetState();

  const election: Election = {
    id: "election_local_export_8x4",
    title: "VeriVote Local Aggregator Export Fixture",
    description:
      "Standalone A-track fixture generated without starting the API server.",
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
    name: `Local Export User ${index + 1}`,
    createdAt: "2026-06-26T00:00:00.000Z"
  }));
  users.push(...fixtureUsers);

  const candidateIds = fixtureCandidates.map((candidate) => candidate.id);
  const fixtureVotes = fixtureUsers.map((user, index) => {
    const candidateId = candidateIds[index % candidateIds.length];
    const voteVector = createVoteVector(candidateIds, candidateId);
    const randomness = fixedRandomness(index + 1);
    const createdAt = new Date(Date.UTC(2026, 5, 26, 2, index, 0)).toISOString();
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

  counters.election = 1;
  counters.candidate = fixtureCandidates.length;
  counters.user = fixtureUsers.length;
  counters.vote = fixtureVotes.length;

  return {
    election,
    fixtureCandidates,
    fixtureUsers,
    fixtureVotes
  };
}

const outputDir = getArg("--out-dir") ?? defaultOutputDir;
mkdirSync(outputDir, { recursive: true });

const fixture = createStandaloneFixture();
const report = createAggregatorReport(fixture.election.id);
const integrityCheck = verifyAggregatorReportIntegrity(report);
if (!integrityCheck.verified) {
  throw new Error(
    `local AggregatorReport integrity failed: ${integrityCheck.failures.join(", ")}`
  );
}

aggregatorReports.push(report);
const bulletin = createBulletinBoard(fixture.election.id);
const publicInputs = createPublicInputsArtifact({
  election: {
    ...fixture.election,
    candidates: fixture.fixtureCandidates
  },
  bulletin,
  report
});
const exportBundle = buildExportBundle(buildArtifactContext(fixture.election));

const reportFile = join(outputDir, "aggregator_report.local-normal.json");
const publicInputsFile = join(outputDir, "public_inputs.local-normal.json");
const bundleFile = join(outputDir, "export_bundle.local-normal.json");
const manifestFile = join(outputDir, "manifest.json");

writeJson(reportFile, {
  schemaVersion: "verivote.aggregator-report.v2.local-standalone",
  generatedBy: "pnpm aggregator:local-export",
  serverRequired: false,
  ...report,
  integrityCheck
});
writeJson(publicInputsFile, publicInputs);
writeJson(bundleFile, exportBundle);
writeJson(manifestFile, {
  schemaVersion: "verivote.aggregator-local-export-manifest.v1",
  generatedBy: "pnpm aggregator:local-export",
  serverRequired: false,
  fixture: {
    electionId: fixture.election.id,
    candidateCount: fixture.fixtureCandidates.length,
    userCount: fixture.fixtureUsers.length,
    voteCount: fixture.fixtureVotes.length
  },
  report: {
    file: "aggregator_report.local-normal.json",
    auditHash: report.auditHash,
    partitionHash: report.partitionHash,
    diagnosticsHash: report.diagnosticsHash,
    proofStatus: report.proofStatus,
    integrityVerified: integrityCheck.verified
  },
  publicInputs: {
    file: "public_inputs.local-normal.json",
    auditHash: publicInputs.auditHash,
    partitionHash: publicInputs.partitionHash,
    diagnosticsHash: publicInputs.diagnosticsHash
  },
  exportBundle: {
    file: "export_bundle.local-normal.json",
    schemaVersion: exportBundle.envelope.schemaVersion,
    proofStatus: exportBundle.tallyProofSummary.proofStatus,
    chainAuditStatus: exportBundle.chainAudit.status
  }
});

console.log(`Wrote standalone AggregatorReport v2 export to ${outputDir}`);
