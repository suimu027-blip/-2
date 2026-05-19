import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorMessage?: string;
}

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const snarkjsCliPath = join(
  projectRoot,
  "node_modules",
  "snarkjs",
  "build",
  "cli.cjs"
);

interface CircuitPlan {
  label: string;
  source: string; // absolute path to .circom
  outputDir: string; // absolute path to artifact directory
  r1csName: string; // e.g. "valid_vote.r1cs"
  wasmSubdir: string; // e.g. "valid_vote_js"
  ptauPower: number; // 2^k constraints budget
  zkeyBase: string; // e.g. "valid_vote"
  contributionLabel: string;
  /**
   * If set, the zkey will be exported as a Solidity verifier. The generated
   * file is placed under `contracts/<contractName>.sol`, with the default
   * `Groth16Verifier` class renamed to `<contractName>`.
   */
  solidityVerifier?: {
    contractName: string;
  };
}

const PLANS: CircuitPlan[] = [
  {
    label: "valid_vote (single ballot one-hot)",
    source: join(projectRoot, "circuits", "valid_vote.circom"),
    outputDir: join(projectRoot, "zk-artifacts", "valid-vote"),
    r1csName: "valid_vote.r1cs",
    wasmSubdir: "valid_vote_js",
    ptauPower: 12,
    zkeyBase: "valid_vote",
    contributionLabel: "VeriVoteDemo"
  },
  {
    label: "tally_correctness (batch tally)",
    source: join(projectRoot, "circuits", "tally_correctness.circom"),
    outputDir: join(projectRoot, "zk-artifacts", "tally-correctness"),
    r1csName: "tally_correctness.r1cs",
    wasmSubdir: "tally_correctness_js",
    ptauPower: 14,
    zkeyBase: "tally_correctness",
    contributionLabel: "VeriVoteTallyDemo",
    solidityVerifier: { contractName: "TallyVerifier" }
  }
];

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

function runSnarkjs(args: string[]): CommandResult {
  if (!existsSync(snarkjsCliPath)) {
    throw new Error("snarkjs CLI not found. Run pnpm install first.");
  }
  return runCommand(process.execPath, [snarkjsCliPath, ...args]);
}

function hasCircom(): boolean {
  const result = runCommand("circom", ["--version"], { allowFailure: true });
  return result.exitCode === 0;
}

function logStep(message: string): void {
  console.log(`\n== ${message}`);
}

function buildPlan(plan: CircuitPlan): void {
  logStep(`[${plan.label}] Compile circom source`);
  rmSync(plan.outputDir, { recursive: true, force: true });
  mkdirSync(plan.outputDir, { recursive: true });

  runCommand("circom", [
    plan.source,
    "--r1cs",
    "--wasm",
    "--sym",
    "-o",
    plan.outputDir
  ]);

  const r1csPath = join(plan.outputDir, plan.r1csName);
  const wasmPath = join(plan.outputDir, plan.wasmSubdir, `${plan.zkeyBase}.wasm`);
  const witnessGenerator = join(plan.outputDir, plan.wasmSubdir, "generate_witness.js");
  if (!existsSync(r1csPath) || !existsSync(wasmPath) || !existsSync(witnessGenerator)) {
    throw new Error(`circom finished but artifacts are missing for ${plan.label}`);
  }

  const potLabel = `pot${plan.ptauPower}`;
  const pot0 = join(plan.outputDir, `${potLabel}_0000.ptau`);
  const pot1 = join(plan.outputDir, `${potLabel}_0001.ptau`);
  const potFinal = join(plan.outputDir, `${potLabel}_final.ptau`);
  const zkey0 = join(plan.outputDir, `${plan.zkeyBase}_0000.zkey`);
  const zkeyFinal = join(plan.outputDir, `${plan.zkeyBase}_final.zkey`);
  const vkey = join(plan.outputDir, "verification_key.json");

  logStep(`[${plan.label}] Run Groth16 trusted setup (2^${plan.ptauPower})`);
  runSnarkjs(["powersoftau", "new", "bn128", String(plan.ptauPower), pot0]);
  runSnarkjs([
    "powersoftau",
    "contribute",
    pot0,
    pot1,
    `--name=${plan.contributionLabel}`,
    `-e=${plan.contributionLabel}-entropy`
  ]);
  runSnarkjs(["powersoftau", "prepare", "phase2", pot1, potFinal]);
  runSnarkjs(["groth16", "setup", r1csPath, potFinal, zkey0]);
  runSnarkjs([
    "zkey",
    "contribute",
    zkey0,
    zkeyFinal,
    `--name=${plan.contributionLabel}Zkey`,
    `-e=${plan.contributionLabel}-zkey-entropy`
  ]);
  runSnarkjs(["zkey", "export", "verificationkey", zkeyFinal, vkey]);

  if (plan.solidityVerifier) {
    const { contractName } = plan.solidityVerifier;
    const contractsDir = join(projectRoot, "contracts");
    const generatedPath = join(contractsDir, `${contractName}.sol`);

    logStep(`[${plan.label}] Export Solidity verifier to contracts/${contractName}.sol`);
    runSnarkjs(["zkey", "export", "solidityverifier", zkeyFinal, generatedPath]);

    // snarkjs names the contract `Groth16Verifier` by default; rename it so
    // that multiple circuits (e.g. future valid_vote verifier) do not collide
    // and so that Hardhat and the `ITallyVerifier` interface can find it.
    const source = readFileSync(generatedPath, "utf8");
    const rewritten = source.replace(
      /contract\s+Groth16Verifier/g,
      `contract ${contractName}`
    );
    const header =
      `// SPDX-License-Identifier: MIT\n` +
      `// Auto-generated by pnpm zk:setup from ${plan.zkeyBase}_final.zkey.\n` +
      `// Do not edit by hand. This file is gitignored and regenerated on every setup.\n`;
    writeFileSync(generatedPath, `${header}\n${rewritten}`, "utf8");
    console.log(`  verifier: ${generatedPath}`);
  }

  console.log(`\n[${plan.label}] done.`);
  console.log(`  WASM: ${wasmPath}`);
  console.log(`  zkey: ${zkeyFinal}`);
  console.log(`  vkey: ${vkey}`);
}

function main(): void {
  console.log("VeriVote real ZK setup (valid_vote + tally_correctness)");

  if (!hasCircom()) {
    console.log("Skipped: Circom compiler was not found on PATH.");
    console.log("Install Circom 2, then run pnpm zk:setup again.");
    return;
  }

  for (const plan of PLANS) {
    buildPlan(plan);
  }

  console.log("\nAll ZK artifacts are ready.");
}

main();
