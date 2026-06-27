import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAggregatorReportIntegrity } from "../apps/api/src/utils.ts";
import type {
  AggregatorReport,
  AggregatorReportIntegrityCheck
} from "../packages/shared/src/index.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const reportDir = join(projectRoot, "docs", "evaluation", "aggregator_reports");
const contractsDir = join(projectRoot, "docs", "contracts");

interface VerificationCase {
  name: string;
  file: string;
  expectedReasons: string[];
  expectedValidVotes: number;
  expectedInvalidVotes: number;
}

interface OfflineVerificationResult {
  name: string;
  file: string;
  integrityVerified: boolean;
  failures: string[];
  validVotes: number;
  validVoteIds: string[];
  invalidVotes: number;
  invalidVoteIds: string[];
  proofStatus: string;
  diagnosticReasons: string[];
  auditHash: string;
  partitionHash: string;
  diagnosticsHash: string;
}

interface TamperCaseResult {
  name: string;
  expectedFailure: string;
  verified: boolean;
  failures: string[];
}

interface SavedTamperReportResult {
  name: string;
  file: string;
  endpoint: string | null;
  reportEndpoint: string | null;
  storedIntegrityVerified: boolean | null;
  offlineIntegrityVerified: boolean;
  storedFailures: string[];
  offlineFailures: string[];
  auditHashMatches: boolean;
  expectedFailures: string[];
  tallyConsistent: boolean | null;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripSampleEnvelope(value: unknown): AggregatorReport {
  const report = cloneJson(value) as Record<string, unknown>;
  delete report.schemaVersion;
  delete report.fixtureDerived;
  delete report.integrityCheck;
  delete report.sampleKind;
  delete report.generatedBy;
  return report as unknown as AggregatorReport;
}

function readReport(filePath: string): AggregatorReport {
  return stripSampleEnvelope(readJson<unknown>(filePath));
}

function readReportEnvelope(filePath: string): {
  report: AggregatorReport;
  envelope: Record<string, any>;
} {
  const envelope = readJson<Record<string, any>>(filePath);
  return {
    report: stripSampleEnvelope(envelope.report ?? envelope),
    envelope
  };
}

function diagnosticReasons(report: AggregatorReport): string[] {
  return Array.from(
    new Set(report.invalidVoteDiagnostics.map((diagnostic) => diagnostic.reason))
  ).sort();
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function equalStringSet(left: string[], right: string[]): boolean {
  const leftSorted = sortedUnique(left);
  const rightSorted = sortedUnique(right);

  return (
    left.length === leftSorted.length &&
    right.length === rightSorted.length &&
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

function assertReportCase(
  verificationCase: VerificationCase,
  report: AggregatorReport,
  integrityCheck: AggregatorReportIntegrityCheck
): OfflineVerificationResult {
  assertCase(`${verificationCase.name}: offline integrity`, integrityCheck.verified, {
    failures: integrityCheck.failures
  });
  assertCase(
    `${verificationCase.name}: validVotes`,
    report.validVotes === verificationCase.expectedValidVotes,
    {
      actual: report.validVotes,
      expected: verificationCase.expectedValidVotes
    }
  );
  assertCase(
    `${verificationCase.name}: invalidVotes`,
    report.invalidVotes === verificationCase.expectedInvalidVotes,
    {
      actual: report.invalidVotes,
      expected: verificationCase.expectedInvalidVotes
    }
  );
  assertCase(
    `${verificationCase.name}: validVoteIds`,
    report.validVoteIds.length === verificationCase.expectedValidVotes &&
      equalStringSet(
        report.validVoteIds,
        report.partitionAudit.buckets.flatMap((bucket) => bucket.voteIds)
      ),
    {
      validVoteIds: report.validVoteIds,
      bucketVoteIds: report.partitionAudit.buckets.flatMap((bucket) => bucket.voteIds)
    }
  );
  assertCase(
    `${verificationCase.name}: invalidVoteIds`,
    report.invalidVoteIds.length === verificationCase.expectedInvalidVotes &&
      equalStringSet(
        report.invalidVoteIds,
        sortedUnique(
          report.invalidVoteDiagnostics.map((diagnostic) => diagnostic.voteId)
        )
      ),
    {
      invalidVoteIds: report.invalidVoteIds,
      diagnosticVoteIds: sortedUnique(
        report.invalidVoteDiagnostics.map((diagnostic) => diagnostic.voteId)
      )
    }
  );
  assertCase(
    `${verificationCase.name}: invalid ids excluded from buckets`,
    report.invalidVoteIds.every(
      (voteId) =>
        !report.partitionAudit.buckets.some((bucket) =>
          bucket.voteIds.includes(voteId)
        )
    ),
    {
      invalidVoteIds: report.invalidVoteIds,
      bucketVoteIds: report.partitionAudit.buckets.flatMap((bucket) => bucket.voteIds)
    }
  );
  assertCase(
    `${verificationCase.name}: tally proof placeholder`,
    report.proofStatus === "not-generated" &&
      report.tallyProofSummary?.proofStatus === "not-generated" &&
      report.tallyProofSummary.proofId === null,
    {
      proofStatus: report.proofStatus,
      tallyProofSummary: report.tallyProofSummary
    }
  );

  const reasons = diagnosticReasons(report);
  for (const reason of verificationCase.expectedReasons) {
    assertCase(`${verificationCase.name}: reason ${reason}`, reasons.includes(reason), {
      reasons
    });
  }

  return {
    name: verificationCase.name,
    file: verificationCase.file,
    integrityVerified: integrityCheck.verified,
    failures: integrityCheck.failures,
    validVotes: report.validVotes,
    validVoteIds: report.validVoteIds,
    invalidVotes: report.invalidVotes,
    invalidVoteIds: report.invalidVoteIds,
    proofStatus: report.proofStatus,
    diagnosticReasons: reasons,
    auditHash: report.auditHash,
    partitionHash: report.partitionHash,
    diagnosticsHash: report.diagnosticsHash
  };
}

function expectTamperFailure(
  name: string,
  report: unknown,
  expectedFailure: keyof AggregatorReportIntegrityCheck["checks"]
): TamperCaseResult {
  const integrityCheck = verifyAggregatorReportIntegrity(report);
  assertCase(`${name}: tamper is rejected`, !integrityCheck.verified, {
    failures: integrityCheck.failures
  });
  assertCase(
    `${name}: expected ${expectedFailure}`,
    integrityCheck.failures.includes(expectedFailure),
    { failures: integrityCheck.failures }
  );
  return {
    name,
    expectedFailure,
    verified: integrityCheck.verified,
    failures: integrityCheck.failures
  };
}

function createTamperCases(normalReport: AggregatorReport): TamperCaseResult[] {
  const malformedReport = cloneJson(normalReport) as Record<string, unknown>;
  delete malformedReport.partitionAudit;

  const tamperedAuditHash = cloneJson(normalReport);
  tamperedAuditHash.auditHash = "0".repeat(64);

  const tamperedBucket = cloneJson(normalReport);
  tamperedBucket.partitionAudit.buckets[0].voteCount += 1;

  const tamperedBucketTokenHashes = cloneJson(normalReport);
  tamperedBucketTokenHashes.partitionAudit.buckets[0].tokenHashes[0] =
    "9".repeat(64);

  const tamperedValidVoteIds = cloneJson(normalReport);
  tamperedValidVoteIds.validVoteIds = tamperedValidVoteIds.validVoteIds
    .slice(1)
    .concat("vote_not_in_bucket");

  const tamperedDuplicateTokenHashes = cloneJson(normalReport);
  tamperedDuplicateTokenHashes.duplicateTokenHashes = ["8".repeat(64)];

  const tamperedDiagnosticHash = cloneJson(normalReport);
  tamperedDiagnosticHash.diagnosticsHash = "1".repeat(64);

  const tamperedPublicHints = cloneJson(normalReport);
  tamperedPublicHints.publicInputHints.validVotes += 1;

  const tamperedPedersenHash = cloneJson(normalReport);
  tamperedPedersenHash.pedersenAggregateHash = "2".repeat(64);

  const tamperedPedersenStatus = cloneJson(normalReport);
  tamperedPedersenStatus.pedersenAggregateStatus =
    tamperedPedersenStatus.pedersenAggregateStatus === "verified"
      ? "pending"
      : "verified";

  const tamperedTallyProofSummary = cloneJson(normalReport);
  if (tamperedTallyProofSummary.tallyProofSummary) {
    tamperedTallyProofSummary.tallyProofSummary.message = "tampered proof summary";
  }

  return [
    expectTamperFailure(
      "malformed missing partitionAudit",
      malformedReport,
      "fieldShapeValid"
    ),
    expectTamperFailure(
      "tamper auditHash",
      tamperedAuditHash,
      "auditHashMatches"
    ),
    expectTamperFailure(
      "tamper bucket voteCount",
      tamperedBucket,
      "bucketVoteCountsMatch"
    ),
    expectTamperFailure(
      "tamper bucket tokenHashes",
      tamperedBucketTokenHashes,
      "bucketTokenRootsMatchTokenHashes"
    ),
    expectTamperFailure(
      "tamper validVoteIds",
      tamperedValidVoteIds,
      "validVoteIdsMatchBuckets"
    ),
    expectTamperFailure(
      "tamper duplicateTokenHashes",
      tamperedDuplicateTokenHashes,
      "duplicateTokenHashesMatchDiagnostics"
    ),
    expectTamperFailure(
      "tamper diagnosticsHash",
      tamperedDiagnosticHash,
      "diagnosticsHashMatches"
    ),
    expectTamperFailure(
      "tamper publicInputHints.validVotes",
      tamperedPublicHints,
      "publicInputHintsMatch"
    ),
    expectTamperFailure(
      "tamper pedersenAggregateHash",
      tamperedPedersenHash,
      "pedersenAggregateHashMatches"
    ),
    expectTamperFailure(
      "tamper pedersenAggregateStatus",
      tamperedPedersenStatus,
      "pedersenAggregateStatusMatches"
    ),
    expectTamperFailure(
      "tamper tallyProofSummary",
      tamperedTallyProofSummary,
      "auditHashMatches"
    )
  ];
}

function verifySavedApiTamperReport(): SavedTamperReportResult {
  const file = join(reportDir, "api_aggregator_report.attack-tamper-tally.json");
  const expectedFailures = [
    "bucketTallyMatches",
    "tallyTotalMatchesValidVotes",
    "tallySumMatchesValidVotes"
  ];

  assertCase("saved API tamper tally evidence exists", existsSync(file), { file });
  const { report, envelope } = readReportEnvelope(file);
  const integrityCheck = verifyAggregatorReportIntegrity(report);
  const storedIntegrity = envelope.integrityCheck as
    | AggregatorReportIntegrityCheck
    | undefined;

  assertCase(
    "saved API tamper tally: offline integrity rejects report",
    integrityCheck.verified === false,
    { failures: integrityCheck.failures }
  );
  assertCase(
    "saved API tamper tally: audit hash still matches",
    integrityCheck.checks.auditHashMatches === true,
    { checks: integrityCheck.checks }
  );
  for (const failure of expectedFailures) {
    assertCase(
      `saved API tamper tally: offline failure ${failure}`,
      integrityCheck.failures.includes(failure),
      { failures: integrityCheck.failures }
    );
  }
  if (storedIntegrity) {
    assertCase(
      "saved API tamper tally: stored and offline verification agree",
      storedIntegrity.verified === integrityCheck.verified &&
        equalStringSet(storedIntegrity.failures, integrityCheck.failures),
      {
        stored: storedIntegrity.failures,
        offline: integrityCheck.failures
      }
    );
  }

  return {
    name: "api-tamper-tally",
    file: `docs/evaluation/aggregator_reports/${basename(file)}`,
    endpoint: envelope.endpoint ?? null,
    reportEndpoint: envelope.reportEndpoint ?? null,
    storedIntegrityVerified: storedIntegrity?.verified ?? null,
    offlineIntegrityVerified: integrityCheck.verified,
    storedFailures: storedIntegrity?.failures ?? [],
    offlineFailures: integrityCheck.failures,
    auditHashMatches: integrityCheck.checks.auditHashMatches,
    expectedFailures,
    tallyConsistent:
      typeof envelope.tallyConsistent === "boolean" ? envelope.tallyConsistent : null
  };
}

const verificationCases: VerificationCase[] = [
  {
    name: "normal",
    file: join(reportDir, "aggregator_report.normal.json"),
    expectedReasons: [],
    expectedValidVotes: 8,
    expectedInvalidVotes: 0
  },
  {
    name: "duplicate-token",
    file: join(reportDir, "aggregator_report.duplicate-token.json"),
    expectedReasons: ["duplicate-token"],
    expectedValidVotes: 8,
    expectedInvalidVotes: 1
  },
  {
    name: "invalid-candidate",
    file: join(reportDir, "aggregator_report.invalid-candidate.json"),
    expectedReasons: ["invalid-candidate"],
    expectedValidVotes: 8,
    expectedInvalidVotes: 1
  },
  {
    name: "non-one-hot",
    file: join(reportDir, "aggregator_report.non-one-hot.json"),
    expectedReasons: ["invalid-one-hot"],
    expectedValidVotes: 8,
    expectedInvalidVotes: 1
  },
  {
    name: "candidate-vector-mismatch",
    file: join(reportDir, "aggregator_report.candidate-vector-mismatch.json"),
    expectedReasons: ["candidate-vector-mismatch"],
    expectedValidVotes: 8,
    expectedInvalidVotes: 1
  },
  {
    name: "commitment-tamper",
    file: join(reportDir, "aggregator_report.commitment-tamper.json"),
    expectedReasons: ["commitment-opening-failed", "receipt-chain-break"],
    expectedValidVotes: 7,
    expectedInvalidVotes: 1
  },
  {
    name: "receipt-chain-delete",
    file: join(reportDir, "aggregator_report.receipt-chain-delete.json"),
    expectedReasons: ["receipt-chain-break"],
    expectedValidVotes: 0,
    expectedInvalidVotes: 7
  }
];

const results: OfflineVerificationResult[] = [];

for (const verificationCase of verificationCases) {
  assertCase(
    `${verificationCase.name}: evidence file exists`,
    existsSync(verificationCase.file),
    { file: verificationCase.file }
  );
  const report = readReport(verificationCase.file);
  const integrityCheck = verifyAggregatorReportIntegrity(report);
  results.push(assertReportCase(verificationCase, report, integrityCheck));
}

const sampleReportFile = join(contractsDir, "aggregator_report_v2.sample.json");
assertCase("contract sample exists", existsSync(sampleReportFile), {
  file: sampleReportFile
});
const sampleReport = readReport(sampleReportFile);
const sampleIntegrity = verifyAggregatorReportIntegrity(sampleReport);
assertCase("contract sample offline integrity", sampleIntegrity.verified, {
  failures: sampleIntegrity.failures
});
const pedersenNullSampleFile = join(
  contractsDir,
  "aggregator_report_pedersen_null.sample.json"
);
assertCase("pedersen null contract sample exists", existsSync(pedersenNullSampleFile), {
  file: pedersenNullSampleFile
});
const pedersenNullSample = readReport(pedersenNullSampleFile);
const pedersenNullIntegrity =
  verifyAggregatorReportIntegrity(pedersenNullSample);
assertCase("pedersen null contract sample offline integrity", pedersenNullIntegrity.verified, {
  failures: pedersenNullIntegrity.failures
});
assertCase(
  "pedersen null contract sample binds null state",
  pedersenNullSample.pedersenAggregateAudit === null &&
    pedersenNullSample.pedersenAggregateStatus === "pending" &&
    pedersenNullSample.pedersenAggregateHash === null &&
    pedersenNullSample.publicInputHints.pedersenAggregateHash === null,
  {
    pedersenAggregateAudit: pedersenNullSample.pedersenAggregateAudit,
    pedersenAggregateStatus: pedersenNullSample.pedersenAggregateStatus,
    pedersenAggregateHash: pedersenNullSample.pedersenAggregateHash,
    publicInputHints: pedersenNullSample.publicInputHints
  }
);

const normalReport = readReport(join(reportDir, "aggregator_report.normal.json"));
const tamperCases = createTamperCases(normalReport);
const savedApiTamperReport = verifySavedApiTamperReport();

writeJson(join(reportDir, "offline_verification.json"), {
  schemaVersion: "verivote.aggregator-offline-verification.v1",
  generatedBy: "pnpm aggregator:verify",
  verifiedFiles: results.map((result) => ({
    ...result,
    file: `docs/evaluation/aggregator_reports/${basename(result.file)}`
  })),
  contractSample: {
    file: "docs/contracts/aggregator_report_v2.sample.json",
    integrityVerified: sampleIntegrity.verified,
    failures: sampleIntegrity.failures,
    auditHash: sampleReport.auditHash,
    proofStatus: sampleReport.proofStatus
  },
  pedersenNullContractSample: {
    file: "docs/contracts/aggregator_report_pedersen_null.sample.json",
    integrityVerified: pedersenNullIntegrity.verified,
    failures: pedersenNullIntegrity.failures,
    auditHash: pedersenNullSample.auditHash,
    pedersenAggregateAudit: pedersenNullSample.pedersenAggregateAudit,
    pedersenAggregateStatus: pedersenNullSample.pedersenAggregateStatus,
    pedersenAggregateHash: pedersenNullSample.pedersenAggregateHash
  },
  tamperCases,
  savedApiTamperReport
});

console.log(`Verified ${results.length} AggregatorReport v2 evidence files.`);
