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

export * from "./tally.js";

export type ZkProofMode = "mock" | "real";

export interface ZkValidityPublicSignals {
  electionIdHash: string;
  candidateCount: number;
  voteVectorCommitment: string;
}

export interface ZkValidityProofRequest {
  electionId: string;
  voteVector: number[];
  candidateCount: number;
  proofMode?: ZkProofMode;
}

export interface ZkValidityProofResponse {
  proofId: string;
  proofMode: ZkProofMode;
  publicSignals: ZkValidityPublicSignals;
  proof: unknown;
  valid: boolean;
  message: string;
}

export interface ZkValidityVerifyRequest {
  proof: unknown;
  publicSignals: ZkValidityPublicSignals;
  proofMode?: ZkProofMode;
}

export interface ZkValidityVerifyResponse {
  proofMode: ZkProofMode;
  verified: boolean;
  message: string;
}

interface ZkValidityAdapter {
  readonly proofMode: ZkProofMode;
  createProof(input: ZkValidityProofRequest): ZkValidityProofResponse;
  verifyProof(input: ZkValidityVerifyRequest): ZkValidityVerifyResponse;
}

interface MockValidityProof {
  protocol: "verivote-one-hot-validity-mock-v1";
  proofMode: "mock";
  proofId: string;
  electionIdHash: string;
  candidateCount: number;
  voteVector: number[];
  voteVectorCommitment: string;
  constraints: {
    bitsAreBoolean: boolean;
    sumEqualsOne: boolean;
    lengthMatchesCandidateCount: boolean;
  };
  valid: boolean;
  generatedAt: string;
  proofHash: string;
}

interface RealGroth16ValidityProof {
  protocol: "verivote-one-hot-validity-groth16-v1";
  proofMode: "real";
  proofId: string;
  circuitId: "valid-vote-4";
  generatedAt: string;
  electionIdHash: string;
  candidateCount: number;
  voteVector: number[];
  voteVectorCommitment: string;
  snarkjsProof: unknown | null;
  snarkjsPublicSignals: string[];
  artifactDirectory: string;
  valid: boolean;
  error?: string;
}

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorMessage?: string;
}

const MOCK_PROTOCOL = "verivote-one-hot-validity-mock-v1";
const REAL_PROTOCOL = "verivote-one-hot-validity-groth16-v1";
const REAL_CIRCUIT_ID = "valid-vote-4";
const REAL_CANDIDATE_COUNT = 4;

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const realArtifactDirectory =
  process.env.VERIVOTE_ZK_ARTIFACT_DIR ??
  join(projectRoot, "zk-artifacts", "valid-vote");

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

function createElectionIdHash(electionId: string): string {
  return hashText(`verivote.zk.election-id.v1:${electionId}`);
}

function createVoteVectorCommitment(input: {
  electionIdHash: string;
  candidateCount: number;
  voteVector: number[];
}): string {
  return hashText(
    stableStringify({
      domain: "verivote.zk.vote-vector-commitment.v1",
      electionIdHash: input.electionIdHash,
      candidateCount: input.candidateCount,
      voteVector: input.voteVector
    })
  );
}

function createProofHash(proof: Omit<MockValidityProof, "proofHash">): string {
  return hashText(
    stableStringify({
      domain: "verivote.zk.mock-proof-hash.v1",
      proof
    })
  );
}

function createPublicSignals(input: {
  electionId: string;
  candidateCount: number;
  voteVector: number[];
}): ZkValidityPublicSignals {
  const electionIdHash = createElectionIdHash(input.electionId);

  return {
    electionIdHash,
    candidateCount: input.candidateCount,
    voteVectorCommitment: createVoteVectorCommitment({
      electionIdHash,
      candidateCount: input.candidateCount,
      voteVector: input.voteVector
    })
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function readMockProof(proof: unknown): MockValidityProof | null {
  if (!isPlainObject(proof)) {
    return null;
  }

  const constraints = proof.constraints;

  if (!isPlainObject(constraints)) {
    return null;
  }

  if (
    proof.protocol !== MOCK_PROTOCOL ||
    proof.proofMode !== "mock" ||
    typeof proof.proofId !== "string" ||
    typeof proof.electionIdHash !== "string" ||
    !isPositiveInteger(proof.candidateCount) ||
    !isNumberArray(proof.voteVector) ||
    typeof proof.voteVectorCommitment !== "string" ||
    typeof constraints.bitsAreBoolean !== "boolean" ||
    typeof constraints.sumEqualsOne !== "boolean" ||
    typeof constraints.lengthMatchesCandidateCount !== "boolean" ||
    typeof proof.valid !== "boolean" ||
    typeof proof.generatedAt !== "string" ||
    typeof proof.proofHash !== "string"
  ) {
    return null;
  }

  return {
    protocol: MOCK_PROTOCOL,
    proofMode: "mock",
    proofId: proof.proofId,
    electionIdHash: proof.electionIdHash,
    candidateCount: proof.candidateCount,
    voteVector: proof.voteVector,
    voteVectorCommitment: proof.voteVectorCommitment,
    constraints: {
      bitsAreBoolean: constraints.bitsAreBoolean,
      sumEqualsOne: constraints.sumEqualsOne,
      lengthMatchesCandidateCount: constraints.lengthMatchesCandidateCount
    },
    valid: proof.valid,
    generatedAt: proof.generatedAt,
    proofHash: proof.proofHash
  };
}

function readRealProof(proof: unknown): RealGroth16ValidityProof | null {
  if (!isPlainObject(proof)) {
    return null;
  }

  if (
    proof.protocol !== REAL_PROTOCOL ||
    proof.proofMode !== "real" ||
    typeof proof.proofId !== "string" ||
    proof.circuitId !== REAL_CIRCUIT_ID ||
    typeof proof.generatedAt !== "string" ||
    typeof proof.electionIdHash !== "string" ||
    proof.candidateCount !== REAL_CANDIDATE_COUNT ||
    !isNumberArray(proof.voteVector) ||
    typeof proof.voteVectorCommitment !== "string" ||
    !("snarkjsProof" in proof) ||
    !isStringArray(proof.snarkjsPublicSignals) ||
    typeof proof.artifactDirectory !== "string" ||
    typeof proof.valid !== "boolean"
  ) {
    return null;
  }

  return {
    protocol: REAL_PROTOCOL,
    proofMode: "real",
    proofId: proof.proofId,
    circuitId: REAL_CIRCUIT_ID,
    generatedAt: proof.generatedAt,
    electionIdHash: proof.electionIdHash,
    candidateCount: proof.candidateCount,
    voteVector: proof.voteVector,
    voteVectorCommitment: proof.voteVectorCommitment,
    snarkjsProof: proof.snarkjsProof,
    snarkjsPublicSignals: proof.snarkjsPublicSignals,
    artifactDirectory: proof.artifactDirectory,
    valid: proof.valid,
    error: typeof proof.error === "string" ? proof.error : undefined
  };
}

export function isOneHotVector(voteVector: number[]): boolean {
  if (!Array.isArray(voteVector) || voteVector.length === 0) {
    return false;
  }

  const bitsAreBoolean = voteVector.every(
    (value) => Number.isInteger(value) && (value === 0 || value === 1)
  );
  const sum = voteVector.reduce((total, value) => total + value, 0);

  return bitsAreBoolean && sum === 1;
}

function getConstraintResult(input: {
  voteVector: number[];
  candidateCount: number;
}): MockValidityProof["constraints"] {
  const bitsAreBoolean = input.voteVector.every(
    (value) => Number.isInteger(value) && (value === 0 || value === 1)
  );
  const sum = input.voteVector.reduce((total, value) => total + value, 0);

  return {
    bitsAreBoolean,
    sumEqualsOne: sum === 1,
    lengthMatchesCandidateCount: input.voteVector.length === input.candidateCount
  };
}

function getValidityMessage(valid: boolean): string {
  return valid
    ? "voteVector is a valid one-hot vector"
    : "voteVector is invalid: every entry must be 0/1, length must match candidateCount, and the sum must equal 1";
}

function createMockAdapter(): ZkValidityAdapter {
  return {
    proofMode: "mock",
    createProof(input) {
      const publicSignals = createPublicSignals(input);
      const constraints = getConstraintResult(input);
      const valid =
        constraints.bitsAreBoolean &&
        constraints.sumEqualsOne &&
        constraints.lengthMatchesCandidateCount;
      const proofWithoutHash: Omit<MockValidityProof, "proofHash"> = {
        protocol: MOCK_PROTOCOL,
        proofMode: "mock",
        proofId: `zkp_${randomUUID()}`,
        electionIdHash: publicSignals.electionIdHash,
        candidateCount: publicSignals.candidateCount,
        voteVector: input.voteVector.slice(),
        voteVectorCommitment: publicSignals.voteVectorCommitment,
        constraints,
        valid,
        generatedAt: new Date().toISOString()
      };
      const proof: MockValidityProof = {
        ...proofWithoutHash,
        proofHash: createProofHash(proofWithoutHash)
      };

      return {
        proofId: proof.proofId,
        proofMode: "mock",
        publicSignals,
        proof,
        valid,
        message: getValidityMessage(valid)
      };
    },
    verifyProof(input) {
      const proof = readMockProof(input.proof);

      if (!proof) {
        return {
          proofMode: "mock",
          verified: false,
          message: "Mock ZK validity proof verification failed: invalid proof shape"
        };
      }

      const constraints = getConstraintResult({
        voteVector: proof.voteVector,
        candidateCount: proof.candidateCount
      });
      const recomputedCommitment = createVoteVectorCommitment({
        electionIdHash: input.publicSignals.electionIdHash,
        candidateCount: input.publicSignals.candidateCount,
        voteVector: proof.voteVector
      });
      const { proofHash: _proofHash, ...proofWithoutHash } = proof;
      const recomputedProofHash = createProofHash(proofWithoutHash);
      const valid =
        constraints.bitsAreBoolean &&
        constraints.sumEqualsOne &&
        constraints.lengthMatchesCandidateCount;
      const publicSignalsMatch =
        proof.electionIdHash === input.publicSignals.electionIdHash &&
        proof.candidateCount === input.publicSignals.candidateCount &&
        proof.voteVectorCommitment === input.publicSignals.voteVectorCommitment &&
        recomputedCommitment === input.publicSignals.voteVectorCommitment;
      const constraintsMatch =
        proof.constraints.bitsAreBoolean === constraints.bitsAreBoolean &&
        proof.constraints.sumEqualsOne === constraints.sumEqualsOne &&
        proof.constraints.lengthMatchesCandidateCount ===
          constraints.lengthMatchesCandidateCount &&
        proof.valid === valid;
      const proofHashMatches = proof.proofHash === recomputedProofHash;
      const verified = valid && publicSignalsMatch && constraintsMatch && proofHashMatches;

      return {
        proofMode: "mock",
        verified,
        message: verified
          ? "Mock ZK validity proof verification passed"
          : "Mock ZK validity proof verification failed: one-hot constraints, publicSignals, or proofHash do not match"
      };
    }
  };
}

function getSnarkjsCliPath(): string | null {
  const candidates = [
    join(packageRoot, "node_modules", "snarkjs", "build", "cli.cjs"),
    join(projectRoot, "node_modules", "snarkjs", "build", "cli.cjs")
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function getRealArtifacts() {
  return {
    directory: realArtifactDirectory,
    wasmPath: join(realArtifactDirectory, "valid_vote_js", "valid_vote.wasm"),
    witnessGeneratorPath: join(
      realArtifactDirectory,
      "valid_vote_js",
      "generate_witness.js"
    ),
    zkeyPath: join(realArtifactDirectory, "valid_vote_final.zkey"),
    verificationKeyPath: join(realArtifactDirectory, "verification_key.json")
  };
}

export function getRealZkArtifactStatus(): {
  ready: boolean;
  directory: string;
  missing: string[];
} {
  const artifacts = getRealArtifacts();
  const requiredFiles = [
    artifacts.wasmPath,
    artifacts.witnessGeneratorPath,
    artifacts.zkeyPath,
    artifacts.verificationKeyPath
  ];
  const missing = requiredFiles.filter((filePath) => !existsSync(filePath));

  return {
    ready: missing.length === 0,
    directory: artifacts.directory,
    missing
  };
}

function getArtifactMissingMessage(missing: string[]): string {
  const suffix =
    missing.length > 0 ? ` Missing: ${missing.join(", ")}` : "";

  return `Real ZK artifacts not found. Please run pnpm zk:setup first.${suffix}`;
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
  const commandLine = `${command} ${args.join(" ")}`;

  if (result.error && !options.allowFailure) {
    throw new Error(`${commandLine} failed: ${result.error.message}`);
  }

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${commandLine} exited with ${result.status}\n${stdout}${stderr}`
    );
  }

  return {
    exitCode: result.status,
    stdout,
    stderr,
    errorMessage: result.error?.message
  };
}

function runSnarkjs(
  args: string[],
  options: { allowFailure?: boolean } = {}
): CommandResult {
  const snarkjsCliPath = getSnarkjsCliPath();

  if (!snarkjsCliPath) {
    return {
      exitCode: null,
      stdout: "",
      stderr: "snarkjs CLI not found",
      errorMessage: "snarkjs CLI not found"
    };
  }

  return runCommand(process.execPath, [snarkjsCliPath, ...args], options);
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createRealProofShell(input: {
  publicSignals: ZkValidityPublicSignals;
  voteVector: number[];
  proofId?: string;
  snarkjsProof?: unknown | null;
  snarkjsPublicSignals?: string[];
  valid: boolean;
  error?: string;
}): RealGroth16ValidityProof {
  return {
    protocol: REAL_PROTOCOL,
    proofMode: "real",
    proofId: input.proofId ?? `zkp_${randomUUID()}`,
    circuitId: REAL_CIRCUIT_ID,
    generatedAt: new Date().toISOString(),
    electionIdHash: input.publicSignals.electionIdHash,
    candidateCount: input.publicSignals.candidateCount,
    voteVector: input.voteVector.slice(),
    voteVectorCommitment: input.publicSignals.voteVectorCommitment,
    snarkjsProof: input.snarkjsProof ?? null,
    snarkjsPublicSignals: input.snarkjsPublicSignals ?? [],
    artifactDirectory: realArtifactDirectory,
    valid: input.valid,
    error: input.error
  };
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

function realPublicSignalsMatchVoteVector(
  snarkjsPublicSignals: string[],
  voteVector: number[]
): boolean {
  const vectorSignals = voteVector.map((value) => String(value));
  const normalizedSignals = snarkjsPublicSignals.map(normalizeSignal);
  const expectedLayouts = [
    ["1", "1", ...vectorSignals],
    [...vectorSignals, "1", "1"],
    vectorSignals
  ];

  return expectedLayouts.some((layout) => signalArraysEqual(normalizedSignals, layout));
}

function verifySnarkProof(input: {
  snarkjsProof: unknown;
  snarkjsPublicSignals: string[];
}): boolean {
  const artifacts = getRealArtifacts();
  const tempDirectory = mkdtempSync(join(tmpdir(), "verivote-zk-verify-"));

  try {
    const proofPath = join(tempDirectory, "proof.json");
    const publicSignalsPath = join(tempDirectory, "public.json");

    writeJsonFile(proofPath, input.snarkjsProof);
    writeJsonFile(publicSignalsPath, input.snarkjsPublicSignals);

    const verifyResult = runSnarkjs(
      [
        "groth16",
        "verify",
        artifacts.verificationKeyPath,
        publicSignalsPath,
        proofPath
      ],
      { allowFailure: true }
    );

    return verifyResult.exitCode === 0;
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

export function createRealZkValidityProof(
  input: ZkValidityProofRequest
): ZkValidityProofResponse {
  const publicSignals = createPublicSignals(input);
  const proofId = `zkp_${randomUUID()}`;

  if (
    input.candidateCount !== REAL_CANDIDATE_COUNT ||
    input.voteVector.length !== REAL_CANDIDATE_COUNT
  ) {
    const error =
      "Real Groth16 circuit currently supports exactly 4 candidates and a voteVector length of 4";
    const proof = createRealProofShell({
      publicSignals,
      voteVector: input.voteVector,
      proofId,
      valid: false,
      error
    });

    return {
      proofId,
      proofMode: "real",
      publicSignals,
      proof,
      valid: false,
      message: error
    };
  }

  const artifactStatus = getRealZkArtifactStatus();

  if (!artifactStatus.ready) {
    const error = getArtifactMissingMessage(artifactStatus.missing);
    const proof = createRealProofShell({
      publicSignals,
      voteVector: input.voteVector,
      proofId,
      valid: false,
      error
    });

    return {
      proofId,
      proofMode: "real",
      publicSignals,
      proof,
      valid: false,
      message: error
    };
  }

  const artifacts = getRealArtifacts();
  const tempDirectory = mkdtempSync(join(tmpdir(), "verivote-zk-prove-"));

  try {
    const inputPath = join(tempDirectory, "input.json");
    const witnessPath = join(tempDirectory, "witness.wtns");
    const proofPath = join(tempDirectory, "proof.json");
    const snarkjsPublicSignalsPath = join(tempDirectory, "public.json");

    writeJsonFile(inputPath, { voteVector: input.voteVector });

    const witnessResult = runCommand(
      process.execPath,
      [
        artifacts.witnessGeneratorPath,
        artifacts.wasmPath,
        inputPath,
        witnessPath
      ],
      { allowFailure: true }
    );

    if (witnessResult.exitCode !== 0) {
      const error =
        "Real Groth16 witness generation failed; the voteVector does not satisfy valid_vote.circom one-hot constraints";
      const proof = createRealProofShell({
        publicSignals,
        voteVector: input.voteVector,
        proofId,
        valid: false,
        error
      });

      return {
        proofId,
        proofMode: "real",
        publicSignals,
        proof,
        valid: false,
        message: error
      };
    }

    const proveResult = runSnarkjs(
      ["groth16", "prove", artifacts.zkeyPath, witnessPath, proofPath, snarkjsPublicSignalsPath],
      { allowFailure: true }
    );

    if (proveResult.exitCode !== 0) {
      const error = "Real Groth16 proof generation failed";
      const proof = createRealProofShell({
        publicSignals,
        voteVector: input.voteVector,
        proofId,
        valid: false,
        error
      });

      return {
        proofId,
        proofMode: "real",
        publicSignals,
        proof,
        valid: false,
        message: error
      };
    }

    const snarkjsProof = readJsonFile(proofPath);
    const snarkjsPublicSignals = readJsonFile(snarkjsPublicSignalsPath);

    if (!isStringArray(snarkjsPublicSignals)) {
      const error = "Real Groth16 proof generated invalid public signal output";
      const proof = createRealProofShell({
        publicSignals,
        voteVector: input.voteVector,
        proofId,
        snarkjsProof,
        valid: false,
        error
      });

      return {
        proofId,
        proofMode: "real",
        publicSignals,
        proof,
        valid: false,
        message: error
      };
    }

    const snarkVerified = verifySnarkProof({
      snarkjsProof,
      snarkjsPublicSignals
    });
    const publicSignalsMatch = realPublicSignalsMatchVoteVector(
      snarkjsPublicSignals,
      input.voteVector
    );
    const valid = snarkVerified && publicSignalsMatch;
    const proof = createRealProofShell({
      publicSignals,
      voteVector: input.voteVector,
      proofId,
      snarkjsProof,
      snarkjsPublicSignals,
      valid,
      error: valid ? undefined : "Real Groth16 proof did not verify"
    });

    return {
      proofId,
      proofMode: "real",
      publicSignals,
      proof,
      valid,
      message: valid
        ? "Real Groth16 ZK proof generated and verified"
        : "Real Groth16 ZK proof generation completed, but verification failed"
    };
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

export function verifyRealZkValidityProof(
  input: ZkValidityVerifyRequest
): ZkValidityVerifyResponse {
  const proof = readRealProof(input.proof);

  if (!proof) {
    return {
      proofMode: "real",
      verified: false,
      message: "Real Groth16 ZK proof verification failed: invalid proof shape"
    };
  }

  if (!proof.snarkjsProof || proof.snarkjsPublicSignals.length === 0) {
    return {
      proofMode: "real",
      verified: false,
      message:
        proof.error ??
        "Real Groth16 ZK proof verification failed: proof was not generated"
    };
  }

  const artifactStatus = getRealZkArtifactStatus();

  if (!artifactStatus.ready) {
    return {
      proofMode: "real",
      verified: false,
      message: getArtifactMissingMessage(artifactStatus.missing)
    };
  }

  const recomputedCommitment = createVoteVectorCommitment({
    electionIdHash: input.publicSignals.electionIdHash,
    candidateCount: input.publicSignals.candidateCount,
    voteVector: proof.voteVector
  });
  const metadataMatches =
    proof.electionIdHash === input.publicSignals.electionIdHash &&
    proof.candidateCount === input.publicSignals.candidateCount &&
    proof.voteVectorCommitment === input.publicSignals.voteVectorCommitment &&
    recomputedCommitment === input.publicSignals.voteVectorCommitment;
  const publicSignalsMatch = realPublicSignalsMatchVoteVector(
    proof.snarkjsPublicSignals,
    proof.voteVector
  );
  const snarkVerified = verifySnarkProof({
    snarkjsProof: proof.snarkjsProof,
    snarkjsPublicSignals: proof.snarkjsPublicSignals
  });
  const verified = metadataMatches && publicSignalsMatch && snarkVerified;

  return {
    proofMode: "real",
    verified,
    message: verified
      ? "Real Groth16 ZK proof verification passed"
      : "Real Groth16 ZK proof verification failed: proof, publicSignals, or metadata do not match"
  };
}

const mockAdapter = createMockAdapter();

export function createZkValidityProof(
  input: ZkValidityProofRequest
): ZkValidityProofResponse {
  return input.proofMode === "real"
    ? createRealZkValidityProof(input)
    : mockAdapter.createProof(input);
}

export function verifyZkValidityProof(
  input: ZkValidityVerifyRequest
): ZkValidityVerifyResponse {
  if (
    input.proofMode === "real" ||
    (isPlainObject(input.proof) && input.proof.proofMode === "real")
  ) {
    return verifyRealZkValidityProof(input);
  }

  return mockAdapter.verifyProof(input);
}
