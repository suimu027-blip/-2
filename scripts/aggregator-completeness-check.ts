import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const contractsDir = join(projectRoot, "docs", "contracts");
const evaluationDir = join(projectRoot, "docs", "evaluation");
const reportDir = join(evaluationDir, "aggregator_reports");
const localStandaloneDir = join(reportDir, "local_standalone");
const powershellApiDir = join(reportDir, "powershell_api");

interface CompletenessItem {
  id: string;
  description: string;
  evidence: string;
  passed: boolean;
  details?: unknown;
}

interface TraceabilityItem {
  id: string;
  requirement: string;
  sourceFiles: string[];
  evidenceFiles: string[];
  commands: string[];
  apiEndpoints: string[];
  passed: boolean;
  missingFiles: string[];
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativePath(filePath: string): string {
  return filePath
    .replace(`${projectRoot}\\`, "")
    .replace(`${projectRoot}/`, "")
    .replaceAll("\\", "/");
}

function checkFile(id: string, description: string, filePath: string): CompletenessItem {
  return {
    id,
    description,
    evidence: relativePath(filePath),
    passed: existsSync(filePath)
  };
}

function checkJson(
  id: string,
  description: string,
  filePath: string,
  predicate: (value: any) => boolean,
  details?: (value: any) => unknown
): CompletenessItem {
  if (!existsSync(filePath)) {
    return {
      id,
      description,
      evidence: relativePath(filePath),
      passed: false,
      details: "missing file"
    };
  }

  const value = readJson<any>(filePath);
  return {
    id,
    description,
    evidence: relativePath(filePath),
    passed: predicate(value),
    details: details?.(value)
  };
}

function checkSourceContains(
  id: string,
  description: string,
  filePaths: string[],
  tokens: string[]
): CompletenessItem {
  const missingFiles = filePaths.filter((filePath) => !existsSync(filePath));
  const source = filePaths
    .filter((filePath) => existsSync(filePath))
    .map((filePath) => readFileSync(filePath, "utf8"))
    .join("\n");
  const missingTokens = tokens.filter((token) => !source.includes(token));
  return {
    id,
    description,
    evidence: filePaths.map(relativePath).join(", "),
    passed: missingFiles.length === 0 && missingTokens.length === 0,
    details: {
      missingFiles: missingFiles.map(relativePath),
      requiredTokens: tokens,
      missingTokens
    }
  };
}

function sortedKeys(value: any): string[] {
  return Object.keys(value ?? {}).sort();
}

function normalizeReport(value: any): any {
  const report = value?.report ?? value;
  const clone = JSON.parse(JSON.stringify(report ?? {}));
  for (const key of [
    "schemaVersion",
    "fixtureDerived",
    "integrityCheck",
    "sampleKind",
    "generatedBy",
    "sampleAliasFor",
    "tallyConsistent",
    "consistencyMessage"
  ]) {
    delete clone[key];
  }
  return clone;
}

function extractIntegrityChecks(value: any): any {
  return value?.integrityCheck?.checks ?? value?.report?.integrityCheck?.checks ?? {};
}

function compareKeys(left: any, right: any): {
  leftOnly: string[];
  rightOnly: string[];
  equal: boolean;
} {
  const leftKeys = sortedKeys(left);
  const rightKeys = sortedKeys(right);
  const rightSet = new Set(rightKeys);
  const leftSet = new Set(leftKeys);
  const leftOnly = leftKeys.filter((key) => !rightSet.has(key));
  const rightOnly = rightKeys.filter((key) => !leftSet.has(key));
  return {
    leftOnly,
    rightOnly,
    equal: leftOnly.length === 0 && rightOnly.length === 0
  };
}

const requiredReportCases = [
  "normal",
  "duplicate-token",
  "invalid-candidate",
  "non-one-hot",
  "candidate-vector-mismatch",
  "commitment-tamper",
  "receipt-chain-delete"
];

const requiredAttackAliasFiles = requiredReportCases
  .filter((name) => name !== "normal")
  .map((name) => `aggregator_report.attack-${name}.json`);

const requiredApiReportFiles = requiredReportCases.map(
  (name) => `api_aggregator_report.${name}.json`
);

const requiredApiAttackAliasFiles = requiredReportCases
  .filter((name) => name !== "normal")
  .map((name) => `api_aggregator_report.attack-${name}.json`);

const requiredPersistentReportFields = [
  "electionId",
  "totalVotes",
  "validVotes",
  "validVoteIds",
  "invalidVotes",
  "invalidVoteIds",
  "duplicateVotes",
  "proofStatus",
  "tallyProofSummary",
  "receiptChainVerified",
  "receiptChainBreaks",
  "voteTokenHashes",
  "duplicateTokenHashes",
  "tallyResult",
  "commitmentRoot",
  "receiptRoot",
  "partitionAudit",
  "partitionHash",
  "invalidVoteDiagnostics",
  "diagnosticsHash",
  "publicInputHints",
  "pedersenAggregateAudit",
  "pedersenAggregateStatus",
  "pedersenAggregateHash",
  "pedersenTallyVerified",
  "pedersenTallyMessage",
  "pedersenContextHash",
  "auditHash",
  "createdAt"
];

const requiredApiEndpoints = [
  "/aggregator/elections/:id/run",
  "/attack/elections/:id/inject-duplicate-vote",
  "/attack/elections/:id/inject-invalid-vote",
  "/attack/elections/:id/inject-non-one-hot-vote",
  "/attack/elections/:id/inject-candidate-vector-mismatch",
  "/attack/elections/:id/tamper-commitment",
  "/attack/elections/:id/delete-vote"
];

const requiredReportTamperEndpoint = "/attack/elections/:id/tamper-tally";

const items: CompletenessItem[] = [
  checkFile(
    "A-contract",
    "Frozen parallel interface contract exists",
    join(contractsDir, "VERIVOTE_PARALLEL_INTERFACE_CONTRACT.md")
  ),
  checkFile(
    "A-handoff",
    "A handoff has failure copy and screenshot checklist",
    join(evaluationDir, "AGGREGATOR_AUDIT_HANDOFF.md")
  ),
  checkFile(
    "A-full-acceptance-script",
    "One-command Task A full acceptance script exists",
    join(projectRoot, "scripts", "aggregator-task-a-full.ts")
  ),
  checkFile(
    "A-cases-md",
    "A acceptance markdown exists",
    join(evaluationDir, "AGGREGATOR_AUDIT_CASES.md")
  ),
  checkJson(
    "A-demo-seed",
    "Demo seed fixture exists and describes 4 candidates / 8 votes",
    join(contractsDir, "demo_seed_fixture.json"),
    (value) =>
      value.schemaVersion === "verivote.demo-seed-fixture.v1" &&
      value.expected?.candidateCount === 4 &&
      value.expected?.totalVotes === 8 &&
      Array.isArray(value.votes) &&
      value.votes.length === 8,
    (value) => value.expected
  ),
  checkJson(
    "A-contract-sample",
    "AggregatorReport v2 contract sample has explicit id and token evidence",
    join(contractsDir, "aggregator_report_v2.sample.json"),
    (value) =>
      value.proofStatus === "not-generated" &&
      value.tallyProofSummary?.proofStatus === "not-generated" &&
      value.tallyProofSummary?.proofId === null &&
      Array.isArray(value.validVoteIds) &&
      Array.isArray(value.invalidVoteIds) &&
      Array.isArray(value.partitionAudit?.buckets) &&
      value.partitionAudit.buckets.every((bucket: any) =>
        Array.isArray(bucket.tokenHashes)
      ) &&
      value.integrityCheck?.verified === true,
    (value) => ({
      validVoteIds: value.validVoteIds?.length,
      invalidVoteIds: value.invalidVoteIds?.length,
      proofStatus: value.proofStatus,
      bucketCount: value.partitionAudit?.buckets?.length,
      integrityVerified: value.integrityCheck?.verified
    })
  ),
  checkJson(
    "A-contract-sample-alias",
    "Day-0 aggregator_report.sample.json alias points to the v2 sample shape",
    join(contractsDir, "aggregator_report.sample.json"),
    (value) =>
      value.sampleAliasFor ===
        "docs/contracts/aggregator_report_v2.sample.json" &&
      value.proofStatus === "not-generated" &&
      value.integrityCheck?.verified === true &&
      Array.isArray(value.partitionAudit?.buckets),
    (value) => ({
      sampleAliasFor: value.sampleAliasFor,
      proofStatus: value.proofStatus,
      integrityVerified: value.integrityCheck?.verified
    })
  ),
  checkJson(
    "A-pedersen-null-sample",
    "AggregatorReport v2 sample supports C-track-not-ready Pedersen null state",
    join(contractsDir, "aggregator_report_pedersen_null.sample.json"),
    (value) =>
      value.pedersenAggregateAudit === null &&
      value.pedersenAggregateStatus === "pending" &&
      value.pedersenAggregateHash === null &&
      value.publicInputHints?.pedersenAggregateHash === null &&
      value.integrityCheck?.verified === true &&
      typeof value.auditHash === "string",
    (value) => ({
      pedersenAggregateAudit: value.pedersenAggregateAudit,
      pedersenAggregateStatus: value.pedersenAggregateStatus,
      pedersenAggregateHash: value.pedersenAggregateHash,
      publicHint: value.publicInputHints?.pedersenAggregateHash,
      integrityVerified: value.integrityCheck?.verified
    })
  ),
  checkJson(
    "A-export-bundle",
    "ExportBundleV2 sample carries report, proof placeholder, chain audit, and demo metadata",
    join(contractsDir, "export_bundle_v2.sample.json"),
    (value) =>
      value.envelope?.schemaVersion === "verivote.artifact.v2" &&
      value.aggregatorReport?.integrityCheck?.verified === true &&
      value.tallyProofSummary?.proofStatus === "not-generated" &&
      value.tallyProofSummary?.proofId === null &&
      value.chainAudit?.status === "not_submitted" &&
      value.demoMetadata?.demoSeedFile ===
        "docs/contracts/demo_seed_fixture.json" &&
      Array.isArray(value.challengeRecords),
    (value) => ({
      schemaVersion: value.envelope?.schemaVersion,
      aggregatorIntegrity: value.aggregatorReport?.integrityCheck?.verified,
      proofStatus: value.tallyProofSummary?.proofStatus,
      chainAuditStatus: value.chainAudit?.status,
      demoSeedFile: value.demoMetadata?.demoSeedFile
    })
  ),
  checkJson(
    "A-public-inputs",
    "Public inputs v2 sample binds partition and diagnostics hashes",
    join(contractsDir, "public_inputs_v2.sample.json"),
    (value) =>
      typeof value.partitionHash === "string" &&
      value.partitionHash.length > 0 &&
      typeof value.diagnosticsHash === "string" &&
      value.diagnosticsHash.length > 0 &&
      typeof value.auditHash === "string" &&
      value.auditHash.length > 0,
    (value) => ({
      partitionHash: value.partitionHash,
      diagnosticsHash: value.diagnosticsHash,
      auditHash: value.auditHash
    })
  ),
  checkJson(
    "A-summary",
    "Summary covers all normal/attack cases",
    join(reportDir, "summary.json"),
    (value) => {
      const names = new Set((value.cases ?? []).map((item: any) => item.name));
      return (
        value.allIntegrityVerified === true &&
        requiredReportCases.every((name) => names.has(name)) &&
        requiredAttackAliasFiles.every((file) =>
          existsSync(join(reportDir, file))
        ) &&
        (value.cases ?? []).every(
          (item: any) => item.proofStatus === "not-generated"
        )
      );
    },
    (value) => ({
      caseCount: value.caseCount,
      cases: (value.cases ?? []).map((item: any) => item.name),
      attackAliases: requiredAttackAliasFiles
    })
  ),
  checkJson(
    "A-full-acceptance-manifest",
    "One-command Task A full acceptance manifest records regenerated samples, API smokes, local export, verification, typecheck, build, and completeness gate",
    join(reportDir, "task_a_full_acceptance.json"),
    (value) => {
      const commands = new Set((value.steps ?? []).map((step: any) => step.command));
      return (
        value.schemaVersion === "verivote.task-a-full-acceptance.v1" &&
        value.passed === true &&
        value.stepCount === 9 &&
        commands.has("pnpm aggregator:audit-cases") &&
        commands.has("pnpm aggregator:local-export") &&
        commands.has("pnpm aggregator:api-smoke") &&
        commands.has("python scripts/api_smoke_test.py") &&
        Array.from(commands).some((command) =>
          String(command).includes("aggregator-api-powershell-smoke.ps1")
        ) &&
        commands.has("pnpm aggregator:verify") &&
        commands.has("pnpm typecheck") &&
        commands.has("pnpm build") &&
        commands.has("pnpm aggregator:complete")
      );
    },
    (value) => ({
      passed: value.passed,
      stepCount: value.stepCount,
      commands: (value.steps ?? []).map((step: any) => step.command)
    })
  ),
  checkJson(
    "A-offline",
    "Offline verifier covers positive files, constructed tamper rejection, and saved API tamper report rejection",
    join(reportDir, "offline_verification.json"),
    (value) =>
      (value.verifiedFiles ?? []).length === requiredReportCases.length &&
      value.pedersenNullContractSample?.integrityVerified === true &&
      value.pedersenNullContractSample?.pedersenAggregateAudit === null &&
      value.pedersenNullContractSample?.pedersenAggregateStatus === "pending" &&
      value.pedersenNullContractSample?.pedersenAggregateHash === null &&
      (value.tamperCases ?? []).some(
        (item: any) => item.expectedFailure === "fieldShapeValid"
      ) &&
      (value.tamperCases ?? []).some(
        (item: any) =>
          item.expectedFailure === "bucketTokenRootsMatchTokenHashes"
      ) &&
      value.savedApiTamperReport?.file ===
        "docs/evaluation/aggregator_reports/api_aggregator_report.attack-tamper-tally.json" &&
      value.savedApiTamperReport?.offlineIntegrityVerified === false &&
      value.savedApiTamperReport?.storedIntegrityVerified === false &&
      value.savedApiTamperReport?.auditHashMatches === true &&
      value.savedApiTamperReport?.tallyConsistent === false &&
      (value.savedApiTamperReport?.offlineFailures ?? []).includes(
        "bucketTallyMatches"
      ) &&
      (value.savedApiTamperReport?.offlineFailures ?? []).includes(
        "tallyTotalMatchesValidVotes"
      ) &&
      (value.savedApiTamperReport?.offlineFailures ?? []).includes(
        "tallySumMatchesValidVotes"
      ),
    (value) => ({
      verifiedFiles: (value.verifiedFiles ?? []).map((item: any) =>
        basename(item.file)
      ),
      tamperCases: (value.tamperCases ?? []).map((item: any) =>
        item.expectedFailure
      ),
      savedApiTamperReport: value.savedApiTamperReport,
      pedersenNullContractSample: value.pedersenNullContractSample
    })
  ),
  checkJson(
    "A-api-smoke",
    "API smoke covers run/report/export/attack and SQLite persistence",
    join(reportDir, "api_smoke.json"),
    (value) => {
      const endpoints = new Set((value.cases ?? []).map((item: any) => item.endpoint));
      return (
        value.allIntegrityVerified === true &&
        value.caseCount === requiredApiEndpoints.length &&
        requiredApiEndpoints.every((endpoint) => endpoints.has(endpoint)) &&
        value.exportSmoke?.bundleEndpoint === "/elections/:id/export-bundle" &&
        value.exportSmoke?.bundle?.proofStatus === "not-generated" &&
        value.exportSmoke?.bundle?.demoSeedFile ===
          "docs/contracts/demo_seed_fixture.json" &&
        value.exportSmoke?.rawExportFiles?.aggregatorReport ===
          "docs/evaluation/aggregator_reports/api_export_aggregator_report.json" &&
        value.exportSmoke?.rawExportFiles?.publicInputs ===
          "docs/evaluation/aggregator_reports/api_export_public_inputs.json" &&
        value.exportSmoke?.rawExportFiles?.exportBundle ===
          "docs/evaluation/aggregator_reports/api_export_bundle.json" &&
        value.reportTamperSmoke?.endpoint === requiredReportTamperEndpoint &&
        value.reportTamperSmoke?.integrityVerified === false &&
        value.reportTamperSmoke?.tallyConsistent === false &&
        (value.reportTamperSmoke?.observedFailures ?? []).includes(
          "bucketTallyMatches"
        ) &&
        (value.reportTamperSmoke?.observedFailures ?? []).includes(
          "tallyTotalMatchesValidVotes"
        ) &&
        (value.reportTamperSmoke?.observedFailures ?? []).includes(
          "tallySumMatchesValidVotes"
        ) &&
        value.reportTamperSmoke?.file ===
          "docs/evaluation/aggregator_reports/api_aggregator_report.attack-tamper-tally.json" &&
        existsSync(
          join(reportDir, "api_aggregator_report.attack-tamper-tally.json")
        ) &&
        requiredApiReportFiles.every((file) => existsSync(join(reportDir, file))) &&
        requiredApiAttackAliasFiles.every((file) =>
          existsSync(join(reportDir, file))
        ) &&
        value.persistenceSmoke?.integrityVerified === true &&
        value.persistenceSmoke?.proofStatus === "not-generated" &&
        requiredPersistentReportFields.every((field) =>
          (value.persistenceSmoke?.fieldRoundTrip ?? []).some(
            (item: any) => item.field === field && item.equal === true
          )
        ) &&
        Array.isArray(value.persistenceSmoke?.bucketTokenHashCounts)
      );
    },
    (value) => ({
      caseCount: value.caseCount,
      endpoints: (value.cases ?? []).map((item: any) => item.endpoint),
      bundleEndpoint: value.exportSmoke?.bundleEndpoint,
      bundleProofStatus: value.exportSmoke?.bundle?.proofStatus,
      rawExportFiles: value.exportSmoke?.rawExportFiles,
      reportTamperSmoke: value.reportTamperSmoke,
      apiReportFiles: requiredApiReportFiles,
      apiAttackAliases: requiredApiAttackAliasFiles,
      persistenceIntegrity: value.persistenceSmoke?.integrityVerified,
      persistedFields: (value.persistenceSmoke?.fieldRoundTrip ?? []).filter(
        (item: any) => item.equal
      ).length
    })
  ),
  checkJson(
    "A-api-raw-aggregator",
    "Raw HTTP aggregator export contains AggregatorReport v2 and integrityCheck",
    join(reportDir, "api_export_aggregator_report.json"),
    (value) =>
      value.proofStatus === "not-generated" &&
      value.integrityCheck?.verified === true &&
      Array.isArray(value.partitionAudit?.buckets) &&
      typeof value.partitionHash === "string" &&
      typeof value.diagnosticsHash === "string",
    (value) => ({
      proofStatus: value.proofStatus,
      integrityVerified: value.integrityCheck?.verified,
      bucketCount: value.partitionAudit?.buckets?.length
    })
  ),
  checkJson(
    "A-api-raw-public-inputs",
    "Raw HTTP public inputs export binds partition, diagnostics, and audit hashes",
    join(reportDir, "api_export_public_inputs.json"),
    (value) =>
      typeof value.partitionHash === "string" &&
      value.partitionHash.length > 0 &&
      typeof value.diagnosticsHash === "string" &&
      value.diagnosticsHash.length > 0 &&
      typeof value.auditHash === "string" &&
      value.auditHash.length > 0,
    (value) => ({
      partitionHash: value.partitionHash,
      diagnosticsHash: value.diagnosticsHash,
      auditHash: value.auditHash
    })
  ),
  checkJson(
    "A-api-raw-bundle",
    "Raw HTTP export bundle contains A report, proof placeholder, chain audit, and demo metadata",
    join(reportDir, "api_export_bundle.json"),
    (value) =>
      value.aggregatorReport?.integrityCheck?.verified === true &&
      value.tallyProofSummary?.proofStatus === "not-generated" &&
      value.demoMetadata?.demoSeedFile ===
        "docs/contracts/demo_seed_fixture.json" &&
      value.chainAudit?.status === "not_submitted",
    (value) => ({
      aggregatorIntegrity: value.aggregatorReport?.integrityCheck?.verified,
      proofStatus: value.tallyProofSummary?.proofStatus,
      chainAuditStatus: value.chainAudit?.status,
      demoSeedFile: value.demoMetadata?.demoSeedFile
    })
  ),
  checkJson(
    "A-local-standalone-export",
    "Local standalone script outputs AggregatorReport v2, public inputs, and ExportBundleV2 without starting the API server",
    join(localStandaloneDir, "manifest.json"),
    (value) =>
      value.serverRequired === false &&
      value.fixture?.candidateCount === 4 &&
      value.fixture?.voteCount === 8 &&
      value.report?.integrityVerified === true &&
      value.report?.proofStatus === "not-generated" &&
      typeof value.report?.auditHash === "string" &&
      typeof value.publicInputs?.partitionHash === "string" &&
      value.exportBundle?.schemaVersion === "verivote.artifact.v2" &&
      value.exportBundle?.proofStatus === "not-generated" &&
      existsSync(join(localStandaloneDir, "aggregator_report.local-normal.json")) &&
      existsSync(join(localStandaloneDir, "public_inputs.local-normal.json")) &&
      existsSync(join(localStandaloneDir, "export_bundle.local-normal.json")),
    (value) => ({
      serverRequired: value.serverRequired,
      fixture: value.fixture,
      report: value.report,
      publicInputs: value.publicInputs,
      exportBundle: value.exportBundle
    })
  ),
  checkJson(
    "A-local-standalone-report",
    "Local standalone AggregatorReport v2 carries integrityCheck, partition audit, vote-id accounting, proof placeholder, and token evidence",
    join(localStandaloneDir, "aggregator_report.local-normal.json"),
    (value) =>
      value.serverRequired === false &&
      value.integrityCheck?.verified === true &&
      value.proofStatus === "not-generated" &&
      value.tallyProofSummary?.proofStatus === "not-generated" &&
      Array.isArray(value.validVoteIds) &&
      value.validVoteIds.length === value.validVotes &&
      Array.isArray(value.invalidVoteIds) &&
      value.invalidVoteIds.length === value.invalidVotes &&
      Array.isArray(value.partitionAudit?.buckets) &&
      value.partitionAudit.buckets.every((bucket: any) =>
        Array.isArray(bucket.tokenHashes)
      ) &&
      value.publicInputHints?.partitionHash === value.partitionHash &&
      value.publicInputHints?.diagnosticsHash === value.diagnosticsHash,
    (value) => ({
      integrityVerified: value.integrityCheck?.verified,
      proofStatus: value.proofStatus,
      validVoteIds: value.validVoteIds?.length,
      invalidVoteIds: value.invalidVoteIds?.length,
      bucketCount: value.partitionAudit?.buckets?.length
    })
  ),
  checkFile(
    "A-powershell-smoke-script",
    "PowerShell Invoke-RestMethod smoke script exists for A.5 no-frontend API acceptance",
    join(projectRoot, "scripts", "aggregator-api-powershell-smoke.ps1")
  ),
  checkJson(
    "A-powershell-api-smoke",
    "PowerShell API smoke saves normal/attack AggregatorReport v2 files plus public inputs and bundle",
    join(powershellApiDir, "manifest.json"),
    (value) => {
      const requiredFiles = [
        "aggregator_report.normal.json",
        ...requiredReportCases
          .filter((name) => name !== "normal")
          .map((name) => `aggregator_report.attack-${name}.json`),
        "public_inputs.normal.json",
        "export_bundle.normal.json"
      ];
      const caseNames = new Set((value.cases ?? []).map((item: any) => item.case));
      return (
        value.schemaVersion === "verivote.aggregator-powershell-api-smoke.v1" &&
        value.allIntegrityVerified === true &&
        value.caseCount === requiredReportCases.length &&
        requiredReportCases.every((name) => caseNames.has(name)) &&
        requiredFiles.every((file) => existsSync(join(powershellApiDir, file))) &&
        (value.cases ?? []).every(
          (item: any) => item.proofStatus === "not-generated"
        )
      );
    },
    (value) => ({
      caseCount: value.caseCount,
      cases: (value.cases ?? []).map((item: any) => item.case),
      files: value.files
    })
  ),
  checkJson(
    "A-powershell-normal-report",
    "PowerShell-saved normal AggregatorReport v2 has partition audit, proof placeholder, and vote-id/token evidence",
    join(powershellApiDir, "aggregator_report.normal.json"),
    (value) =>
      value.proofStatus === "not-generated" &&
      Array.isArray(value.validVoteIds) &&
      value.validVoteIds.length === value.validVotes &&
      Array.isArray(value.invalidVoteIds) &&
      value.invalidVoteIds.length === value.invalidVotes &&
      Array.isArray(value.partitionAudit?.buckets) &&
      value.partitionAudit.buckets.every((bucket: any) =>
        Array.isArray(bucket.tokenHashes)
      ) &&
      typeof value.auditHash === "string" &&
      typeof value.partitionHash === "string" &&
      typeof value.diagnosticsHash === "string",
    (value) => ({
      proofStatus: value.proofStatus,
      validVotes: value.validVotes,
      invalidVotes: value.invalidVotes,
      bucketCount: value.partitionAudit?.buckets?.length
    })
  ),
  checkJson(
    "A-python-api-smoke",
    "Python API smoke emits AggregatorReport v2, public inputs v2, and ExportBundleV2",
    join(reportDir, "python_api_smoke.json"),
    (value) =>
      value.passed === true &&
      value.mainFlow?.bundleSchemaVersion === "verivote.artifact.v2" &&
      typeof value.mainFlow?.partitionHash === "string" &&
      typeof value.mainFlow?.diagnosticsHash === "string" &&
      (value.attackFlow?.preTamperDiagnosticReasons ?? []).includes("duplicate-token") &&
      (value.attackFlow?.preTamperDiagnosticReasons ?? []).includes("invalid-candidate") &&
      (value.attackFlow?.preTamperDiagnosticReasons ?? []).includes("invalid-one-hot") &&
      (value.attackFlow?.preTamperDiagnosticReasons ?? []).includes("candidate-vector-mismatch") &&
      (value.attackFlow?.diagnosticReasons ?? []).includes("receipt-chain-break") &&
      value.rawFiles?.aggregatorReport ===
        "docs/evaluation/aggregator_reports/python_api_aggregator_report.json" &&
      value.rawFiles?.publicInputs ===
        "docs/evaluation/aggregator_reports/python_api_public_inputs.json" &&
      value.rawFiles?.exportBundle ===
        "docs/evaluation/aggregator_reports/python_api_export_bundle.json" &&
      value.rawFiles?.attackReport ===
        "docs/evaluation/aggregator_reports/python_api_attack_report.json" &&
      existsSync(join(reportDir, "python_api_aggregator_report.json")) &&
      existsSync(join(reportDir, "python_api_public_inputs.json")) &&
      existsSync(join(reportDir, "python_api_export_bundle.json")) &&
      existsSync(join(reportDir, "python_api_attack_report.json")),
    (value) => ({
      passed: value.passed,
      bundleSchemaVersion: value.mainFlow?.bundleSchemaVersion,
      preTamperDiagnosticReasons: value.attackFlow?.preTamperDiagnosticReasons,
      diagnosticReasons: value.attackFlow?.diagnosticReasons,
      rawFiles: value.rawFiles
    })
  ),
  checkJson(
    "A-python-api-raw-report",
    "Python raw AggregatorReport response contains v2 fields and integrityCheck",
    join(reportDir, "python_api_aggregator_report.json"),
    (value) =>
      value.integrityCheck?.verified === true &&
      value.report?.proofStatus === "not-generated" &&
      Array.isArray(value.report?.validVoteIds) &&
      Array.isArray(value.report?.invalidVoteIds) &&
      Array.isArray(value.report?.partitionAudit?.buckets) &&
      typeof value.report?.diagnosticsHash === "string" &&
      typeof value.report?.pedersenAggregateStatus === "string",
    (value) => ({
      integrityVerified: value.integrityCheck?.verified,
      proofStatus: value.report?.proofStatus,
      pedersenAggregateStatus: value.report?.pedersenAggregateStatus,
      bucketCount: value.report?.partitionAudit?.buckets?.length
    })
  ),
  checkSourceContains(
    "A-frontend-v2-evidence",
    "Frontend report views expose AggregatorReport v2 proof, Pedersen, public input, vote id, and bucket token evidence",
    [
      join(projectRoot, "apps", "web", "src", "components", "AuditComponents.tsx"),
      join(projectRoot, "apps", "web", "src", "pages", "AggregatorPage.tsx"),
      join(projectRoot, "apps", "web", "src", "pages", "AuditReportPage.tsx")
    ],
    [
      "ReportProofAndPedersenPanel",
      "PublicInputHintsPanel",
      "VoteIdAccountingPanel",
      "proofStatus",
      "tallyProofSummary.proofStatus",
      "tallyProofSummary.proofId",
      "pedersenAggregateStatus",
      "pedersenAggregateAudit.contextHash",
      "publicInputHints.electionIdHash",
      "publicInputHints.partitionHash",
      "publicInputHints.diagnosticsHash",
      "validVoteIds",
      "invalidVoteIds",
      "tokenHashes"
    ]
  )
];

const schemaParityFile = join(reportDir, "api_schema_parity.json");
const schemaParityInputs = {
  tsContract: join(contractsDir, "aggregator_report_v2.sample.json"),
  tsRawReport: join(reportDir, "api_export_aggregator_report.json"),
  pythonRawReport: join(reportDir, "python_api_aggregator_report.json"),
  tsRawBundle: join(reportDir, "api_export_bundle.json"),
  pythonRawBundle: join(reportDir, "python_api_export_bundle.json")
};
const schemaParityReady = Object.values(schemaParityInputs).every((file) =>
  existsSync(file)
);

let schemaParity: any = {
  schemaVersion: "verivote.api-schema-parity.v1",
  generatedBy: "pnpm aggregator:complete",
  generatedAt: new Date().toISOString(),
  passed: false,
  reason: "missing input files",
  inputs: Object.fromEntries(
    Object.entries(schemaParityInputs).map(([name, file]) => [
      name,
      { file: relativePath(file), exists: existsSync(file) }
    ])
  )
};

if (schemaParityReady) {
  const tsContract = normalizeReport(readJson<any>(schemaParityInputs.tsContract));
  const tsRawReport = normalizeReport(readJson<any>(schemaParityInputs.tsRawReport));
  const pythonRawReport = normalizeReport(
    readJson<any>(schemaParityInputs.pythonRawReport)
  );
  const tsRawBundle = readJson<any>(schemaParityInputs.tsRawBundle);
  const pythonRawBundle = readJson<any>(schemaParityInputs.pythonRawBundle);
  const parityChecks = {
    contractVsTsRawTopLevel: compareKeys(tsContract, tsRawReport),
    contractVsPythonRawTopLevel: compareKeys(tsContract, pythonRawReport),
    tsRawVsPythonRawTopLevel: compareKeys(tsRawReport, pythonRawReport),
    publicInputHints: compareKeys(
      tsRawReport.publicInputHints,
      pythonRawReport.publicInputHints
    ),
    partitionAudit: compareKeys(tsRawReport.partitionAudit, pythonRawReport.partitionAudit),
    partitionBucket: compareKeys(
      tsRawReport.partitionAudit?.buckets?.[0],
      pythonRawReport.partitionAudit?.buckets?.[0]
    ),
    invalidVoteDiagnostic:
      tsRawReport.invalidVoteDiagnostics.length > 0 &&
      pythonRawReport.invalidVoteDiagnostics.length > 0
        ? compareKeys(
            tsRawReport.invalidVoteDiagnostics[0],
            pythonRawReport.invalidVoteDiagnostics[0]
          )
        : { leftOnly: [], rightOnly: [], equal: true },
    tallyProofSummary: compareKeys(
      tsRawReport.tallyProofSummary,
      pythonRawReport.tallyProofSummary
    ),
    integrityCheckKeys: compareKeys(
      extractIntegrityChecks(readJson<any>(schemaParityInputs.tsRawReport)),
      extractIntegrityChecks(readJson<any>(schemaParityInputs.pythonRawReport))
    ),
    exportBundleTopLevel: compareKeys(tsRawBundle, pythonRawBundle),
    chainAudit: compareKeys(tsRawBundle.chainAudit, pythonRawBundle.chainAudit),
    demoMetadata: compareKeys(tsRawBundle.demoMetadata, pythonRawBundle.demoMetadata)
  };
  schemaParity = {
    ...schemaParity,
    reason: undefined,
    passed: Object.values(parityChecks).every((check: any) => check.equal),
    checks: parityChecks,
    allowedArtifactExtensions: ["tallyConsistent", "consistencyMessage"],
    reportTopLevelKeys: sortedKeys(tsContract),
    publicInputHintKeys: sortedKeys(tsContract.publicInputHints),
    partitionBucketKeys: sortedKeys(tsContract.partitionAudit?.buckets?.[0]),
    integrityCheckKeys: sortedKeys(
      extractIntegrityChecks(readJson<any>(schemaParityInputs.tsRawReport))
    )
  };
}

writeJson(schemaParityFile, schemaParity);
items.push({
  id: "A-api-schema-parity",
  description:
    "TypeScript and Python APIs expose matching AggregatorReport v2, public input, bucket, and bundle schemas",
  evidence: relativePath(schemaParityFile),
  passed: schemaParity.passed === true,
  details: schemaParity.passed
    ? {
        reportTopLevelKeyCount: schemaParity.reportTopLevelKeys?.length,
        publicInputHintKeyCount: schemaParity.publicInputHintKeys?.length,
        partitionBucketKeyCount: schemaParity.partitionBucketKeys?.length,
        integrityCheckKeyCount: schemaParity.integrityCheckKeys?.length
      }
    : schemaParity
});

const traceabilityDefinitions = [
  {
    id: "A-01",
    requirement: "Define CandidatePartitionBucket, PartitionAudit, InvalidVoteDiagnostic, AggregatorReportV2.",
    sourceFiles: ["packages/shared/src/index.ts"],
    evidenceFiles: ["docs/contracts/aggregator_report_v2.sample.json"],
    commands: ["pnpm typecheck"],
    apiEndpoints: []
  },
  {
    id: "A-02",
    requirement: "buildVoteAuditContext gathers votes, candidates, validCandidateIds, and candidateIndexMap.",
    sourceFiles: ["apps/api/src/utils.ts"],
    evidenceFiles: ["docs/evaluation/AGGREGATOR_AUDIT_CASES.md"],
    commands: ["pnpm aggregator:audit-cases"],
    apiEndpoints: []
  },
  {
    id: "A-03",
    requirement: "isOneHotVector checks length, integer entries, 0/1, and sum=1.",
    sourceFiles: ["apps/api/src/utils.ts"],
    evidenceFiles: ["docs/evaluation/aggregator_reports/aggregator_report.non-one-hot.json"],
    commands: ["pnpm aggregator:audit-cases"],
    apiEndpoints: ["/attack/elections/:id/inject-non-one-hot-vote"]
  },
  {
    id: "A-04",
    requirement: "verifyVoteCommitmentOpening recomputes opening from electionId, voteVector, randomness, and commitment.",
    sourceFiles: ["apps/api/src/utils.ts"],
    evidenceFiles: ["docs/evaluation/aggregator_reports/aggregator_report.commitment-tamper.json"],
    commands: ["pnpm aggregator:audit-cases"],
    apiEndpoints: ["/attack/elections/:id/tamper-commitment"]
  },
  {
    id: "A-05",
    requirement: "collectInvalidVoteDiagnostics covers duplicate, candidate, one-hot, opening, and receipt-chain diagnostics.",
    sourceFiles: ["apps/api/src/utils.ts"],
    evidenceFiles: ["docs/evaluation/aggregator_reports/summary.json"],
    commands: ["pnpm aggregator:verify"],
    apiEndpoints: []
  },
  {
    id: "A-06",
    requirement: "Only diagnostics-free votes enter tally and partition buckets.",
    sourceFiles: ["apps/api/src/utils.ts"],
    evidenceFiles: ["docs/evaluation/aggregator_reports/offline_verification.json"],
    commands: ["pnpm aggregator:verify"],
    apiEndpoints: []
  },
  {
    id: "A-07",
    requirement: "Build candidate buckets with voteIds, tokenRoot, commitmentRoot, and receiptRoot.",
    sourceFiles: ["apps/api/src/utils.ts"],
    evidenceFiles: ["docs/contracts/aggregator_report_v2.sample.json"],
    commands: ["pnpm aggregator:audit-cases"],
    apiEndpoints: []
  },
  {
    id: "A-08",
    requirement: "Compute bucketAuditHash from candidateId, roots, voteCount, and voteIdsHash.",
    sourceFiles: ["apps/api/src/utils.ts"],
    evidenceFiles: ["docs/evaluation/aggregator_reports/offline_verification.json"],
    commands: ["pnpm aggregator:verify"],
    apiEndpoints: []
  },
  {
    id: "A-09",
    requirement: "Compute partitionHash from bucket hashes and partition flags.",
    sourceFiles: ["apps/api/src/utils.ts"],
    evidenceFiles: ["docs/contracts/public_inputs_v2.sample.json"],
    commands: ["pnpm aggregator:audit-cases"],
    apiEndpoints: []
  },
  {
    id: "A-10",
    requirement: "Compute diagnosticsHash from stable invalidVoteDiagnostics JSON.",
    sourceFiles: ["apps/api/src/utils.ts"],
    evidenceFiles: ["docs/evaluation/aggregator_reports/offline_verification.json"],
    commands: ["pnpm aggregator:verify"],
    apiEndpoints: []
  },
  {
    id: "A-11",
    requirement: "auditHash binds partitionHash, diagnosticsHash, and Pedersen/proof placeholder state.",
    sourceFiles: ["apps/api/src/utils.ts"],
    evidenceFiles: [
      "docs/contracts/aggregator_report_pedersen_null.sample.json",
      "docs/evaluation/aggregator_reports/offline_verification.json"
    ],
    commands: ["pnpm aggregator:verify"],
    apiEndpoints: []
  },
  {
    id: "A-12",
    requirement: "createPublicInputsArtifact exports partitionHash, diagnosticsHash, tallyHash, candidateCount, and validVotes.",
    sourceFiles: ["apps/api/src/utils.ts"],
    evidenceFiles: ["docs/contracts/public_inputs_v2.sample.json", "docs/evaluation/aggregator_reports/api_export_public_inputs.json"],
    commands: ["pnpm aggregator:api-smoke"],
    apiEndpoints: ["/elections/:id/export/public_inputs.json"]
  },
  {
    id: "A-13",
    requirement: "Normal 4-candidate/8-vote AggregatorReport sample exists.",
    sourceFiles: ["scripts/aggregator-audit-cases.ts"],
    evidenceFiles: ["docs/contracts/aggregator_report_v2.sample.json", "docs/contracts/aggregator_report.sample.json"],
    commands: ["pnpm aggregator:audit-cases"],
    apiEndpoints: []
  },
  {
    id: "A-14",
    requirement: "Duplicate vote sample has duplicateVotes>0 and duplicate-token diagnostic.",
    sourceFiles: ["scripts/aggregator-audit-cases.ts", "apps/api/src/routes/attacks.ts"],
    evidenceFiles: ["docs/evaluation/aggregator_reports/aggregator_report.duplicate-token.json", "docs/evaluation/aggregator_reports/aggregator_report.attack-duplicate-token.json"],
    commands: ["pnpm aggregator:audit-cases", "pnpm aggregator:api-smoke"],
    apiEndpoints: ["/attack/elections/:id/inject-duplicate-vote"]
  },
  {
    id: "A-15",
    requirement: "Invalid candidate sample has invalidVotes>0 and excludes invalid vote from buckets.",
    sourceFiles: ["scripts/aggregator-audit-cases.ts", "apps/api/src/routes/attacks.ts"],
    evidenceFiles: ["docs/evaluation/aggregator_reports/aggregator_report.invalid-candidate.json", "docs/evaluation/aggregator_reports/aggregator_report.attack-invalid-candidate.json"],
    commands: ["pnpm aggregator:audit-cases", "pnpm aggregator:api-smoke"],
    apiEndpoints: ["/attack/elections/:id/inject-invalid-vote"]
  },
  {
    id: "A-16",
    requirement: "Non-one-hot sample has invalid-one-hot diagnostic.",
    sourceFiles: ["scripts/aggregator-audit-cases.ts", "apps/api/src/routes/attacks.ts"],
    evidenceFiles: ["docs/evaluation/aggregator_reports/aggregator_report.non-one-hot.json", "docs/evaluation/aggregator_reports/aggregator_report.attack-non-one-hot.json"],
    commands: ["pnpm aggregator:audit-cases", "pnpm aggregator:api-smoke"],
    apiEndpoints: ["/attack/elections/:id/inject-non-one-hot-vote"]
  },
  {
    id: "A-17",
    requirement: "Commitment-opening tamper sample has commitment-opening-failed diagnostic.",
    sourceFiles: ["scripts/aggregator-audit-cases.ts", "apps/api/src/routes/attacks.ts"],
    evidenceFiles: ["docs/evaluation/aggregator_reports/aggregator_report.commitment-tamper.json", "docs/evaluation/aggregator_reports/aggregator_report.attack-commitment-tamper.json"],
    commands: ["pnpm aggregator:audit-cases", "pnpm aggregator:api-smoke"],
    apiEndpoints: ["/attack/elections/:id/tamper-commitment"]
  },
  {
    id: "A-18",
    requirement: "Receipt-chain delete sample has receiptChainVerified=false.",
    sourceFiles: ["scripts/aggregator-audit-cases.ts", "apps/api/src/routes/attacks.ts"],
    evidenceFiles: ["docs/evaluation/aggregator_reports/aggregator_report.receipt-chain-delete.json", "docs/evaluation/aggregator_reports/aggregator_report.attack-receipt-chain-delete.json"],
    commands: ["pnpm aggregator:audit-cases", "pnpm aggregator:api-smoke"],
    apiEndpoints: ["/attack/elections/:id/delete-vote"]
  },
  {
    id: "A-18b",
    requirement: "Saved AggregatorReport tally tampering is rejected even when auditHash is recomputed.",
    sourceFiles: [
      "scripts/aggregator-api-smoke.ts",
      "scripts/aggregator-audit-verify.ts",
      "apps/api/src/routes/attacks.ts",
      "apps/api/src/utils.ts"
    ],
    evidenceFiles: [
      "docs/evaluation/aggregator_reports/api_smoke.json",
      "docs/evaluation/aggregator_reports/offline_verification.json",
      "docs/evaluation/aggregator_reports/api_aggregator_report.attack-tamper-tally.json"
    ],
    commands: ["pnpm aggregator:api-smoke", "pnpm aggregator:verify"],
    apiEndpoints: [
      "/attack/elections/:id/tamper-tally",
      "/aggregator/elections/:id/report"
    ]
  },
  {
    id: "A-19",
    requirement: "PAPER_MAPPING uses Aggios-inspired wording and avoids complete EPA overclaim.",
    sourceFiles: ["docs/overview/PAPER_MAPPING.md"],
    evidenceFiles: ["docs/evaluation/AGGREGATOR_AUDIT_CASES.md"],
    commands: ["pnpm aggregator:complete"],
    apiEndpoints: []
  },
  {
    id: "A-20",
    requirement: "API smoke proves A is independently acceptable without frontend.",
    sourceFiles: [
      "scripts/aggregator-task-a-full.ts",
      "scripts/aggregator-api-smoke.ts",
      "scripts/aggregator-local-export.ts",
      "scripts/aggregator-api-powershell-smoke.ps1",
      "scripts/api_smoke_test.py",
      "apps/api/src/verivote_api/main.py"
    ],
    evidenceFiles: [
      "docs/evaluation/aggregator_reports/api_smoke.json",
      "docs/evaluation/aggregator_reports/task_a_full_acceptance.json",
      "docs/evaluation/aggregator_reports/api_export_aggregator_report.json",
      "docs/evaluation/aggregator_reports/api_export_bundle.json",
      "docs/evaluation/aggregator_reports/local_standalone/manifest.json",
      "docs/evaluation/aggregator_reports/local_standalone/aggregator_report.local-normal.json",
      "docs/evaluation/aggregator_reports/local_standalone/export_bundle.local-normal.json",
      "docs/evaluation/aggregator_reports/powershell_api/manifest.json",
      "docs/evaluation/aggregator_reports/powershell_api/aggregator_report.normal.json",
      "docs/evaluation/aggregator_reports/powershell_api/aggregator_report.attack-duplicate-token.json",
      "docs/evaluation/aggregator_reports/python_api_smoke.json",
      "docs/evaluation/aggregator_reports/python_api_aggregator_report.json",
      "docs/evaluation/aggregator_reports/python_api_export_bundle.json"
    ],
    commands: [
      "pnpm aggregator:task-a-full",
      "pnpm aggregator:api-smoke",
      "pnpm aggregator:local-export",
      "pnpm aggregator:ps-smoke",
      "python scripts/api_smoke_test.py"
    ],
    apiEndpoints: ["/aggregator/elections/:id/run", "/aggregator/elections/:id/report", "/elections/:id/export-bundle"]
  }
];

const traceability: TraceabilityItem[] = traceabilityDefinitions.map((item) => {
  const files = [...item.sourceFiles, ...item.evidenceFiles];
  const missingFiles = files.filter((file) => !existsSync(join(projectRoot, file)));
  return {
    ...item,
    passed: missingFiles.length === 0,
    missingFiles
  };
});
const traceabilityFile = join(reportDir, "task_a_traceability.json");
writeJson(traceabilityFile, {
  schemaVersion: "verivote.task-a-traceability.v1",
  generatedBy: "pnpm aggregator:complete",
  generatedAt: new Date().toISOString(),
  passed: traceability.every((item) => item.passed),
  itemCount: traceability.length,
  items: traceability
});
items.push({
  id: "A-traceability",
  description: "A-01..A-20 traceability matrix has source, evidence, command, and API links",
  evidence: relativePath(traceabilityFile),
  passed: traceability.every((item) => item.passed),
  details: {
    itemCount: traceability.length,
    failed: traceability.filter((item) => !item.passed).map((item) => item.id)
  }
});

const failed = items.filter((item) => !item.passed);
const outputFile = join(reportDir, "completeness_matrix.json");

writeJson(outputFile, {
  schemaVersion: "verivote.aggregator-completeness-matrix.v1",
  generatedBy: "pnpm aggregator:complete",
  generatedAt: new Date().toISOString(),
  passed: failed.length === 0,
  itemCount: items.length,
  items
});

for (const item of items) {
  console.log(`${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.description}`);
}

if (failed.length > 0) {
  throw new Error(
    `Aggregator completeness check failed: ${failed
      .map((item) => item.id)
      .join(", ")}`
  );
}

console.log(`Wrote completeness matrix to ${relativePath(outputFile)}`);
