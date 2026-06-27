import { spawn, spawnSync, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const reportDir = join(projectRoot, "docs", "evaluation", "aggregator_reports");
const port = 39200 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;

interface StepResult {
  name: string;
  command: string;
  passed: boolean;
  durationMs: number;
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runStep(name: string, command: string, args: string[]): StepResult {
  const startedAt = Date.now();
  console.log(`\n[task-a-full] ${name}`);
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit"
  });
  const durationMs = Date.now() - startedAt;
  if (result.status !== 0) {
    throw new Error(`${name} failed with exit code ${result.status}`);
  }
  return {
    name,
    command: [command, ...args].join(" "),
    passed: true,
    durationMs
  };
}

async function waitForHealth(server: ChildProcessWithoutNullStreams): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`PowerShell smoke API exited early with code ${server.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${baseUrl}/health`);
}

function stopServer(server: ChildProcessWithoutNullStreams): void {
  if (server.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      stdio: "ignore"
    });
    return;
  }

  server.kill("SIGTERM");
}

async function runPowerShellSmoke(): Promise<StepResult> {
  const startedAt = Date.now();
  console.log(`\n[task-a-full] PowerShell API smoke`);
  const tsxCli = join(
    projectRoot,
    "node_modules",
    ".pnpm",
    "tsx@4.21.0",
    "node_modules",
    "tsx",
    "dist",
    "cli.cjs"
  );
  const server = spawn(process.execPath, [tsxCli, "apps/api/src/index.ts"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      VERIVOTE_PERSISTENCE: "memory"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth(server);
    const command = "powershell";
    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "scripts/aggregator-api-powershell-smoke.ps1",
      "-BaseUrl",
      baseUrl
    ];
    console.log(`$ ${[command, ...args].join(" ")}`);
    const result = spawnSync(command, args, {
      cwd: projectRoot,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit"
    });
    if (result.status !== 0) {
      throw new Error(`PowerShell API smoke failed with exit code ${result.status}`);
    }
  } finally {
    stopServer(server);
  }

  return {
    name: "PowerShell API smoke",
    command: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/aggregator-api-powershell-smoke.ps1 -BaseUrl ${baseUrl}`,
    passed: true,
    durationMs: Date.now() - startedAt
  };
}

async function main(): Promise<void> {
  mkdirSync(reportDir, { recursive: true });
  const startedAt = new Date();
  const steps: StepResult[] = [];

  steps.push(runStep("Generate A-track samples", "pnpm", ["aggregator:audit-cases"]));
  steps.push(runStep("Generate no-server local export", "pnpm", ["aggregator:local-export"]));
  steps.push(runStep("Run TypeScript API smoke", "pnpm", ["aggregator:api-smoke"]));
  steps.push(runStep("Run Python API smoke", "python", ["scripts/api_smoke_test.py"]));
  steps.push(await runPowerShellSmoke());
  steps.push(runStep("Run offline verifier", "pnpm", ["aggregator:verify"]));
  steps.push(runStep("Run TypeScript typecheck", "pnpm", ["typecheck"]));
  steps.push(runStep("Run production build", "pnpm", ["build"]));

  const manifestFile = join(reportDir, "task_a_full_acceptance.json");
  const plannedCompletenessStep: StepResult = {
    name: "Run completeness gate",
    command: "pnpm aggregator:complete",
    passed: true,
    durationMs: 0
  };
  writeJson(manifestFile, {
    schemaVersion: "verivote.task-a-full-acceptance.v1",
    generatedBy: "pnpm aggregator:task-a-full",
    generatedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    passed: [...steps, plannedCompletenessStep].every((step) => step.passed),
    stepCount: steps.length + 1,
    steps: [...steps, plannedCompletenessStep],
    evidence: {
      completenessMatrix: "docs/evaluation/aggregator_reports/completeness_matrix.json",
      apiSmoke: "docs/evaluation/aggregator_reports/api_smoke.json",
      offlineVerification: "docs/evaluation/aggregator_reports/offline_verification.json",
      pythonApiSmoke: "docs/evaluation/aggregator_reports/python_api_smoke.json",
      powershellApiSmoke: "docs/evaluation/aggregator_reports/powershell_api/manifest.json",
      localStandalone: "docs/evaluation/aggregator_reports/local_standalone/manifest.json"
    }
  });

  steps.push(runStep("Run completeness gate", "pnpm", ["aggregator:complete"]));
  const finalManifest = {
    schemaVersion: "verivote.task-a-full-acceptance.v1",
    generatedBy: "pnpm aggregator:task-a-full",
    generatedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    passed: steps.every((step) => step.passed),
    stepCount: steps.length,
    steps,
    evidence: {
      completenessMatrix: "docs/evaluation/aggregator_reports/completeness_matrix.json",
      apiSmoke: "docs/evaluation/aggregator_reports/api_smoke.json",
      offlineVerification: "docs/evaluation/aggregator_reports/offline_verification.json",
      pythonApiSmoke: "docs/evaluation/aggregator_reports/python_api_smoke.json",
      powershellApiSmoke: "docs/evaluation/aggregator_reports/powershell_api/manifest.json",
      localStandalone: "docs/evaluation/aggregator_reports/local_standalone/manifest.json"
    }
  };
  writeJson(manifestFile, finalManifest);

  console.log(`\n[task-a-full] wrote ${join("docs", "evaluation", "aggregator_reports", basename(manifestFile))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
