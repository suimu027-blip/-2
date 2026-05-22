import { type FormEvent, useEffect, useMemo, useState } from "react";
import type {
  Election,
  ApiErrorResponse
} from "@verivote/shared";
import benchmarkResults from "./data/benchmark-results.json";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
export const receiptChainExplanation =
  "receipt chain 用于检测正式投票记录的删除、重排或回执链篡改。它不替代 Merkle proof，而是补充公共记录连续性验证。";

export type View =
  | "home"
  | "create"
  | "register"
  | "vote"
  | "challengeAudit"
  | "receipt"
  | "result"
  | "bulletin"
  | "merkle"
  | "aggregator"
  | "audit"
  | "chainAudit"
  | "zk"
  | "pedersen"
  | "tallyZk"
  | "export"
  | "benchmark"
  | "attack";

export type Portal = "home" | "voter" | "admin";
export type ActivePortal = Exclude<Portal, "home">;
export type NoticeType = "success" | "error";

export interface Notice {
  type: NoticeType;
  text: string;
}

export interface ApiOptions {
  method?: "GET" | "POST";
  body?: unknown;
}

export type ZkProofMode = "mock" | "real";

export type BenchmarkMetricName =
  | "commitmentGenerationMs"
  | "merkleBuildMs"
  | "merkleProofGenerationMs"
  | "merkleProofVerificationMs"
  | "aggregationMs"
  | "auditHashGenerationMs"
  | "totalMs";

export interface BenchmarkMetricSummary {
  average?: number;
  avg?: number;
  min: number;
  max: number;
}

export type BenchmarkSummary = Record<BenchmarkMetricName, BenchmarkMetricSummary>;

export interface BenchmarkCase {
  voteCount: number;
  candidateCount: number;
  proofSampleSize: number;
  summary: BenchmarkSummary;
}

export interface BenchmarkOutput {
  generatedAt: string;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
  };
  results: BenchmarkCase[];
}

export const benchmarkData = benchmarkResults as BenchmarkOutput;

export const benchmarkMetrics: Array<{
  key: BenchmarkMetricName;
  label: string;
  shortLabel: string;
}> = [
  {
    key: "commitmentGenerationMs",
    label: "commitmentGenerationMs",
    shortLabel: "Commitment"
  },
  {
    key: "merkleBuildMs",
    label: "merkleBuildMs",
    shortLabel: "Merkle build"
  },
  {
    key: "merkleProofGenerationMs",
    label: "merkleProofGenerationMs",
    shortLabel: "Proof gen"
  },
  {
    key: "merkleProofVerificationMs",
    label: "merkleProofVerificationMs",
    shortLabel: "Proof verify"
  },
  {
    key: "aggregationMs",
    label: "aggregationMs",
    shortLabel: "Aggregation"
  },
  {
    key: "auditHashGenerationMs",
    label: "auditHashGenerationMs",
    shortLabel: "Audit hash"
  },
  {
    key: "totalMs",
    label: "totalMs",
    shortLabel: "Total"
  }
];

export const voterNavItems: Array<{ view: View; label: string }> = [
  { view: "home", label: "首页" },
  { view: "register", label: "用户注册" },
  { view: "vote", label: "投票" },
  { view: "receipt", label: "回执查询" },
  { view: "result", label: "查看结果" },
  { view: "merkle", label: "Merkle 验证" }
];

export const adminNavItems: Array<{ view: View; label: string }> = [
  { view: "home", label: "首页" },
  { view: "create", label: "创建投票" },
  { view: "register", label: "用户管理" },
  { view: "bulletin", label: "公告板" },
  { view: "aggregator", label: "聚合器" },
  { view: "audit", label: "审计报告" },
  { view: "attack", label: "攻击演示" },
  { view: "chainAudit", label: "链上审计" },
  { view: "zk", label: "ZK 验证" },
  { view: "pedersen", label: "Pedersen 实验" },
  { view: "tallyZk", label: "Tally ZK" },
  { view: "export", label: "审计包导出" },
  { view: "benchmark", label: "性能评估" },
  { view: "challengeAudit", label: "挑战审计" }
];

export const portalNavItems: Record<ActivePortal, Array<{ view: View; label: string }>> = {
  voter: voterNavItems,
  admin: adminNavItems
};

export const portalLabels: Record<
  ActivePortal,
  {
    title: string;
    subtitle: string;
    homeTitle: string;
    homeLead: string;
    registerTitle: string;
    registerLead: string;
  }
> = {
  voter: {
    title: "投票端",
    subtitle: "Voter Portal",
    homeTitle: "投票端首页",
    homeLead:
      "面向普通投票用户的低门槛流程：完成身份登记，提交投票，用 receiptCode 查询回执，并验证自己的记录是否进入 Merkle 公告板。",
    registerTitle: "用户注册 / 身份登记",
    registerLead:
      "普通投票用户在这里自助登记身份，获取 userId 后即可进入投票流程。"
  },
  admin: {
    title: "审计管理端",
    subtitle: "Admin & Audit Console",
    homeTitle: "审计管理端首页",
    homeLead:
      "面向管理员、审计员和评委，集中展示投票配置、公告板、聚合审计、链上摘要、ZK 验证和挑战审计能力。",
    registerTitle: "用户管理 / 注册用户",
    registerLead:
      "管理员可在这里复用注册流程，快速创建演示用户或管理测试身份。"
  }
};

export const portalCards: Array<{
  portal: ActivePortal;
  title: string;
  subtitle: string;
  description: string;
  highlights: string[];
}> = [
  {
    portal: "voter",
    title: "投票端",
    subtitle: "Voter Portal",
    description:
      "为普通投票用户准备的清晰入口，聚焦身份登记、投票、回执查询、结果查看和个人 Merkle 验证。",
    highlights: ["用户注册 / 身份登记", "投票", "receiptCode 回执查询", "Merkle 验证"]
  },
  {
    portal: "admin",
    title: "审计管理端",
    subtitle: "Admin & Audit Console",
    description:
      "为管理员、审计员和评委准备的工程审计视图，集中展示安全机制、密码学验证 and 异常检测。",
    highlights: ["创建投票", "公告板 / 聚合器", "链上审计 / ZK 验证", "挑战审计"]
  }
];

export const capabilityLayers = [
  {
    title: "业务投票层",
    items: ["用户注册 / 身份登记", "投票", "receiptCode 回执查询", "查看结果"]
  },
  {
    title: "可验证审计层",
    items: ["receipt chain 连续性验证", "Merkle 公告板", "聚合器审计", "链上审计"]
  },
  {
    title: "密码增强层",
    items: ["Real Groth16 ZK proof", "cast-or-challenge 挑战审计", "攻击演示 / 异常检测", "性能评估"]
  }
];

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers:
      options.body === undefined
        ? undefined
        : {
            "Content-Type": "application/json"
          },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const data = (await response.json().catch(() => null)) as
    | ApiErrorResponse
    | T
    | null;

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? data.error
        : `请求失败 (${response.status})`;
    throw new Error(message);
  }

  return data as T;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

export function formatJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? String(value);
}

export function getBenchmarkAverage(
  summary: BenchmarkSummary,
  metricName: BenchmarkMetricName
): number {
  const metric = summary[metricName];
  return metric.average ?? metric.avg ?? 0;
}

export function formatBenchmarkMs(value: number): string {
  return `${value.toFixed(value >= 100 ? 1 : value >= 10 ? 2 : 3)} ms`;
}

export function NoticeMessage({ notice }: { notice: Notice | null }) {
  if (!notice) {
    return null;
  }

  return <p className={`notice ${notice.type}`}>{notice.text}</p>;
}

export function ElectionSelect({
  elections,
  value,
  onChange
}: {
  elections: Election[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">请选择投票</option>
      {elections.map((election) => (
        <option key={election.id} value={election.id}>
          {election.title}
        </option>
      ))}
    </select>
  );
}
