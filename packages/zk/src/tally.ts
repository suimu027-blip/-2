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

export interface TallyProofRequest {
  electionId: string;
  
  voteVectors: number[][];
  
  tally: number[];
}

export interface TallyPublicSignals {
  electionIdHash: string;
  tally: number[];
  batchSize: number;
  circuitId: string;
}

export interface TallyProof {
  protocol: "verivote-tally-correctness-groth16-v1";
  proofId: string;
  circuitId: string;
  generatedAt: string;
  electionIdHash: string;
  snarkjsProof: unknown | null;
  snarkjsPublicSignals: string[];
  artifactDirectory: string;
  valid: boolean;
  error?: string;
}

export interface TallyProofResponse {
  proofId: string;
  publicSignals: TallyPublicSignals;
  proof: TallyProof;
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

function createElectionIdHash(electionId: string): string {
  return hashText(`verivote.zk.tally.election-id.v1:${electionId}`);
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function validateRequest(input: TallyProofRequest): string | null {
  if (!Array.isArray(input.voteVectors) || input.voteVectors.length !== TALLY_BATCH_SIZE) {
    return `voteVectors must be an array of length ${TALLY_BATCH_SIZE}`;
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
  // Consistency check (caught again by the circuit, but good to reject early).
  const columnSums = new Array(TALLY_CANDIDATE_COUNT).fill(0);
  for (const row of input.voteVectors) {
    for (let j = 0; j < TALLY_CANDIDATE_COUNT; j++) columnSums[j] += row[j];
  }
  for (let j = 0; j < TALLY_CANDIDATE_COUNT; j++) {
    if (columnSums[j] !== input.tally[j]) {
      return `tally[${j}] (${input.tally[j]}) does not match column sum (${columnSums[j]})`;
    }
  }
  return null;
}

function createProofShell(input: {
  publicSignals: TallyPublicSignals;
  proofId: string;
  snarkjsProof?: unknown | null;
  snarkjsPublicSignals?: string[];
  valid: boolean;
  error?: string;
}): TallyProof {
  return {
    protocol: "verivote-tally-correctness-groth16-v1",
    proofId: input.proofId,
    circuitId: TALLY_CIRCUIT_ID,
    generatedAt: new Date().toISOString(),
    electionIdHash: input.publicSignals.electionIdHash,
    snarkjsProof: input.snarkjsProof ?? null,
    snarkjsPublicSignals: input.snarkjsPublicSignals ?? [],
    artifactDirectory: tallyArtifactDirectory,
    valid: input.valid,
    error: input.error
  };
}

export function createTallyCorrectnessProof(
  input: TallyProofRequest
): TallyProofResponse {
  const electionIdHash = createElectionIdHash(input.electionId);
  const publicSignals: TallyPublicSignals = {
    electionIdHash,
    tally: input.tally.slice(),
    batchSize: TALLY_BATCH_SIZE,
    circuitId: TALLY_CIRCUIT_ID
  };
  const proofId = `zkp_tally_${randomUUID()}`;

  const validationError = validateRequest(input);
  if (validationError) {
    const proof = createProofShell({
      publicSignals,
      proofId,
      valid: false,
      error: validationError
    });
    return {
      proofId,
      publicSignals,
      proof,
      valid: false,
      message: validationError
    };
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
      valid: false,
      error: message
    });
    return { proofId, publicSignals, proof, valid: false, message };
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
      tally: input.tally,
      batchSize: TALLY_BATCH_SIZE
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
      return {
        proofId,
        publicSignals,
        proof: createProofShell({ publicSignals, proofId, valid: false, error }),
        valid: false,
        message: error
      };
    }

    const proveRes = runSnarkjs(
      ["groth16", "prove", artifacts.zkeyPath, witnessPath, proofPath, publicPath],
      { allowFailure: true }
    );
    if (proveRes.exitCode !== 0) {
      const error = "Tally correctness Groth16 prove failed";
      return {
        proofId,
        publicSignals,
        proof: createProofShell({ publicSignals, proofId, valid: false, error }),
        valid: false,
        message: error
      };
    }

    const snarkjsProof = readJsonFile(proofPath);
    const snarkjsPublicSignals = readJsonFile(publicPath);
    if (!isStringArray(snarkjsPublicSignals)) {
      const error = "Tally correctness prove produced invalid public signals";
      return {
        proofId,
        publicSignals,
        proof: createProofShell({ publicSignals, proofId, snarkjsProof, valid: false, error }),
        valid: false,
        message: error
      };
    }

    // Self-verify before returning.
    const verifyRes = runSnarkjs(
      ["groth16", "verify", artifacts.verificationKeyPath, publicPath, proofPath],
      { allowFailure: true }
    );
    const verified = verifyRes.exitCode === 0;
    return {
      proofId,
      publicSignals,
      proof: createProofShell({
        publicSignals,
        proofId,
        snarkjsProof,
        snarkjsPublicSignals,
        valid: verified,
        error: verified ? undefined : "Self-verification failed"
      }),
      valid: verified,
      message: verified
        ? "Tally correctness proof generated and verified."
        : "Tally correctness proof generation completed, but verification failed."
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function verifyTallyCorrectnessProof(
  input: TallyVerifyRequest
): TallyVerifyResponse {
  if (
    !input.proof ||
    typeof input.proof !== "object" ||
    Array.isArray(input.proof)
  ) {
    return { verified: false, message: "invalid proof shape" };
  }
  const proof = input.proof as Partial<TallyProof>;
  if (
    proof.protocol !== "verivote-tally-correctness-groth16-v1" ||
    proof.circuitId !== TALLY_CIRCUIT_ID ||
    !proof.snarkjsProof ||
    !isStringArray(proof.snarkjsPublicSignals) ||
    typeof proof.electionIdHash !== "string"
  ) {
    return { verified: false, message: "invalid proof payload" };
  }
  if (proof.electionIdHash !== input.publicSignals.electionIdHash) {
    return {
      verified: false,
      message: "publicSignals.electionIdHash does not match the proof's electionIdHash"
    };
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

// Encodes a Groth16 proof into Solidity verifier calldata format.
export function encodeTallySolidityCalldata(proof: unknown): TallySolidityCalldata {
  const tallyProof = proof as Partial<TallyProof>;
  if (
    !tallyProof ||
    tallyProof.protocol !== "verivote-tally-correctness-groth16-v1" ||
    tallyProof.circuitId !== TALLY_CIRCUIT_ID ||
    !tallyProof.snarkjsProof ||
    typeof tallyProof.snarkjsProof !== "object" ||
    !isStringArray(tallyProof.snarkjsPublicSignals)
  ) {
    throw new Error("encodeTallySolidityCalldata: invalid tally proof payload");
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
