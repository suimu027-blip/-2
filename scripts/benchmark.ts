import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  createAuditHash,
  createCommitment,
  createMerkleLeaf,
  createReceiptCode,
  createVoteTokenHash,
  createVoteVector,
  getMerkleProof,
  getMerkleRoot,
  hashText,
  randomHex,
  verifyMerkleProof
} from "../packages/crypto/src/index";
import type {
  AggregatorReport,
  Candidate,
  ElectionResult,
  Vote
} from "../packages/shared/src/index";

const VOTE_COUNTS = [100, 1000, 5000, 10000] as const;
const CANDIDATE_COUNT = 4;
const REPETITIONS = 3;
const PROOF_SAMPLE_LIMIT = 32;

const METRIC_NAMES = [
  "commitmentGenerationMs",
  "merkleBuildMs",
  "merkleProofGenerationMs",
  "merkleProofVerificationMs",
  "aggregationMs",
  "auditHashGenerationMs",
  "totalMs"
] as const;

type MetricName = (typeof METRIC_NAMES)[number];
type PhaseMetrics = Record<MetricName, number>;
type AggregatorCoreFields = Omit<AggregatorReport, "auditHash" | "createdAt">;

interface SimulatedVote extends Vote {
  receiptCodeHash: string;
  merkleLeaf: string;
}

interface MetricSummary {
  average: number;
  min: number;
  max: number;
}

type SummaryMetrics = Record<MetricName, MetricSummary>;

interface BenchmarkRun extends PhaseMetrics {
  runIndex: number;
  voteCount: number;
  candidateCount: number;
  proofSampleSize: number;
  merkleRoot: string;
  auditHash: string;
  aggregation: {
    totalVotes: number;
    validVotes: number;
    invalidVotes: number;
    duplicateVotes: number;
    tallyResult: ElectionResult;
  };
}

interface BenchmarkCaseResult {
  voteCount: number;
  candidateCount: number;
  repetitions: number;
  proofSampleSize: number;
  runs: BenchmarkRun[];
  summary: SummaryMetrics;
}

interface BenchmarkOutput {
  generatedAt: string;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    osRelease: string;
    cpuModel: string;
    cpuCount: number;
    totalMemoryGb: number;
  };
  config: {
    voteCounts: readonly number[];
    candidateCount: number;
    repetitions: number;
    proofSampleLimit: number;
    defaultVotePolicy: "valid-only";
  };
  results: BenchmarkCaseResult[];
}

interface TimedResult<T> {
  value: T;
  ms: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

function time<T>(work: () => T): TimedResult<T> {
  const startedAt = performance.now();
  const value = work();
  return {
    value,
    ms: roundMs(performance.now() - startedAt)
  };
}

function createCandidates(electionId: string): Candidate[] {
  return Array.from({ length: CANDIDATE_COUNT }, (_, index) => ({
    id: `candidate-${index + 1}`,
    electionId,
    name: `Candidate ${index + 1}`
  }));
}

function createSimulatedVotes(
  electionId: string,
  candidates: Candidate[],
  voteCount: number,
  runIndex: number
): SimulatedVote[] {
  const candidateIds = candidates.map((candidate) => candidate.id);
  const baseTimestamp = Date.now();

  return Array.from({ length: voteCount }, (_, index) => {
    const candidateId = candidateIds[index % candidateIds.length];
    const userId = `user-${voteCount}-${runIndex}-${index + 1}`;
    const voteId = `vote-${voteCount}-${runIndex}-${index + 1}`;
    const createdAt = new Date(baseTimestamp + index).toISOString();
    const voteVector = createVoteVector(candidateIds, candidateId);
    const randomness = randomHex(32);
    const commitment = createCommitment(electionId, voteVector, randomness);
    const receiptCode = createReceiptCode(
      electionId,
      commitment,
      userId,
      createdAt
    );

    return {
      id: voteId,
      electionId,
      userId,
      candidateId,
      voteVector,
      randomness,
      commitment,
      receiptCode,
      receiptCodeHash: hashText(receiptCode),
      merkleLeaf: createMerkleLeaf(voteId, commitment, receiptCode),
      createdAt
    };
  });
}

function selectProofLeaves(leaves: string[]): string[] {
  if (leaves.length <= PROOF_SAMPLE_LIMIT) {
    return leaves;
  }

  const selectedIndexes = new Set<number>();
  const maxIndex = leaves.length - 1;

  for (let index = 0; index < PROOF_SAMPLE_LIMIT; index += 1) {
    selectedIndexes.add(Math.round((maxIndex * index) / (PROOF_SAMPLE_LIMIT - 1)));
  }

  return Array.from(selectedIndexes)
    .sort((left, right) => left - right)
    .map((index) => leaves[index]);
}

function createTallyResult(
  electionId: string,
  candidates: Candidate[],
  votes: SimulatedVote[]
): ElectionResult {
  const tallyByCandidate = new Map<string, number>(
    candidates.map((candidate) => [candidate.id, 0])
  );

  for (const vote of votes) {
    tallyByCandidate.set(
      vote.candidateId,
      (tallyByCandidate.get(vote.candidateId) ?? 0) + 1
    );
  }

  return {
    electionId,
    totalVotes: votes.length,
    results: candidates.map((candidate) => ({
      candidateId: candidate.id,
      candidateName: candidate.name,
      voteCount: tallyByCandidate.get(candidate.id) ?? 0
    }))
  };
}

function aggregateVotes(
  electionId: string,
  candidates: Candidate[],
  votes: SimulatedVote[]
): AggregatorCoreFields {
  const validCandidateIds = new Set(candidates.map((candidate) => candidate.id));
  const seenTokenHashes = new Set<string>();
  const duplicateTokenHashSet = new Set<string>();
  const voteTokenHashes: string[] = [];
  const validVoteRecords: SimulatedVote[] = [];
  let invalidVotes = 0;
  let duplicateVotes = 0;

  for (const vote of votes) {
    const voteTokenHash = createVoteTokenHash(electionId, vote.userId);
    voteTokenHashes.push(voteTokenHash);

    const isDuplicate = seenTokenHashes.has(voteTokenHash);
    if (isDuplicate) {
      duplicateVotes += 1;
      duplicateTokenHashSet.add(voteTokenHash);
    } else {
      seenTokenHashes.add(voteTokenHash);
    }

    const hasValidCandidate = validCandidateIds.has(vote.candidateId);
    if (!hasValidCandidate) {
      invalidVotes += 1;
    }

    if (!isDuplicate && hasValidCandidate) {
      validVoteRecords.push(vote);
    }
  }

  return {
    electionId,
    totalVotes: votes.length,
    validVotes: validVoteRecords.length,
    invalidVotes,
    duplicateVotes,
    voteTokenHashes,
    duplicateTokenHashes: Array.from(duplicateTokenHashSet),
    tallyResult: createTallyResult(electionId, candidates, validVoteRecords),
    commitmentRoot: getMerkleRoot(validVoteRecords.map((vote) => vote.commitment)),
    receiptRoot: getMerkleRoot(validVoteRecords.map((vote) => vote.receiptCode))
  };
}

function runBenchmark(voteCount: number, runIndex: number): BenchmarkRun {
  const electionId = `benchmark-election-${voteCount}-run-${runIndex}`;
  const candidates = createCandidates(electionId);
  const totalStartedAt = performance.now();

  const voteGeneration = time(() =>
    createSimulatedVotes(electionId, candidates, voteCount, runIndex)
  );
  const votes = voteGeneration.value;
  const leaves = votes.map((vote) => vote.merkleLeaf);
  const proofLeaves = selectProofLeaves(leaves);

  const merkleBuild = time(() => getMerkleRoot(leaves));
  const merkleRoot = merkleBuild.value;

  const proofGeneration = time(() =>
    proofLeaves.map((leaf) => ({
      leaf,
      proof: getMerkleProof(leaves, leaf)
    }))
  );

  const proofVerification = time(() =>
    proofGeneration.value.every(({ leaf, proof }) =>
      verifyMerkleProof(leaf, proof, merkleRoot)
    )
  );

  if (!proofVerification.value) {
    throw new Error(`Merkle proof verification failed for ${voteCount} votes`);
  }

  const aggregation = time(() => aggregateVotes(electionId, candidates, votes));
  const auditHashGeneration = time(() => createAuditHash(aggregation.value));

  return {
    runIndex,
    voteCount,
    candidateCount: candidates.length,
    proofSampleSize: proofLeaves.length,
    commitmentGenerationMs: voteGeneration.ms,
    merkleBuildMs: merkleBuild.ms,
    merkleProofGenerationMs: proofGeneration.ms,
    merkleProofVerificationMs: proofVerification.ms,
    aggregationMs: aggregation.ms,
    auditHashGenerationMs: auditHashGeneration.ms,
    totalMs: roundMs(performance.now() - totalStartedAt),
    merkleRoot,
    auditHash: auditHashGeneration.value,
    aggregation: {
      totalVotes: aggregation.value.totalVotes,
      validVotes: aggregation.value.validVotes,
      invalidVotes: aggregation.value.invalidVotes,
      duplicateVotes: aggregation.value.duplicateVotes,
      tallyResult: aggregation.value.tallyResult
    }
  };
}

function summarizeRuns(runs: BenchmarkRun[]): SummaryMetrics {
  return METRIC_NAMES.reduce((summary, metricName) => {
    const values = runs.map((run) => run[metricName]);
    const total = values.reduce((sum, value) => sum + value, 0);

    summary[metricName] = {
      average: roundMs(total / values.length),
      min: roundMs(Math.min(...values)),
      max: roundMs(Math.max(...values))
    };

    return summary;
  }, {} as SummaryMetrics);
}

function createBenchmarkOutput(): BenchmarkOutput {
  const cpu = os.cpus()[0];
  const results = VOTE_COUNTS.map((voteCount) => {
    const runs = Array.from({ length: REPETITIONS }, (_, index) =>
      runBenchmark(voteCount, index + 1)
    );

    return {
      voteCount,
      candidateCount: CANDIDATE_COUNT,
      repetitions: REPETITIONS,
      proofSampleSize: runs[0]?.proofSampleSize ?? 0,
      runs,
      summary: summarizeRuns(runs)
    };
  });

  return {
    generatedAt: nowIso(),
    environment: {
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      osRelease: os.release(),
      cpuModel: cpu?.model ?? "unknown",
      cpuCount: os.cpus().length,
      totalMemoryGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2))
    },
    config: {
      voteCounts: VOTE_COUNTS,
      candidateCount: CANDIDATE_COUNT,
      repetitions: REPETITIONS,
      proofSampleLimit: PROOF_SAMPLE_LIMIT,
      defaultVotePolicy: "valid-only"
    },
    results
  };
}

function formatMs(value: number): string {
  return value.toFixed(3);
}

function metricLabel(metricName: MetricName): string {
  const labels: Record<MetricName, string> = {
    commitmentGenerationMs: "Commitment generation",
    merkleBuildMs: "Merkle build",
    merkleProofGenerationMs: "Merkle proof generation",
    merkleProofVerificationMs: "Merkle proof verification",
    aggregationMs: "Aggregation",
    auditHashGenerationMs: "Audit hash generation",
    totalMs: "Total"
  };

  return labels[metricName];
}

function createCsv(output: BenchmarkOutput): string {
  const rows = [
    [
      "voteCount",
      "candidateCount",
      "proofSampleSize",
      "metric",
      "averageMs",
      "minMs",
      "maxMs"
    ].join(",")
  ];

  for (const result of output.results) {
    for (const metricName of METRIC_NAMES) {
      const metric = result.summary[metricName];
      rows.push(
        [
          result.voteCount,
          result.candidateCount,
          result.proofSampleSize,
          metricName,
          formatMs(metric.average),
          formatMs(metric.min),
          formatMs(metric.max)
        ].join(",")
      );
    }
  }

  return `${rows.join("\n")}\n`;
}

function findDominantMetric(summary: SummaryMetrics): MetricName {
  return METRIC_NAMES.filter((metricName) => metricName !== "totalMs").reduce(
    (dominant, metricName) =>
      summary[metricName].average > summary[dominant].average
        ? metricName
        : dominant,
    "commitmentGenerationMs" as MetricName
  );
}

function createMarkdown(output: BenchmarkOutput): string {
  const firstResult = output.results[0];
  const lastResult = output.results[output.results.length - 1];
  const totalScaleRatio =
    firstResult.summary.totalMs.average === 0
      ? 0
      : lastResult.summary.totalMs.average / firstResult.summary.totalMs.average;
  const dominantMetric = findDominantMetric(lastResult.summary);

  const resultRows = output.results.flatMap((result) =>
    METRIC_NAMES.map((metricName) => {
      const metric = result.summary[metricName];
      return `| ${result.voteCount} | ${result.candidateCount} | ${result.proofSampleSize} | ${metricLabel(metricName)} | ${formatMs(metric.average)} | ${formatMs(metric.min)} | ${formatMs(metric.max)} |`;
    })
  );

  return `# VeriVote Benchmark

> This file is generated by \`pnpm benchmark\`.

## 测试目的

本 benchmark 用于观察 VeriVote 当前核心投票闭环在不同投票规模下的本地执行耗时，包括 vote commitment 生成、Merkle Root 构建、Merkle proof 抽样生成与验证、聚合器统计和审计哈希生成。当前版本只覆盖本地内存流程，不包含 API、Web、智能合约、链上交易或 ZK proof。

## 测试环境

| 项目 | 值 |
| --- | --- |
| Generated at | ${output.generatedAt} |
| Node.js | ${output.environment.nodeVersion} |
| Platform | ${output.environment.platform} ${output.environment.arch} |
| OS release | ${output.environment.osRelease} |
| CPU | ${output.environment.cpuModel} |
| CPU cores | ${output.environment.cpuCount} |
| Memory | ${output.environment.totalMemoryGb} GB |

## 测试规模

| 配置项 | 值 |
| --- | --- |
| Vote counts | ${output.config.voteCounts.join(", ")} |
| Candidate count | ${output.config.candidateCount} |
| Repetitions | ${output.config.repetitions} |
| Vote policy | 默认生成合法票，不注入非法票和重复票 |
| Merkle proof sample | 每组最多抽样 ${output.config.proofSampleLimit} 个 leaf 生成并验证 proof |

## 指标解释

| 指标 | 含义 |
| --- | --- |
| commitmentGenerationMs | 批量生成 voteId、userId、candidateId、voteVector、randomness、commitment、receiptCode、receiptCodeHash 和 merkleLeaf 的耗时 |
| merkleBuildMs | 使用全部 merkleLeaf 计算 Merkle Root 的耗时 |
| merkleProofGenerationMs | 对抽样 leaf 调用 getMerkleProof 生成 Merkle proof 的耗时 |
| merkleProofVerificationMs | 对抽样 proof 调用 verifyMerkleProof 校验的耗时 |
| aggregationMs | 模拟聚合器执行 token hash、重复票检测、非法候选人检测、tallyResult、commitmentRoot 和 receiptRoot 的耗时 |
| auditHashGenerationMs | 对聚合器核心字段调用 createAuditHash 生成 auditHash 的耗时 |
| totalMs | 单次 benchmark case 从开始生成 vote 到 auditHash 生成完成的总耗时 |

## 结果表格

| Votes | Candidates | Proof sample | Metric | Average ms | Min ms | Max ms |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
${resultRows.join("\n")}

## 简要分析

在 ${lastResult.voteCount} votes 的最大规模下，平均总耗时为 ${formatMs(lastResult.summary.totalMs.average)} ms，约为 ${formatMs(totalScaleRatio)} 倍于 ${firstResult.voteCount} votes 场景。该规模下平均耗时最高的单项指标是 ${metricLabel(dominantMetric)}，平均为 ${formatMs(lastResult.summary[dominantMetric].average)} ms。

当前 Merkle proof 生成/验证采用固定上限抽样，适合轻量基准观察；如果后续需要评估“为每一张票都生成 proof”的成本，应增加单独的全量 proof 压力测试，避免和本地核心流程 benchmark 混在一起。

## 后续扩展

- 链上 gas 测试
- ZK proof 生成耗时
- ZK proof 验证耗时
`;
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(scriptPath), "..");
  const output = createBenchmarkOutput();

  await writeFile(
    path.join(repoRoot, "benchmark-results.json"),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );
  await writeFile(path.join(repoRoot, "benchmark-results.csv"), createCsv(output), "utf8");
  await writeFile(path.join(repoRoot, "docs", "BENCHMARK.md"), createMarkdown(output), "utf8");

  console.log("Benchmark complete.");
  console.log(`Results written to ${path.join(repoRoot, "benchmark-results.json")}`);
  console.log(`CSV written to ${path.join(repoRoot, "benchmark-results.csv")}`);
  console.log(`Docs written to ${path.join(repoRoot, "docs", "BENCHMARK.md")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
