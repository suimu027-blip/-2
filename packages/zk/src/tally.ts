// Tally correctness ZK proof adapter.
// Uses circuits/tally_correctness.circom (fixed to 8 ballots, 4 candidates).

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TALLY_CIRCUIT_ID = "tally-correctness-8x4";
export const TALLY_BATCH_SIZE = 8;
export const TALLY_CANDIDATE_COUNT = 4;
export const TALLY_METADATA_UNAVAILABLE = "unavailable";

export type TallyProofMode = "mock" | "real";
export type TallyVerifierMode = "mock" | "local-mock" | "real-hardhat";

export interface TallyProofMetadata {
  batchId: string;
  validVoteCount: number;
  tallyHash: string;
  commitmentRoot: string;
  partitionHash: string;
}

export interface TallyProofRequest {
  electionId: string;
  voteVectors: number[][];
  realRows?: number[];
  tally: number[];
  batchId?: string;
  proofMode?: TallyProofMode;
  verifierMode?: TallyVerifierMode;
  metadata?: Partial<TallyProofMetadata>;
}

export interface TallyPublicSignals extends TallyProofMetadata {
  electionIdHash: string;
  tally: number[];
  batchSize: number;
  candidateCount: number;
  circuitId: string;
}

export interface TallyProof {
  protocol:
    | "verivote-tally-correctness-groth16-v1"
    | "verivote-tally-correctness-local-mock-v1";
  proofMode: TallyProofMode;
  verifierMode: TallyVerifierMode;
  proofId: string;
  circuitId: string;
  generatedAt: string;
  electionIdHash: string;
  publicSignals: TallyPublicSignals;
  snarkjsProof: unknown | null;
  snarkjsPublicSignals: string[];
  artifactDirectory: string;
  valid: boolean;
  proofHash: string;
  error?: string;
}

export interface TallyProofResponse {
  proofId: string;
  proofMode: TallyProofMode;
  verifierMode: TallyVerifierMode;
  circuitId: string;
  publicSignals: TallyPublicSignals;
  proof: TallyProof;
  proofHash: string;
  valid: boolean;
  message: string;
}

export interface TallyVerifyRequest {
  proof: unknown;
  publicSignals: TallyPublicSignals;
}

export interface TallyVerifyResponse {
  verified: boolean;
  message: string;
}

export interface TallyProofAgainstReportResult {
  verified: boolean;
  message: string;
  checks: Record<string, boolean>;
  expected?: {
    electionIdHash?: string;
    tally?: number[];
    validVoteCount?: number;
    tallyHash?: string;
    commitmentRoot?: string;
    partitionHash?: string;
  };
}

export interface VerifyTallyProofAgainstReportInput {
  proofResponse: unknown;
  report: unknown;
  expectedElectionId?: string;
  expectedVerifierModes?: TallyVerifierMode[];
  requireRealProof?: boolean;
}

export interface TallySolidityCalldata {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  input: string[];
}

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const tallyArtifactDirectory =
  process.env.VERIVOTE_ZK_TALLY_ARTIFACT_DIR ??
  join(projectRoot, "zk-artifacts", "tally-correctness");

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isAvailableMetadata(value: string | undefined): value is string {
  return value !== undefined && value !== TALLY_METADATA_UNAVAILABLE;
}

export function createTallyElectionIdHash(electionId: string): string {
  return hashText(`verivote.zk.tally.election-id.v1:${electionId}`);
}

function normalizeSignal(value: unknown): string {
  try {
    return BigInt(String(value)).toString();
  } catch {
    return String(value);
  }
}

function signalArraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => normalizeSignal(value) === normalizeSignal(right[index]))
  );
}

function numberArraysEqual(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createExpectedSoliditySignals(publicSignals: TallyPublicSignals): string[] {
  return [...publicSignals.tally, publicSignals.batchSize].map((signal) =>
    BigInt(signal).toString()
  );
}

function getSnarkjsCliPath(): string | null {
  const candidates = [
    join(packageRoot, "node_modules", "snarkjs", "build", "cli.cjs"),
    join(projectRoot, "node_modules", "snarkjs", "build", "cli.cjs")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function getArtifacts() {
  return {
    directory: tallyArtifactDirectory,
    wasmPath: join(
      tallyArtifactDirectory,
      "tally_correctness_js",
      "tally_correctness.wasm"
    ),
    witnessGeneratorPath: join(
      tallyArtifactDirectory,
      "tally_correctness_js",
      "generate_witness.js"
    ),
    zkeyPath: join(tallyArtifactDirectory, "tally_correctness_final.zkey"),
    verificationKeyPath: join(tallyArtifactDirectory, "verification_key.json")
  };
}

export function getTallyArtifactStatus(): {
  ready: boolean;
  directory: string;
  missing: string[];
} {
  const artifacts = getArtifacts();
  const required = [
    artifacts.wasmPath,
    artifacts.witnessGeneratorPath,
    artifacts.zkeyPath,
    artifacts.verificationKeyPath
  ];
  const missing = required.filter((p) => !existsSync(p));
  return { ready: missing.length === 0, directory: artifacts.directory, missing };
}

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorMessage?: string;
}

function runCommand(
  command: string,
  args: string[],
  options: { allowFailure?: boolean } = {}
): CommandResult {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}\n${stdout}${stderr}`
    );
  }
  return {
    exitCode: result.status,
    stdout,
    stderr,
    errorMessage: result.error?.message
  };
}

function runSnarkjs(args: string[], options: { allowFailure?: boolean } = {}): CommandResult {
  const cli = getSnarkjsCliPath();
  if (!cli) {
    return {
      exitCode: null,
      stdout: "",
      stderr: "snarkjs CLI not found",
      errorMessage: "snarkjs CLI not found"
    };
  }
  return runCommand(process.execPath, [cli, ...args], options);
}

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function getRealRows(input: TallyProofRequest): number[] {
  return input.realRows ?? new Array<number>(TALLY_BATCH_SIZE).fill(1);
}

function validateRequest(input: TallyProofRequest): string | null {
  if (!Array.isArray(input.voteVectors) || input.voteVectors.length !== TALLY_BATCH_SIZE) {
    return `voteVectors must be an array of length ${TALLY_BATCH_SIZE}`;
  }
  const realRows = getRealRows(input);
  if (
    !Array.isArray(realRows) ||
    realRows.length !== TALLY_BATCH_SIZE ||
    !realRows.every((row) => Number.isInteger(row) && (row === 0 || row === 1))
  ) {
    return `realRows must be ${TALLY_BATCH_SIZE} binary entries`;
  }
  for (const row of input.voteVectors) {
    if (!Array.isArray(row) || row.length !== TALLY_CANDIDATE_COUNT) {
      return `each ballot row must have ${TALLY_CANDIDATE_COUNT} entries`;
    }
    if (!row.every((b) => Number.isInteger(b) && (b === 0 || b === 1))) {
      return "ballot entries must be 0 or 1";
    }
    if (row.reduce((a, b) => a + b, 0) !== 1) {
      return "each ballot row must be one-hot (sum == 1)";
    }
  }
  if (
    !Array.isArray(input.tally) ||
    input.tally.length !== TALLY_CANDIDATE_COUNT ||
    !input.tally.every((n) => Number.isInteger(n) && n >= 0)
  ) {
    return `tally must be ${TALLY_CANDIDATE_COUNT} non-negative integers`;
  }

  const columnSums = new Array<number>(TALLY_CANDIDATE_COUNT).fill(0);
  for (let i = 0; i < input.voteVectors.length; i += 1) {
    const row = input.voteVectors[i];
    for (let j = 0; j < TALLY_CANDIDATE_COUNT; j += 1) {
      columnSums[j] += row[j] * realRows[i];
    }
  }
  for (let j = 0; j < TALLY_CANDIDATE_COUNT; j += 1) {
    if (columnSums[j] !== input.tally[j]) {
      return `tally[${j}] (${input.tally[j]}) does not match column sum (${columnSums[j]})`;
    }
  }
  return null;
}

function sumTally(tally: number[]): number {
  return tally.reduce((total, value) => total + value, 0);
}

function createDefaultTallyHash(input: {
  electionIdHash: string;
  tally: number[];
  batchSize: number;
}): string {
  return hashText(
    stableStringify({
      domain: "verivote.zk.tally.default-tally-hash.v1",
      electionIdHash: input.electionIdHash,
      tally: input.tally,
      batchSize: input.batchSize
    })
  );
}

export function createTallyPublicSignals(input: {
  electionId: string;
  tally: number[];
  batchSize?: number;
  batchId?: string;
  metadata?: Partial<TallyProofMetadata>;
}): TallyPublicSignals {
  const electionIdHash = createTallyElectionIdHash(input.electionId);
  const metadata = input.metadata ?? {};
  const batchSize = isNonNegativeInteger(input.batchSize)
    ? input.batchSize
    : TALLY_BATCH_SIZE;
  const batchId =
    cleanString(metadata.batchId) ??
    cleanString(input.batchId) ??
    "fixture-8x4";
  const validVoteCount =
    isNonNegativeInteger(metadata.validVoteCount) ? metadata.validVoteCount : sumTally(input.tally);
  const tallyHash =
    cleanString(metadata.tallyHash) ??
    createDefaultTallyHash({ electionIdHash, tally: input.tally, batchSize });

  return {
    electionIdHash,
    batchId,
    tally: input.tally.slice(),
    batchSize,
    validVoteCount,
    candidateCount: TALLY_CANDIDATE_COUNT,
    tallyHash,
    commitmentRoot: cleanString(metadata.commitmentRoot) ?? TALLY_METADATA_UNAVAILABLE,
    partitionHash: cleanString(metadata.partitionHash) ?? TALLY_METADATA_UNAVAILABLE,
    circuitId: TALLY_CIRCUIT_ID
  };
}

export function createTallyProofHash(proof: Omit<TallyProof, "proofHash">): string {
  return hashText(
    stableStringify({
      domain: "verivote.zk.tally-proof-hash.v1",
      proof
    })
  );
}

export function recomputeTallyProofHash(proof: TallyProof): string {
  const { proofHash: _proofHash, ...proofWithoutHash } = proof;
  return createTallyProofHash(proofWithoutHash);
}

function createProofShell(input: {
  publicSignals: TallyPublicSignals;
  proofId: string;
  proofMode: TallyProofMode;
  verifierMode: TallyVerifierMode;
  snarkjsProof?: unknown | null;
  snarkjsPublicSignals?: string[];
  valid: boolean;
  error?: string;
}): TallyProof {
  const proofWithoutHash: Omit<TallyProof, "proofHash"> = {
    protocol:
      input.proofMode === "mock"
        ? "verivote-tally-correctness-local-mock-v1"
        : "verivote-tally-correctness-groth16-v1",
    proofMode: input.proofMode,
    verifierMode: input.verifierMode,
    proofId: input.proofId,
    circuitId: TALLY_CIRCUIT_ID,
    generatedAt: new Date().toISOString(),
    electionIdHash: input.publicSignals.electionIdHash,
    publicSignals: input.publicSignals,
    snarkjsProof: input.snarkjsProof ?? null,
    snarkjsPublicSignals: input.snarkjsPublicSignals ?? [],
    artifactDirectory: tallyArtifactDirectory,
    valid: input.valid,
    error: input.error
  };

  return {
    ...proofWithoutHash,
    proofHash: createTallyProofHash(proofWithoutHash)
  };
}

function createResponse(input: {
  proofId: string;
  publicSignals: TallyPublicSignals;
  proof: TallyProof;
  valid: boolean;
  message: string;
}): TallyProofResponse {
  return {
    proofId: input.proofId,
    proofMode: input.proof.proofMode,
    verifierMode: input.proof.verifierMode,
    circuitId: TALLY_CIRCUIT_ID,
    publicSignals: input.publicSignals,
    proof: input.proof,
    proofHash: input.proof.proofHash,
    valid: input.valid,
    message: input.message
  };
}

function createMockSnarkPayload(input: {
  proofId: string;
  publicSignals: TallyPublicSignals;
  voteVectors: number[][];
}): unknown {
  return {
    protocol: "verivote-tally-correctness-local-mock-v1",
    proofId: input.proofId,
    witnessHash: hashText(
      stableStringify({
        domain: "verivote.zk.tally.mock-witness.v1",
        publicSignals: input.publicSignals,
        voteVectors: input.voteVectors
      })
    ),
    constraints: {
      rowsAreOneHot: true,
      tallyMatchesWitness: true,
      fixedBatchSize: TALLY_BATCH_SIZE,
      fixedCandidateCount: TALLY_CANDIDATE_COUNT
    }
  };
}

export function createTallyCorrectnessProof(
  input: TallyProofRequest
): TallyProofResponse {
  const realRows = getRealRows(input);
  const realVoteCount = realRows.reduce((total, row) => total + row, 0);
  const proofMode = input.proofMode ?? "real";
  const verifierMode =
    input.verifierMode ?? (proofMode === "mock" ? "mock" : "local-mock");
  const publicSignals = createTallyPublicSignals({
    electionId: input.electionId,
    tally: input.tally,
    batchSize: realVoteCount,
    batchId: input.batchId,
    metadata: input.metadata
  });
  const proofId = `zkp_tally_${randomUUID()}`;

  const validationError = validateRequest(input);
  if (validationError) {
    const proof = createProofShell({
      publicSignals,
      proofId,
      proofMode,
      verifierMode,
      valid: false,
      error: validationError
    });
    return createResponse({
      proofId,
      publicSignals,
      proof,
      valid: false,
      message: validationError
    });
  }

  if (proofMode === "mock") {
    const proof = createProofShell({
      publicSignals,
      proofId,
      proofMode,
      verifierMode,
      snarkjsProof: createMockSnarkPayload({
        proofId,
        publicSignals,
        voteVectors: input.voteVectors
      }),
      snarkjsPublicSignals: createExpectedSoliditySignals(publicSignals),
      valid: true
    });
    return createResponse({
      proofId,
      publicSignals,
      proof,
      valid: true,
      message:
        "Mock tally proof created for UI/local fixture use. It is not a Groth16 proof."
    });
  }

  const artifactStatus = getTallyArtifactStatus();
  if (!artifactStatus.ready) {
    const message =
      "Tally correctness artifacts not found. Run `pnpm zk:setup` to generate them." +
      (artifactStatus.missing.length > 0
        ? ` Missing: ${artifactStatus.missing.join(", ")}`
        : "");
    const proof = createProofShell({
      publicSignals,
      proofId,
      proofMode,
      verifierMode,
      valid: false,
      error: message
    });
    return createResponse({ proofId, publicSignals, proof, valid: false, message });
  }

  const artifacts = getArtifacts();
  const tmp = mkdtempSync(join(tmpdir(), "verivote-zk-tally-"));
  try {
    const inputPath = join(tmp, "input.json");
    const witnessPath = join(tmp, "witness.wtns");
    const proofPath = join(tmp, "proof.json");
    const publicPath = join(tmp, "public.json");

    writeJsonFile(inputPath, {
      voteVector: input.voteVectors,
      realRows,
      tally: input.tally,
      batchSize: realVoteCount
    });

    const witnessRes = runCommand(
      process.execPath,
      [
        artifacts.witnessGeneratorPath,
        artifacts.wasmPath,
        inputPath,
        witnessPath
      ],
      { allowFailure: true }
    );
    if (witnessRes.exitCode !== 0) {
      const error =
        "Tally correctness witness generation failed: voteVectors do not satisfy tally_correctness.circom constraints";
      const proof = createProofShell({
        publicSignals,
        proofId,
        proofMode,
        verifierMode,
        valid: false,
        error
      });
      return createResponse({ proofId, publicSignals, proof, valid: false, message: error });
    }

    const proveRes = runSnarkjs(
      ["groth16", "prove", artifacts.zkeyPath, witnessPath, proofPath, publicPath],
      { allowFailure: true }
    );
    if (proveRes.exitCode !== 0) {
      const error = "Tally correctness Groth16 prove failed";
      const proof = createProofShell({
        publicSignals,
        proofId,
        proofMode,
        verifierMode,
        valid: false,
        error
      });
      return createResponse({ proofId, publicSignals, proof, valid: false, message: error });
    }

    const snarkjsProof = readJsonFile(proofPath);
    const snarkjsPublicSignals = readJsonFile(publicPath);
    if (!isStringArray(snarkjsPublicSignals)) {
      const error = "Tally correctness prove produced invalid public signals";
      const proof = createProofShell({
        publicSignals,
        proofId,
        proofMode,
        verifierMode,
        snarkjsProof,
        valid: false,
        error
      });
      return createResponse({ proofId, publicSignals, proof, valid: false, message: error });
    }

    const publicSignalsMatch = signalArraysEqual(
      snarkjsPublicSignals,
      createExpectedSoliditySignals(publicSignals)
    );
    const verifyRes = runSnarkjs(
      ["groth16", "verify", artifacts.verificationKeyPath, publicPath, proofPath],
      { allowFailure: true }
    );
    const verified = verifyRes.exitCode === 0 && publicSignalsMatch;
    const proof = createProofShell({
      publicSignals,
      proofId,
      proofMode,
      verifierMode,
      snarkjsProof,
      snarkjsPublicSignals,
      valid: verified,
      error: verified
        ? undefined
        : publicSignalsMatch
          ? "Self-verification failed"
          : "snarkjs public signals do not match TallyProof v2 metadata"
    });
    return createResponse({
      proofId,
      publicSignals,
      proof,
      valid: verified,
      message: verified
        ? "Tally correctness proof generated and verified."
        : "Tally correctness proof generation completed, but verification failed."
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function readPublicSignals(value: unknown): TallyPublicSignals | null {
  if (!isPlainObject(value)) {
    return null;
  }

  if (
    typeof value.electionIdHash !== "string" ||
    typeof value.batchId !== "string" ||
    !isNumberArray(value.tally) ||
    !isNonNegativeInteger(value.batchSize) ||
    !isNonNegativeInteger(value.validVoteCount) ||
    !isNonNegativeInteger(value.candidateCount) ||
    typeof value.tallyHash !== "string" ||
    typeof value.commitmentRoot !== "string" ||
    typeof value.partitionHash !== "string" ||
    typeof value.circuitId !== "string"
  ) {
    return null;
  }

  return {
    electionIdHash: value.electionIdHash,
    batchId: value.batchId,
    tally: value.tally.slice(),
    batchSize: value.batchSize,
    validVoteCount: value.validVoteCount,
    candidateCount: value.candidateCount,
    tallyHash: value.tallyHash,
    commitmentRoot: value.commitmentRoot,
    partitionHash: value.partitionHash,
    circuitId: value.circuitId
  };
}

function readTallyProof(proof: unknown): TallyProof | null {
  if (!isPlainObject(proof)) {
    return null;
  }

  const publicSignals = readPublicSignals(proof.publicSignals);
  if (!publicSignals) {
    return null;
  }

  if (
    (proof.protocol !== "verivote-tally-correctness-groth16-v1" &&
      proof.protocol !== "verivote-tally-correctness-local-mock-v1") ||
    (proof.proofMode !== "mock" && proof.proofMode !== "real") ||
    (proof.verifierMode !== "mock" &&
      proof.verifierMode !== "local-mock" &&
      proof.verifierMode !== "real-hardhat") ||
    typeof proof.proofId !== "string" ||
    proof.circuitId !== TALLY_CIRCUIT_ID ||
    typeof proof.generatedAt !== "string" ||
    typeof proof.electionIdHash !== "string" ||
    !("snarkjsProof" in proof) ||
    !isStringArray(proof.snarkjsPublicSignals) ||
    typeof proof.artifactDirectory !== "string" ||
    typeof proof.valid !== "boolean" ||
    typeof proof.proofHash !== "string"
  ) {
    return null;
  }

  return {
    protocol: proof.protocol,
    proofMode: proof.proofMode,
    verifierMode: proof.verifierMode,
    proofId: proof.proofId,
    circuitId: TALLY_CIRCUIT_ID,
    generatedAt: proof.generatedAt,
    electionIdHash: proof.electionIdHash,
    publicSignals,
    snarkjsProof: proof.snarkjsProof,
    snarkjsPublicSignals: proof.snarkjsPublicSignals,
    artifactDirectory: proof.artifactDirectory,
    valid: proof.valid,
    proofHash: proof.proofHash,
    error: typeof proof.error === "string" ? proof.error : undefined
  };
}

function readTallyProofResponse(value: unknown): {
  proof: TallyProof;
  publicSignals: TallyPublicSignals;
  proofHash: string;
  proofId?: string;
  circuitId?: string;
  valid: boolean;
  proofMode: TallyProofMode;
  verifierMode: TallyVerifierMode;
} | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const proof = readTallyProof(value.proof);
  if (!proof) {
    return null;
  }

  const publicSignals = readPublicSignals(value.publicSignals);
  if (
    !publicSignals ||
    typeof value.proofHash !== "string" ||
    typeof value.proofId !== "string" ||
    value.circuitId !== TALLY_CIRCUIT_ID ||
    (value.proofMode !== "mock" && value.proofMode !== "real") ||
    (value.verifierMode !== "mock" &&
      value.verifierMode !== "local-mock" &&
      value.verifierMode !== "real-hardhat") ||
    typeof value.valid !== "boolean"
  ) {
    return null;
  }

  return {
    proof,
    publicSignals,
    proofHash: value.proofHash,
    proofId: value.proofId,
    circuitId: value.circuitId,
    valid: value.valid,
    proofMode: value.proofMode,
    verifierMode: value.verifierMode
  };
}

function proofIntegrityChecks(input: {
  proof: TallyProof;
  publicSignals: TallyPublicSignals;
  proofHash: string;
  responseProofId?: string;
  responseCircuitId?: string;
  responseProofMode?: TallyProofMode;
  responseVerifierMode?: TallyVerifierMode;
}): Record<string, boolean> {
  return {
    proofHashMatches:
      input.proof.proofHash === recomputeTallyProofHash(input.proof) &&
      input.proofHash === input.proof.proofHash,
    responseProofIdMatchesProof:
      input.responseProofId === undefined || input.responseProofId === input.proof.proofId,
    responseCircuitIdMatchesProof:
      input.responseCircuitId === undefined || input.responseCircuitId === input.proof.circuitId,
    responseProofModeMatchesProof:
      input.responseProofMode === undefined || input.responseProofMode === input.proof.proofMode,
    responseVerifierModeMatchesProof:
      input.responseVerifierMode === undefined ||
      input.responseVerifierMode === input.proof.verifierMode,
    proofPublicSignalsMatchResponse:
      stableStringify(input.proof.publicSignals) === stableStringify(input.publicSignals),
    proofElectionIdMatchesPublicSignals:
      input.proof.electionIdHash === input.publicSignals.electionIdHash,
    proofCircuitMatchesPublicSignals:
      input.proof.circuitId === TALLY_CIRCUIT_ID &&
      input.publicSignals.circuitId === TALLY_CIRCUIT_ID,
    proofSoliditySignalsMatchPublicSignals: signalArraysEqual(
      input.proof.snarkjsPublicSignals,
      createExpectedSoliditySignals(input.publicSignals)
    )
  };
}

export function verifyTallyCorrectnessProof(
  input: TallyVerifyRequest
): TallyVerifyResponse {
  const publicSignals = readPublicSignals(input.publicSignals);
  const proof = readTallyProof(input.proof);
  if (!publicSignals || !proof) {
    return { verified: false, message: "invalid tally proof or publicSignals shape" };
  }

  const checks = proofIntegrityChecks({
    proof,
    publicSignals,
    proofHash: proof.proofHash
  });
  const failedIntegrity = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (failedIntegrity.length > 0) {
    return {
      verified: false,
      message: `tally proof integrity checks failed: ${failedIntegrity.join(", ")}`
    };
  }

  if (!proof.valid) {
    return {
      verified: false,
      message: proof.error ?? "tally proof was marked invalid"
    };
  }

  if (proof.proofMode === "mock") {
    return {
      verified: true,
      message:
        "Mock tally proof metadata verified. This is not a Groth16 verification."
    };
  }

  if (
    proof.protocol !== "verivote-tally-correctness-groth16-v1" ||
    !proof.snarkjsProof
  ) {
    return { verified: false, message: "invalid real Groth16 tally proof payload" };
  }

  const artifactStatus = getTallyArtifactStatus();
  if (!artifactStatus.ready) {
    return {
      verified: false,
      message: `Tally correctness artifacts not found. Missing: ${artifactStatus.missing.join(", ")}`
    };
  }

  const artifacts = getArtifacts();
  const tmp = mkdtempSync(join(tmpdir(), "verivote-zk-tally-verify-"));
  try {
    const proofPath = join(tmp, "proof.json");
    const publicPath = join(tmp, "public.json");
    writeJsonFile(proofPath, proof.snarkjsProof);
    writeJsonFile(publicPath, proof.snarkjsPublicSignals);

    const verifyRes = runSnarkjs(
      ["groth16", "verify", artifacts.verificationKeyPath, publicPath, proofPath],
      { allowFailure: true }
    );
    const verified = verifyRes.exitCode === 0;
    return {
      verified,
      message: verified
        ? "Tally correctness proof verified."
        : "Tally correctness proof verification failed."
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function getReportObject(report: unknown): Record<string, unknown> | null {
  return isPlainObject(report) ? report : null;
}

export function getTallyVectorFromReport(report: unknown): number[] | null {
  const reportObject = getReportObject(report);
  const tallyResult = isPlainObject(reportObject?.tallyResult)
    ? reportObject.tallyResult
    : null;
  const results = Array.isArray(tallyResult?.results) ? tallyResult.results : null;
  if (!results) {
    return null;
  }

  const tally: number[] = [];
  for (const item of results) {
    if (!isPlainObject(item) || !isNonNegativeInteger(item.voteCount)) {
      return null;
    }
    tally.push(item.voteCount);
  }
  return tally;
}

export function createTallyHashFromReport(report: unknown): string {
  const reportObject = getReportObject(report);
  if (!reportObject || !("tallyResult" in reportObject)) {
    return TALLY_METADATA_UNAVAILABLE;
  }
  const serialized = JSON.stringify(reportObject.tallyResult);
  return hashText(serialized === undefined ? String(reportObject.tallyResult) : serialized);
}

function getReportPublicInputHints(reportObject: Record<string, unknown>): Record<string, unknown> {
  return isPlainObject(reportObject.publicInputHints) ? reportObject.publicInputHints : {};
}

function getReportPartitionHash(reportObject: Record<string, unknown>): string {
  const partitionAudit = isPlainObject(reportObject.partitionAudit)
    ? reportObject.partitionAudit
    : null;

  return (
    cleanString(reportObject.partitionHash) ??
    cleanString(partitionAudit?.partitionHash) ??
    TALLY_METADATA_UNAVAILABLE
  );
}

function getReportCommitmentRoot(reportObject: Record<string, unknown>): string {
  return (
    cleanString(reportObject.commitmentRoot) ??
    TALLY_METADATA_UNAVAILABLE
  );
}

export function createTallyProofMetadataFromReport(
  report: unknown,
  options: { batchId?: string } = {}
): TallyProofMetadata {
  const reportObject = getReportObject(report);
  if (!reportObject) {
    return {
      batchId: options.batchId ?? "report-unavailable",
      validVoteCount: 0,
      tallyHash: TALLY_METADATA_UNAVAILABLE,
      commitmentRoot: TALLY_METADATA_UNAVAILABLE,
      partitionHash: TALLY_METADATA_UNAVAILABLE
    };
  }

  const tally = getTallyVectorFromReport(reportObject) ?? [];
  const createdAt = cleanString(reportObject.createdAt);
  const electionId = cleanString(reportObject.electionId) ?? "unknown-election";
  const validVoteCount = isNonNegativeInteger(reportObject.validVotes)
    ? reportObject.validVotes
    : sumTally(tally);

  return {
    batchId: options.batchId ?? `${electionId}:${createdAt ?? "latest-report"}`,
    validVoteCount,
    tallyHash: createTallyHashFromReport(reportObject),
    commitmentRoot: getReportCommitmentRoot(reportObject),
    partitionHash: getReportPartitionHash(reportObject)
  };
}

export function verifyTallyProofAgainstReport(
  input: VerifyTallyProofAgainstReportInput
): TallyProofAgainstReportResult;
export function verifyTallyProofAgainstReport(
  report: unknown,
  proofResponse: unknown,
  options?: Omit<VerifyTallyProofAgainstReportInput, "report" | "proofResponse">
): TallyProofAgainstReportResult;
export function verifyTallyProofAgainstReport(
  inputOrReport: VerifyTallyProofAgainstReportInput | unknown,
  maybeProofResponse?: unknown,
  maybeOptions: Omit<VerifyTallyProofAgainstReportInput, "report" | "proofResponse"> = {}
): TallyProofAgainstReportResult {
  const input: VerifyTallyProofAgainstReportInput =
    maybeProofResponse === undefined &&
    isPlainObject(inputOrReport) &&
    "proofResponse" in inputOrReport &&
    "report" in inputOrReport
      ? (inputOrReport as unknown as VerifyTallyProofAgainstReportInput)
      : {
          ...maybeOptions,
          report: inputOrReport,
          proofResponse: maybeProofResponse
        };

  const read = readTallyProofResponse(input.proofResponse);
  if (!read) {
    return {
      verified: false,
      message: "tallyProofResponse is not a TallyProof v2 response",
      checks: { responseShape: false }
    };
  }

  const reportObject = getReportObject(input.report);
  const expectedTally = getTallyVectorFromReport(input.report);
  const tallyResult = isPlainObject(reportObject?.tallyResult)
    ? reportObject.tallyResult
    : null;
  const tallyResultElectionId = cleanString(tallyResult?.electionId);
  const tallyResultTotalVotes = tallyResult?.totalVotes;
  const expectedTallySum = expectedTally === null ? undefined : sumTally(expectedTally);
  const metadata = createTallyProofMetadataFromReport(input.report, {
    batchId: read.publicSignals.batchId
  });
  const hints = reportObject ? getReportPublicInputHints(reportObject) : {};
  const expectedElectionId =
    input.expectedElectionId ?? cleanString(reportObject?.electionId);
  const expectedElectionIdHash = expectedElectionId
    ? createTallyElectionIdHash(expectedElectionId)
    : undefined;
  const hintedElectionIdHash = cleanString(hints.electionIdHash);
  const hintedTallyHash = cleanString(hints.tallyHash);
  const hintedCommitmentRoot = cleanString(hints.commitmentRoot);
  const hintedPartitionHash = cleanString(hints.partitionHash);
  const reportCommitmentRoot = reportObject
    ? cleanString(reportObject.commitmentRoot)
    : undefined;
  const reportPartitionHash = reportObject
    ? getReportPartitionHash(reportObject)
    : TALLY_METADATA_UNAVAILABLE;
  const reportValidVotes = reportObject?.validVotes;
  const expectedVerifierModes = input.expectedVerifierModes;
  const checks: Record<string, boolean> = {
    responseShape: true,
    responseValidFlag: read.valid && read.proof.valid,
    ...proofIntegrityChecks({
      proof: read.proof,
      publicSignals: read.publicSignals,
      proofHash: read.proofHash,
      responseProofId: read.proofId,
      responseCircuitId: read.circuitId,
      responseProofMode: read.proofMode,
      responseVerifierMode: read.verifierMode
    }),
    proofModeAllowed: input.requireRealProof ? read.proofMode === "real" : true,
    verifierModeAllowed:
      expectedVerifierModes === undefined
        ? true
        : expectedVerifierModes.includes(read.verifierMode),
    reportHasElectionId: expectedElectionId !== undefined,
    reportHasTallyResult: tallyResult !== null && expectedTally !== null,
    reportHasValidVotes: isNonNegativeInteger(reportValidVotes),
    reportHasCommitmentRoot: isAvailableMetadata(reportCommitmentRoot),
    reportHasPartitionHash: isAvailableMetadata(reportPartitionHash),
    electionIdHashMatchesReport:
      expectedElectionIdHash === undefined ||
      read.publicSignals.electionIdHash === expectedElectionIdHash,
    electionIdHashHintMatchesReport:
      hintedElectionIdHash === undefined ||
      expectedElectionIdHash === undefined ||
      hintedElectionIdHash === expectedElectionIdHash,
    tallyMatchesReport:
      expectedTally !== null && numberArraysEqual(read.publicSignals.tally, expectedTally),
    tallyResultElectionIdMatchesReport:
      expectedElectionId === undefined ||
      tallyResultElectionId === expectedElectionId,
    tallyResultTotalVotesMatchesValidVotes:
      isNonNegativeInteger(tallyResultTotalVotes) &&
      tallyResultTotalVotes === metadata.validVoteCount,
    validVotesMatchesTallySum:
      expectedTallySum !== undefined && metadata.validVoteCount === expectedTallySum,
    batchSizeMatchesReport:
      read.publicSignals.batchSize === metadata.validVoteCount &&
      read.publicSignals.validVoteCount === metadata.validVoteCount,
    validVotesHintMatchesReport:
      !isNonNegativeInteger(hints.validVotes) ||
      hints.validVotes === metadata.validVoteCount,
    candidateCountMatchesCircuit:
      read.publicSignals.candidateCount === TALLY_CANDIDATE_COUNT &&
      read.publicSignals.tally.length === TALLY_CANDIDATE_COUNT,
    candidateCountHintMatchesCircuit:
      !isNonNegativeInteger(hints.candidateCount) ||
      hints.candidateCount === TALLY_CANDIDATE_COUNT,
    tallyHashMatchesReport: read.publicSignals.tallyHash === metadata.tallyHash,
    tallyHashHintMatchesReport:
      hintedTallyHash === undefined || hintedTallyHash === metadata.tallyHash,
    commitmentRootMatchesReport:
      read.publicSignals.commitmentRoot === metadata.commitmentRoot,
    commitmentRootHintMatchesReport:
      hintedCommitmentRoot === undefined || hintedCommitmentRoot === metadata.commitmentRoot,
    partitionHashMatchesReport:
      read.publicSignals.partitionHash === metadata.partitionHash,
    partitionHashHintMatchesReport:
      hintedPartitionHash === undefined || hintedPartitionHash === metadata.partitionHash
  };

  const failures = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return {
    verified: failures.length === 0,
    message:
      failures.length === 0
        ? "Tally proof is strongly bound to the aggregator report."
        : `Tally proof/report binding failed: ${failures.join(", ")}`,
    checks,
    expected: {
      electionIdHash: expectedElectionIdHash,
      tally: expectedTally ?? undefined,
      validVoteCount: metadata.validVoteCount,
      tallyHash: metadata.tallyHash,
      commitmentRoot: metadata.commitmentRoot,
      partitionHash: metadata.partitionHash
    }
  };
}

// Encodes a Groth16 proof into Solidity verifier calldata format.
export function encodeTallySolidityCalldata(proof: unknown): TallySolidityCalldata {
  const tallyProof = readTallyProof(proof);
  if (
    !tallyProof ||
    tallyProof.protocol !== "verivote-tally-correctness-groth16-v1" ||
    tallyProof.proofMode !== "real" ||
    !tallyProof.valid ||
    !tallyProof.snarkjsProof ||
    typeof tallyProof.snarkjsProof !== "object" ||
    !isStringArray(tallyProof.snarkjsPublicSignals)
  ) {
    throw new Error("encodeTallySolidityCalldata: invalid real tally proof payload");
  }

  const integrityChecks = proofIntegrityChecks({
    proof: tallyProof,
    publicSignals: tallyProof.publicSignals,
    proofHash: tallyProof.proofHash
  });
  const failedIntegrity = Object.entries(integrityChecks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (failedIntegrity.length > 0) {
    throw new Error(
      `encodeTallySolidityCalldata: tally proof integrity checks failed: ${failedIntegrity.join(", ")}`
    );
  }

  const localVerification = verifyTallyCorrectnessProof({
    proof: tallyProof,
    publicSignals: tallyProof.publicSignals
  });
  if (!localVerification.verified) {
    throw new Error(
      `encodeTallySolidityCalldata: tally proof verification failed: ${localVerification.message}`
    );
  }

  const snarkjsProof = tallyProof.snarkjsProof as {
    pi_a?: unknown;
    pi_b?: unknown;
    pi_c?: unknown;
  };

  function toScalar(value: unknown): string {
    if (typeof value === "string") return BigInt(value).toString();
    if (typeof value === "number") return BigInt(value).toString();
    throw new Error("encodeTallySolidityCalldata: expected numeric scalar");
  }

  if (
    !Array.isArray(snarkjsProof.pi_a) ||
    snarkjsProof.pi_a.length < 2 ||
    !Array.isArray(snarkjsProof.pi_b) ||
    snarkjsProof.pi_b.length < 2 ||
    !Array.isArray(snarkjsProof.pi_c) ||
    snarkjsProof.pi_c.length < 2
  ) {
    throw new Error("encodeTallySolidityCalldata: snarkjs proof shape invalid");
  }

  const a: [string, string] = [
    toScalar((snarkjsProof.pi_a as unknown[])[0]),
    toScalar((snarkjsProof.pi_a as unknown[])[1])
  ];

  // pi_b comes in the order [[b00, b01], [b10, b11]] but the Solidity verifier
  // from snarkjs expects each inner pair reversed: [[b01, b00], [b11, b10]].
  const piB = snarkjsProof.pi_b as unknown[];
  if (
    !Array.isArray(piB[0]) ||
    (piB[0] as unknown[]).length < 2 ||
    !Array.isArray(piB[1]) ||
    (piB[1] as unknown[]).length < 2
  ) {
    throw new Error("encodeTallySolidityCalldata: pi_b shape invalid");
  }
  const b0 = piB[0] as unknown[];
  const b1 = piB[1] as unknown[];
  const b: [[string, string], [string, string]] = [
    [toScalar(b0[1]), toScalar(b0[0])],
    [toScalar(b1[1]), toScalar(b1[0])]
  ];

  const c: [string, string] = [
    toScalar((snarkjsProof.pi_c as unknown[])[0]),
    toScalar((snarkjsProof.pi_c as unknown[])[1])
  ];

  const input = tallyProof.snarkjsPublicSignals.map((signal) =>
    BigInt(signal).toString()
  );

  if (input.length !== TALLY_CANDIDATE_COUNT + 1) {
    throw new Error(
      `encodeTallySolidityCalldata: expected ${TALLY_CANDIDATE_COUNT + 1} public signals, got ${input.length}`
    );
  }

  return { a, b, c, input };
}
