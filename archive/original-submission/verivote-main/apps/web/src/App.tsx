import { type FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AggregatorReport,
  ApiErrorResponse,
  AttackLog,
  AttackResponse,
  BlockchainAuditRecord,
  BulletinBoard,
  CastPreparedBallotResponse,
  CastVoteRequest,
  CastVoteResponse,
  Candidate,
  ChallengePreparedBallotResponse,
  ChallengeRecord,
  CreateCandidateRequest,
  CreateCandidateResponse,
  CreateElectionRequest,
  CreateElectionResponse,
  Election,
  ElectionDetail,
  FinalizeElectionResponse,
  GetAttackLogsResponse,
  GetAggregatorReportResponse,
  GetBulletinBoardResponse,
  GetBlockchainAuditResponse,
  GetElectionResponse,
  GetElectionResultResponse,
  GetChallengeRecordsResponse,
  GetReceiptProofResponse,
  GetReceiptResponse,
  ListElectionsResponse,
  PendingBallot,
  PrepareBallotRequest,
  PrepareBallotResponse,
  RegisterUserRequest,
  RegisterUserResponse,
  ReceiptChainBreak,
  ReceiptChainRecord,
  RunAggregatorResponse,
  SubmitBlockchainAuditResponse,
  User,
  ZkValidityProofRequest,
  ZkValidityProofResponse,
  ZkValidityVerifyRequest,
  ZkValidityVerifyResponse
} from "@verivote/shared";
import benchmarkResults from "./data/benchmark-results.json";
import "./styles.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const receiptChainExplanation =
  "receipt chain 用于检测正式投票记录的删除、重排或回执链篡改。它不替代 Merkle proof，而是补充公共记录连续性验证。";

type View =
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
type Portal = "home" | "voter" | "admin";
type ActivePortal = Exclude<Portal, "home">;
type NoticeType = "success" | "error";

interface Notice {
  type: NoticeType;
  text: string;
}

interface ApiOptions {
  method?: "GET" | "POST";
  body?: unknown;
}

type ZkProofMode = "mock" | "real";

interface ZkProofModeRequest extends ZkValidityProofRequest {
  proofMode: ZkProofMode;
}

type BenchmarkMetricName =
  | "commitmentGenerationMs"
  | "merkleBuildMs"
  | "merkleProofGenerationMs"
  | "merkleProofVerificationMs"
  | "aggregationMs"
  | "auditHashGenerationMs"
  | "totalMs";

interface BenchmarkMetricSummary {
  average?: number;
  avg?: number;
  min: number;
  max: number;
}

type BenchmarkSummary = Record<BenchmarkMetricName, BenchmarkMetricSummary>;

interface BenchmarkCase {
  voteCount: number;
  candidateCount: number;
  proofSampleSize: number;
  summary: BenchmarkSummary;
}

interface BenchmarkOutput {
  generatedAt: string;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
  };
  results: BenchmarkCase[];
}

const benchmarkData = benchmarkResults as BenchmarkOutput;

const benchmarkMetrics: Array<{
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

const voterNavItems: Array<{ view: View; label: string }> = [
  { view: "home", label: "首页" },
  { view: "register", label: "用户注册" },
  { view: "vote", label: "投票" },
  { view: "receipt", label: "回执查询" },
  { view: "result", label: "查看结果" },
  { view: "merkle", label: "Merkle 验证" }
];

const adminNavItems: Array<{ view: View; label: string }> = [
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

const portalNavItems: Record<ActivePortal, Array<{ view: View; label: string }>> = {
  voter: voterNavItems,
  admin: adminNavItems
};

const portalLabels: Record<
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

const portalCards: Array<{
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
      "为管理员、审计员和评委准备的工程审计视图，集中展示安全机制、密码学验证和异常检测。",
    highlights: ["创建投票", "公告板 / 聚合器", "链上审计 / ZK 验证", "挑战审计"]
  }
];

const capabilityLayers = [
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

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? String(value);
}

function getBenchmarkAverage(
  summary: BenchmarkSummary,
  metricName: BenchmarkMetricName
): number {
  const metric = summary[metricName];
  return metric.average ?? metric.avg ?? 0;
}

function formatBenchmarkMs(value: number): string {
  return `${value.toFixed(value >= 100 ? 1 : value >= 10 ? 2 : 3)} ms`;
}

function NoticeMessage({ notice }: { notice: Notice | null }) {
  if (!notice) {
    return null;
  }

  return <p className={`notice ${notice.type}`}>{notice.text}</p>;
}

function ElectionSelect({
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

function PlatformHomePage({
  onSelectPortal
}: {
  onSelectPortal: (portal: ActivePortal) => void;
}) {
  return (
    <section className="page-section platform-home">
      <div className="platform-hero">
        <p className="eyebrow">VeriVote</p>
        <h1>VeriVote</h1>
        <p>隐私保护可验证电子投票系统</p>
      </div>

      <div className="portal-card-grid">
        {portalCards.map((card) => (
          <button
            key={card.portal}
            type="button"
            className={`portal-card ${card.portal}`}
            onClick={() => onSelectPortal(card.portal)}
          >
            <span>{card.subtitle}</span>
            <strong>{card.title}</strong>
            <p>{card.description}</p>
            <ul>
              {card.highlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      <div className="capability-grid">
        {capabilityLayers.map((layer) => (
          <section key={layer.title} className="capability-panel">
            <h2>{layer.title}</h2>
            <div className="capability-list">
              {layer.items.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function HomePage({
  portal,
  elections,
  onRefresh
}: {
  portal: ActivePortal;
  elections: Election[];
  onRefresh: () => Promise<void>;
}) {
  const portalInfo = portalLabels[portal];

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">{portalInfo.subtitle}</p>
          <h1>{portalInfo.homeTitle}</h1>
        </div>
        <button type="button" className="secondary" onClick={() => void onRefresh()}>
          刷新
        </button>
      </div>

      <p className="page-lead">{portalInfo.homeLead}</p>

      <div className="stats">
        <div>
          <span>{elections.length}</span>
          <p>投票数</p>
        </div>
        <div>
          <span>{elections.filter((election) => election.status === "active").length}</span>
          <p>进行中</p>
        </div>
      </div>

      <div className="panel">
        <h2>投票列表</h2>
        {elections.length === 0 ? (
          <p className="empty">暂无投票</p>
        ) : (
          <div className="list">
            {elections.map((election) => (
              <article key={election.id} className="list-row">
                <div>
                  <strong>{election.title}</strong>
                  <p>{election.description || "无描述"}</p>
                </div>
                <code>{election.id}</code>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CreateElectionPage({
  elections,
  onRefreshElections
}: {
  elections: Election[];
  onRefreshElections: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [candidateElectionId, setCandidateElectionId] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [candidateDetail, setCandidateDetail] = useState<ElectionDetail | null>(
    null
  );
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!candidateElectionId && elections.length > 0) {
      setCandidateElectionId(elections[0].id);
    }
  }, [candidateElectionId, elections]);

  useEffect(() => {
    let ignore = false;

    async function loadCandidates() {
      if (!candidateElectionId) {
        setCandidateDetail(null);
        return;
      }

      try {
        const data = await apiRequest<GetElectionResponse>(
          `/elections/${candidateElectionId}`
        );

        if (!ignore) {
          setCandidateDetail(data.election);
        }
      } catch (error) {
        if (!ignore) {
          setNotice({ type: "error", text: getErrorMessage(error) });
          setCandidateDetail(null);
        }
      }
    }

    void loadCandidates();

    return () => {
      ignore = true;
    };
  }, [candidateElectionId]);

  async function handleCreateElection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    try {
      const body: CreateElectionRequest = { title, description };
      const data = await apiRequest<CreateElectionResponse>("/elections", {
        method: "POST",
        body
      });

      setTitle("");
      setDescription("");
      setCandidateElectionId(data.election.id);
      await onRefreshElections();
      setNotice({
        type: "success",
        text: `已创建投票 ${data.election.id}`
      });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  async function handleAddCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    if (!candidateElectionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      const body: CreateCandidateRequest = { name: candidateName };
      const data = await apiRequest<CreateCandidateResponse>(
        `/elections/${candidateElectionId}/candidates`,
        {
          method: "POST",
          body
        }
      );
      const detail = await apiRequest<GetElectionResponse>(
        `/elections/${candidateElectionId}`
      );

      setCandidateName("");
      setCandidateDetail(detail.election);
      setNotice({
        type: "success",
        text: `已添加候选人 ${data.candidate.id}`
      });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Election</p>
          <h1>创建投票</h1>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <div className="two-column">
        <form className="panel form" onSubmit={handleCreateElection}>
          <h2>新投票</h2>
          <label>
            标题
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：最佳项目提案"
            />
          </label>
          <label>
            描述
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="补充投票背景"
              rows={4}
            />
          </label>
          <button type="submit">创建</button>
        </form>

        <form className="panel form" onSubmit={handleAddCandidate}>
          <h2>候选人管理</h2>
          <label>
            投票
            <ElectionSelect
              elections={elections}
              value={candidateElectionId}
              onChange={setCandidateElectionId}
            />
          </label>
          <label>
            候选人名称
            <input
              value={candidateName}
              onChange={(event) => setCandidateName(event.target.value)}
              placeholder="例如：方案 A"
            />
          </label>
          <button type="submit" disabled={!candidateElectionId}>
            添加候选人
          </button>

          <div className="inline-list">
            {(candidateDetail?.candidates ?? []).map((candidate) => (
              <span key={candidate.id}>
                {candidate.name} <code>{candidate.id}</code>
              </span>
            ))}
          </div>
        </form>
      </div>
    </section>
  );
}

function RegisterUserPage({
  title = "用户注册",
  description
}: {
  title?: string;
  description?: string;
} = {}) {
  const [name, setName] = useState("");
  const [registeredUser, setRegisteredUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    try {
      const body: RegisterUserRequest = { name };
      const data = await apiRequest<RegisterUserResponse>("/users/register", {
        method: "POST",
        body
      });

      setName("");
      setRegisteredUser(data.user);
      setNotice({ type: "success", text: "用户注册成功" });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">User</p>
          <h1>{title}</h1>
        </div>
      </div>

      {description ? <p className="page-lead">{description}</p> : null}

      <NoticeMessage notice={notice} />

      <form className="panel form narrow" onSubmit={handleRegister}>
        <label>
          用户名
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="输入用户名"
          />
        </label>
        <button type="submit">注册</button>
      </form>

      {registeredUser ? (
        <div className="panel result-box">
          <h2>userId</h2>
          <code>{registeredUser.id}</code>
          <p>{registeredUser.name}</p>
        </div>
      ) : null}
    </section>
  );
}

function VotePage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [detail, setDetail] = useState<ElectionDetail | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [userId, setUserId] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [receipt, setReceipt] = useState<CastVoteResponse | null>(null);

  const candidates = useMemo<Candidate[]>(
    () => detail?.candidates ?? [],
    [detail]
  );

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  useEffect(() => {
    let ignore = false;

    async function loadElection() {
      if (!electionId) {
        setDetail(null);
        return;
      }

      try {
        const data = await apiRequest<GetElectionResponse>(
          `/elections/${electionId}`
        );

        if (!ignore) {
          setDetail(data.election);
        }
      } catch (error) {
        if (!ignore) {
          setNotice({ type: "error", text: getErrorMessage(error) });
          setDetail(null);
        }
      }
    }

    void loadElection();

    return () => {
      ignore = true;
    };
  }, [electionId]);

  useEffect(() => {
    if (!candidates.some((candidate) => candidate.id === candidateId)) {
      setCandidateId(candidates[0]?.id ?? "");
    }
  }, [candidateId, candidates]);

  async function handleVote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setReceipt(null);

    if (!electionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      const body: CastVoteRequest = { userId, candidateId };
      const data = await apiRequest<CastVoteResponse>(
        `/elections/${electionId}/vote`,
        {
          method: "POST",
          body
        }
      );

      setReceipt(data);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Vote</p>
          <h1>投票</h1>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <form className="panel form narrow" onSubmit={handleVote}>
        <label>
          投票
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={setElectionId}
          />
        </label>
        <label>
          userId
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="例如：user_1"
          />
        </label>
        <label>
          候选人
          <select
            value={candidateId}
            onChange={(event) => setCandidateId(event.target.value)}
          >
            <option value="">请选择候选人</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!electionId || !candidateId}>
          提交投票
        </button>
      </form>

      {receipt ? (
        <div className="panel receipt-panel">
          <h2>投票成功</h2>
          <div className="hash-list">
            <div>
              <span>voteId</span>
              <code className="hash-value">{receipt.voteId}</code>
            </div>
            <div>
              <span>receiptCode</span>
              <code className="hash-value">{receipt.receiptCode}</code>
            </div>
            <div>
              <span>commitment</span>
              <code className="hash-value">{receipt.commitment}</code>
            </div>
            <div>
              <span>receiptChainIndex</span>
              <code className="hash-value">{receipt.receiptChainIndex}</code>
            </div>
            <div>
              <span>previousReceiptCodeHash</span>
              <code className="hash-value">
                {receipt.previousReceiptCodeHash ?? "null"}
              </code>
            </div>
            <div>
              <span>receiptChainHash</span>
              <code className="hash-value">{receipt.receiptChainHash}</code>
            </div>
            <div>
              <span>voteVector</span>
              <code className="hash-value">
                [{receipt.voteVector.join(", ")}]
              </code>
            </div>
          </div>
          <p className="receipt-note">
            回执码只能证明选票已被记录，不能证明你投给了谁。
          </p>
        </div>
      ) : null}
    </section>
  );
}

function ChallengeAuditPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [detail, setDetail] = useState<ElectionDetail | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [userId, setUserId] = useState("");
  const [pendingBallot, setPendingBallot] = useState<PendingBallot | null>(null);
  const [castResult, setCastResult] =
    useState<CastPreparedBallotResponse | null>(null);
  const [challengeResult, setChallengeResult] =
    useState<ChallengePreparedBallotResponse | null>(null);
  const [records, setRecords] = useState<GetChallengeRecordsResponse | null>(
    null
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingAction, setLoadingAction] = useState<
    "prepare" | "cast" | "challenge" | null
  >(null);

  const candidates = useMemo<Candidate[]>(
    () => detail?.candidates ?? [],
    [detail]
  );
  const challengeBallots = useMemo<PendingBallot[]>(
    () => records?.pendingBallots ?? [],
    [records]
  );
  const challengeRecords = useMemo<ChallengeRecord[]>(
    () => records?.challengeRecords ?? [],
    [records]
  );

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  useEffect(() => {
    let ignore = false;

    async function loadChallengeContext() {
      if (!electionId) {
        setDetail(null);
        setRecords(null);
        return;
      }

      try {
        const [electionData, recordData] = await Promise.all([
          apiRequest<GetElectionResponse>(`/elections/${electionId}`),
          apiRequest<GetChallengeRecordsResponse>(
            `/challenge/elections/${electionId}/records`
          )
        ]);

        if (!ignore) {
          setDetail(electionData.election);
          setRecords(recordData);
        }
      } catch (error) {
        if (!ignore) {
          setNotice({ type: "error", text: getErrorMessage(error) });
          setDetail(null);
          setRecords(null);
        }
      }
    }

    void loadChallengeContext();

    return () => {
      ignore = true;
    };
  }, [electionId]);

  useEffect(() => {
    if (!candidates.some((candidate) => candidate.id === candidateId)) {
      setCandidateId(candidates[0]?.id ?? "");
    }
  }, [candidateId, candidates]);

  async function refreshChallengeRecords(selectedElectionId = electionId) {
    if (!selectedElectionId) {
      setRecords(null);
      return;
    }

    const data = await apiRequest<GetChallengeRecordsResponse>(
      `/challenge/elections/${selectedElectionId}/records`
    );
    setRecords(data);
  }

  function resetActionState() {
    setPendingBallot(null);
    setCastResult(null);
    setChallengeResult(null);
    setNotice(null);
  }

  async function handlePrepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setCastResult(null);
    setChallengeResult(null);

    if (!electionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      setLoadingAction("prepare");
      const body: PrepareBallotRequest = { userId, candidateId };
      const data = await apiRequest<PrepareBallotResponse>(
        `/challenge/elections/${electionId}/prepare`,
        {
          method: "POST",
          body
        }
      );

      setPendingBallot(data.pendingBallot);
      await refreshChallengeRecords(electionId);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleCast() {
    if (!pendingBallot) {
      setNotice({ type: "error", text: "请先准备待确认选票" });
      return;
    }

    try {
      setLoadingAction("cast");
      const data = await apiRequest<CastPreparedBallotResponse>(
        `/challenge/ballots/${encodeURIComponent(pendingBallot.id)}/cast`,
        {
          method: "POST"
        }
      );

      setCastResult(data);
      setChallengeResult(null);
      setPendingBallot({ ...pendingBallot, status: "cast" });
      await refreshChallengeRecords(pendingBallot.electionId);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleChallenge() {
    if (!pendingBallot) {
      setNotice({ type: "error", text: "请先准备待确认选票" });
      return;
    }

    try {
      setLoadingAction("challenge");
      const data = await apiRequest<ChallengePreparedBallotResponse>(
        `/challenge/ballots/${encodeURIComponent(pendingBallot.id)}/challenge`,
        {
          method: "POST"
        }
      );

      setChallengeResult(data);
      setCastResult(null);
      setPendingBallot({ ...pendingBallot, status: "challenged" });
      await refreshChallengeRecords(pendingBallot.electionId);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Cast or Challenge</p>
          <h1>挑战审计</h1>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => void refreshChallengeRecords()}
          disabled={!electionId || loadingAction !== null}
        >
          刷新记录
        </button>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel attack-warning">
        <strong>挑战审计用于验证系统是否按用户选择正确生成 commitment。</strong>
        <p>
          被 challenge 的选票会公开 opening，因此不计入正式投票；只有 Cast 的 prepared ballot
          会进入正式 votes、结果、公告板和聚合器。
        </p>
      </div>

      <form className="panel form" onSubmit={handlePrepare}>
        <div className="two-column">
          <label>
            投票
            <ElectionSelect
              elections={elections}
              value={electionId}
              onChange={(value) => {
                setElectionId(value);
                resetActionState();
              }}
            />
          </label>
          <label>
            userId
            <input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="例如：user_1"
            />
          </label>
        </div>

        <label>
          候选人
          <select
            value={candidateId}
            onChange={(event) => setCandidateId(event.target.value)}
          >
            <option value="">请选择候选人</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={
            !electionId ||
            !candidateId ||
            !userId.trim() ||
            loadingAction !== null
          }
        >
          {loadingAction === "prepare" ? "准备中..." : "准备待确认选票"}
        </button>
      </form>

      {pendingBallot ? (
        <div className="panel receipt-panel">
          <div className="verification-heading">
            <h2>pending ballot</h2>
            <span
              className={
                pendingBallot.status === "pending"
                  ? "status-pill ok"
                  : "status-pill bad"
              }
            >
              {pendingBallot.status}
            </span>
          </div>

          <div className="hash-list">
            <div>
              <span>pendingBallotId</span>
              <code className="hash-value">{pendingBallot.id}</code>
            </div>
            <div>
              <span>voteVector</span>
              <code className="hash-value">
                [{pendingBallot.voteVector.join(", ")}]
              </code>
            </div>
            <div>
              <span>randomness</span>
              <code className="hash-value">{pendingBallot.randomness}</code>
            </div>
            <div>
              <span>commitment</span>
              <code className="hash-value">{pendingBallot.commitment}</code>
            </div>
            <div>
              <span>receiptCode</span>
              <code className="hash-value">{pendingBallot.receiptCode}</code>
            </div>
            <div>
              <span>status</span>
              <code className="hash-value">{pendingBallot.status}</code>
            </div>
          </div>

          <div className="button-row">
            <button
              type="button"
              onClick={() => void handleCast()}
              disabled={
                pendingBallot.status !== "pending" || loadingAction !== null
              }
            >
              {loadingAction === "cast" ? "Cast 中..." : "Cast：正式投出"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void handleChallenge()}
              disabled={
                pendingBallot.status !== "pending" || loadingAction !== null
              }
            >
              {loadingAction === "challenge"
                ? "Challenge 中..."
                : "Challenge：公开开封审计"}
            </button>
          </div>
        </div>
      ) : null}

      {castResult ? (
        <div className="panel receipt-panel">
          <h2>该 prepared ballot 已正式计入投票</h2>
          <div className="hash-list">
            <div>
              <span>voteId</span>
              <code className="hash-value">{castResult.voteId}</code>
            </div>
            <div>
              <span>receiptCode</span>
              <code className="hash-value">{castResult.receiptCode}</code>
            </div>
            <div>
              <span>commitment</span>
              <code className="hash-value">{castResult.commitment}</code>
            </div>
            <div>
              <span>receiptChainIndex</span>
              <code className="hash-value">{castResult.receiptChainIndex}</code>
            </div>
            <div>
              <span>previousReceiptCodeHash</span>
              <code className="hash-value">
                {castResult.previousReceiptCodeHash ?? "null"}
              </code>
            </div>
            <div>
              <span>receiptChainHash</span>
              <code className="hash-value">{castResult.receiptChainHash}</code>
            </div>
          </div>
          <p className="receipt-note">
            可在回执查询、公告板、聚合器中继续验证这张正式选票。
          </p>
        </div>
      ) : null}

      {challengeResult ? (
        <div className="panel receipt-panel">
          <div className="verification-heading">
            <h2>challenge opening</h2>
            <span
              className={
                challengeResult.openingVerified
                  ? "status-pill ok"
                  : "status-pill bad"
              }
            >
              openingVerified = {challengeResult.openingVerified ? "true" : "false"}
            </span>
          </div>
          <div className="hash-list">
            <div>
              <span>voteVector</span>
              <code className="hash-value">
                [{challengeResult.record.voteVector.join(", ")}]
              </code>
            </div>
            <div>
              <span>randomness</span>
              <code className="hash-value">
                {challengeResult.record.randomness}
              </code>
            </div>
            <div>
              <span>commitment</span>
              <code className="hash-value">
                {challengeResult.record.commitment}
              </code>
            </div>
          </div>
          <p className="receipt-note">
            challenge 票只用于审计，不计入 tally。
          </p>
        </div>
      ) : null}

      <div className="panel">
        <div className="result-heading">
          <div>
            <h2>challenge records</h2>
            <p>该 election 下所有 prepared ballot 状态和公开 opening 记录。</p>
          </div>
          <strong>{challengeRecords.length}</strong>
        </div>

        {challengeBallots.length === 0 ? (
          <p className="empty">暂无 prepared ballot</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>pendingBallotId</th>
                <th>userId</th>
                <th>candidateId</th>
                <th>status</th>
                <th>receiptCode</th>
              </tr>
            </thead>
            <tbody>
              {challengeBallots.map((ballot) => (
                <tr key={ballot.id}>
                  <td>
                    <code>{ballot.id}</code>
                  </td>
                  <td>{ballot.userId}</td>
                  <td>{ballot.candidateId}</td>
                  <td>{ballot.status}</td>
                  <td>
                    <code className="hash-value">{ballot.receiptCode}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>公开 opening 审计记录</h2>
        {challengeRecords.length === 0 ? (
          <p className="empty">暂无 challenge record</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>recordId</th>
                <th>pendingBallotId</th>
                <th>openingVerified</th>
                <th>createdAt</th>
                <th>commitment</th>
              </tr>
            </thead>
            <tbody>
              {challengeRecords.map((record) => (
                <tr key={record.id}>
                  <td>
                    <code>{record.id}</code>
                  </td>
                  <td>
                    <code>{record.pendingBallotId}</code>
                  </td>
                  <td>{record.openingVerified ? "true" : "false"}</td>
                  <td>{formatTime(record.createdAt)}</td>
                  <td>
                    <code className="hash-value">{record.commitment}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function ReceiptQueryPage() {
  const [receiptCode, setReceiptCode] = useState("");
  const [result, setResult] = useState<GetReceiptResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setResult(null);

    const trimmedReceiptCode = receiptCode.trim();

    if (!trimmedReceiptCode) {
      setNotice({ type: "error", text: "请输入回执码" });
      return;
    }

    try {
      const data = await apiRequest<GetReceiptResponse>(
        `/receipts/${encodeURIComponent(trimmedReceiptCode)}`
      );
      setResult(data);
      setNotice({
        type: data.exists ? "success" : "error",
        text: data.exists ? "已找到该选票记录" : "未找到该回执码对应的选票"
      });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Receipt</p>
          <h1>回执查询</h1>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <form className="panel form narrow" onSubmit={handleQuery}>
        <label>
          receiptCode
          <input
            value={receiptCode}
            onChange={(event) => setReceiptCode(event.target.value)}
            placeholder="输入投票成功后获得的回执码"
          />
        </label>
        <button type="submit">查询</button>
      </form>

      {result?.exists ? (
        <div className="panel receipt-panel">
          <h2>回执存在</h2>
          <div className="hash-list">
            <div>
              <span>voteId</span>
              <code className="hash-value">{result.voteId}</code>
            </div>
            <div>
              <span>electionId</span>
              <code className="hash-value">{result.electionId}</code>
            </div>
            <div>
              <span>commitment</span>
              <code className="hash-value">{result.commitment}</code>
            </div>
            <div>
              <span>receiptChainIndex</span>
              <code className="hash-value">{result.receiptChainIndex}</code>
            </div>
            <div>
              <span>previousReceiptCodeHash</span>
              <code className="hash-value">
                {result.previousReceiptCodeHash ?? "null"}
              </code>
            </div>
            <div>
              <span>receiptChainHash</span>
              <code className="hash-value">{result.receiptChainHash}</code>
            </div>
            <div>
              <span>createdAt</span>
              <code className="hash-value">{formatTime(result.createdAt)}</code>
            </div>
            <div>
              <span>counted</span>
              <code className="hash-value">{result.counted ? "true" : "false"}</code>
            </div>
          </div>
          <p className="receipt-note">{receiptChainExplanation}</p>
        </div>
      ) : null}

      {result && !result.exists ? (
        <div className="panel">
          <p className="empty">未查询到该回执码对应的选票。</p>
        </div>
      ) : null}
    </section>
  );
}

function ResultPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [result, setResult] = useState<GetElectionResultResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  useEffect(() => {
    let ignore = false;

    async function loadResult() {
      if (!electionId) {
        setResult(null);
        return;
      }

      try {
        const data = await apiRequest<GetElectionResultResponse>(
          `/elections/${electionId}/result`
        );

        if (!ignore) {
          setResult(data);
          setNotice(null);
        }
      } catch (error) {
        if (!ignore) {
          setNotice({ type: "error", text: getErrorMessage(error) });
          setResult(null);
        }
      }
    }

    void loadResult();

    return () => {
      ignore = true;
    };
  }, [electionId]);

  async function handleRefresh() {
    if (!electionId) {
      return;
    }

    try {
      const data = await apiRequest<GetElectionResultResponse>(
        `/elections/${electionId}/result`
      );
      setResult(data);
      setNotice({ type: "success", text: "结果已刷新" });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Result</p>
          <h1>查看结果</h1>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => void handleRefresh()}
          disabled={!electionId}
        >
          刷新结果
        </button>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel form">
        <label>
          投票
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={setElectionId}
          />
        </label>
      </div>

      {result ? (
        <div className="panel">
          <div className="result-heading">
            <div>
              <h2>{result.election.title}</h2>
              <p>{result.election.description || "无描述"}</p>
            </div>
            <strong>{result.result.totalVotes} 票</strong>
          </div>
          <table>
            <thead>
              <tr>
                <th>候选人</th>
                <th>candidateId</th>
                <th>票数</th>
              </tr>
            </thead>
            <tbody>
              {result.result.results.map((item) => (
                <tr key={item.candidateId}>
                  <td>{item.candidateName}</td>
                  <td>
                    <code>{item.candidateId}</code>
                  </td>
                  <td>{item.voteCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function HashSequence({
  title,
  values,
  emptyText
}: {
  title: string;
  values: string[];
  emptyText: string;
}) {
  return (
    <div className="hash-section">
      <h2>{title}</h2>
      {values.length === 0 ? (
        <p className="empty">{emptyText}</p>
      ) : (
        <ol className="hash-sequence">
          {values.map((value, index) => (
            <li key={`${value}-${index}`}>
              <span>#{index + 1}</span>
              <code className="hash-value">{value}</code>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ReceiptChainBreakList({
  breaks
}: {
  breaks: ReceiptChainBreak[];
}) {
  if (breaks.length === 0) {
    return <p className="empty">暂无 receipt chain breaks</p>;
  }

  return (
    <ol className="proof-list">
      {breaks.map((item, index) => (
        <li key={`${item.voteId ?? "vote"}-${item.index}-${index}`}>
          <span>
            index {item.index}
            {item.voteId ? ` / ${item.voteId}` : ""}
          </span>
          <code className="hash-value">{item.reason}</code>
        </li>
      ))}
    </ol>
  );
}

function ReceiptChainTable({
  records
}: {
  records: ReceiptChainRecord[];
}) {
  if (records.length === 0) {
    return <p className="empty">暂无 receipt chain 记录</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>index</th>
            <th>voteId</th>
            <th>receiptCodeHash</th>
            <th>previousReceiptCodeHash</th>
            <th>receiptChainHash</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={`${record.voteId}-${record.receiptChainIndex}`}>
              <td>{record.receiptChainIndex}</td>
              <td>
                <code>{record.voteId}</code>
              </td>
              <td>
                <code className="hash-value">{record.receiptCodeHash}</code>
              </td>
              <td>
                <code className="hash-value">
                  {record.previousReceiptCodeHash ?? "null"}
                </code>
              </td>
              <td>
                <code className="hash-value">{record.receiptChainHash}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulletinTallyTable({ bulletin }: { bulletin: BulletinBoard }) {
  return (
    <table>
      <thead>
        <tr>
          <th>候选人</th>
          <th>candidateId</th>
          <th>票数</th>
        </tr>
      </thead>
      <tbody>
        {bulletin.tallyResult.results.map((item) => (
          <tr key={item.candidateId}>
            <td>{item.candidateName}</td>
            <td>
              <code>{item.candidateId}</code>
            </td>
            <td>{item.voteCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TallyResultTable({
  result
}: {
  result: AggregatorReport["tallyResult"];
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>候选人</th>
          <th>candidateId</th>
          <th>有效票数</th>
        </tr>
      </thead>
      <tbody>
        {result.results.map((item) => (
          <tr key={item.candidateId}>
            <td>{item.candidateName}</td>
            <td>
              <code>{item.candidateId}</code>
            </td>
            <td>{item.voteCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AggregatorPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [report, setReport] = useState<AggregatorReport | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  async function handleRun() {
    setNotice(null);

    if (!electionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      const data = await apiRequest<RunAggregatorResponse>(
        `/aggregator/elections/${electionId}/run`,
        {
          method: "POST"
        }
      );

      setReport(data.report);
      setNotice({ type: "success", text: "聚合器已运行" });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Aggregator</p>
          <h1>聚合器</h1>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => void handleRun()}
          disabled={!electionId}
        >
          运行聚合器
        </button>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel form">
        <label>
          投票
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={(value) => {
              setElectionId(value);
              setReport(null);
            }}
          />
        </label>
      </div>

      {report ? (
        <>
          <div className="stats">
            <div>
              <span>{report.totalVotes}</span>
              <p>totalVotes</p>
            </div>
            <div>
              <span>{report.validVotes}</span>
              <p>validVotes</p>
            </div>
            <div>
              <span>{report.invalidVotes}</span>
              <p>invalidVotes</p>
            </div>
            <div>
              <span>{report.duplicateVotes}</span>
              <p>duplicateVotes</p>
            </div>
            <div>
              <span>{report.receiptChainVerified ? "true" : "false"}</span>
              <p>receiptChainVerified</p>
            </div>
          </div>

          <div className="panel receipt-panel">
            <div className="hash-list">
              <div>
                <span>auditHash</span>
                <code className="hash-value">{report.auditHash}</code>
              </div>
              <div>
                <span>createdAt</span>
                <code className="hash-value">{formatTime(report.createdAt)}</code>
              </div>
            </div>
            <p className="receipt-note">{receiptChainExplanation}</p>
          </div>

          <div className="panel">
            <div className="verification-heading">
              <h2>receiptChainVerified</h2>
              <span
                className={
                  report.receiptChainVerified
                    ? "status-pill ok"
                    : "status-pill bad"
                }
              >
                {report.receiptChainVerified ? "true" : "false"}
              </span>
            </div>
            <ReceiptChainBreakList breaks={report.receiptChainBreaks} />
          </div>

          <div className="two-column">
            <div className="panel">
              <HashSequence
                title="voteTokenHashes"
                values={report.voteTokenHashes}
                emptyText="暂无 voteTokenHash"
              />
            </div>
            <div className="panel">
              <HashSequence
                title="duplicateTokenHashes"
                values={report.duplicateTokenHashes}
                emptyText="暂无重复 token"
              />
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

const attackActions = [
  {
    label: "演示攻击：篡改 commitment",
    path: "tamper-commitment",
    tip: "验证：重新运行聚合器或查看审计报告，receipt chain 应能发现 chain hash 不匹配。"
  },
  {
    label: "演示攻击：删除选票",
    path: "delete-vote",
    tip: "验证：重新运行聚合器或查看审计报告，删除或重排正式票会导致 receipt chain 验证失败。"
  },
  {
    label: "演示攻击：注入重复投票",
    path: "inject-duplicate-vote",
    tip: "验证：重新运行聚合器，然后查看 duplicateVotes。"
  },
  {
    label: "演示攻击：注入非法投票",
    path: "inject-invalid-vote",
    tip: "验证：重新运行聚合器，然后查看 invalidVotes。"
  },
  {
    label: "演示攻击：篡改 tallyResult",
    path: "tamper-tally",
    tip: "验证：去审计报告页面查看 tallyConsistent 是否为 false。"
  }
] as const;

function AttackLogCard({ log }: { log: AttackLog }) {
  return (
    <article className="attack-log">
      <div className="result-heading">
        <div>
          <h2>{log.type}</h2>
          <p>{log.description}</p>
        </div>
        <code>{formatTime(log.createdAt)}</code>
      </div>
      <div className="log-grid">
        <div>
          <span>before</span>
          <pre>{formatJson(log.before)}</pre>
        </div>
        <div>
          <span>after</span>
          <pre>{formatJson(log.after)}</pre>
        </div>
      </div>
    </article>
  );
}

function AttackLabPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [logs, setLogs] = useState<AttackLog[]>([]);
  const [latestLog, setLatestLog] = useState<AttackLog | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [runningPath, setRunningPath] = useState<string | null>(null);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  useEffect(() => {
    let ignore = false;

    async function loadLogs() {
      if (!electionId) {
        setLogs([]);
        return;
      }

      try {
        const data = await apiRequest<GetAttackLogsResponse>(
          `/attack/elections/${electionId}/logs`
        );

        if (!ignore) {
          setLogs(data.logs);
          setNotice(null);
        }
      } catch (error) {
        if (!ignore) {
          setLogs([]);
          setNotice({ type: "error", text: getErrorMessage(error) });
        }
      }
    }

    void loadLogs();

    return () => {
      ignore = true;
    };
  }, [electionId]);

  async function handleAttack(path: string) {
    setNotice(null);
    setLatestLog(null);

    if (!electionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      setRunningPath(path);
      const data = await apiRequest<AttackResponse>(
        `/attack/elections/${electionId}/${path}`,
        {
          method: "POST"
        }
      );

      setLatestLog(data.log);
      setLogs((currentLogs) => [
        ...currentLogs.filter((log) => log.id !== data.log.id),
        data.log
      ]);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setRunningPath(null);
    }
  }

  const orderedLogs = [...logs].reverse();

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Attack Lab</p>
          <h1>攻击演示</h1>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel attack-warning">
        <strong>Demo only</strong>
        <p>
          本页所有按钮都是“演示攻击”，会直接修改当前 API 进程中的内存数据。
          删除或重排正式票会导致 receipt chain 验证失败。
        </p>
      </div>

      <div className="panel form">
        <label>
          投票
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={(value) => {
              setElectionId(value);
              setLatestLog(null);
            }}
          />
        </label>
      </div>

      <div className="attack-grid">
        {attackActions.map((action) => (
          <article key={action.path} className="panel attack-card">
            <button
              type="button"
              onClick={() => void handleAttack(action.path)}
              disabled={!electionId || runningPath !== null}
            >
              {runningPath === action.path ? "执行中..." : action.label}
            </button>
            <p>{action.tip}</p>
          </article>
        ))}
      </div>

      {latestLog ? (
        <div className="panel">
          <h2>最新攻击结果</h2>
          <AttackLogCard log={latestLog} />
        </div>
      ) : null}

      <div className="panel">
        <h2>AttackLog 列表</h2>
        {orderedLogs.length === 0 ? (
          <p className="empty">暂无攻击日志</p>
        ) : (
          <div className="attack-log-list">
            {orderedLogs.map((log) => (
              <AttackLogCard key={log.id} log={log} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AuditReportPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [report, setReport] = useState<AggregatorReport | null>(null);
  const [consistency, setConsistency] = useState<{
    tallyConsistent: boolean;
    consistencyMessage: string;
  } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  async function handleQuery() {
    setNotice(null);

    if (!electionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      const data = await apiRequest<GetAggregatorReportResponse>(
        `/aggregator/elections/${electionId}/report`
      );

      setReport(data.report);
      setConsistency({
        tallyConsistent: data.tallyConsistent,
        consistencyMessage: data.consistencyMessage
      });
      setNotice({ type: "success", text: "审计报告已加载" });
    } catch (error) {
      setReport(null);
      setConsistency(null);
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Audit</p>
          <h1>审计报告</h1>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => void handleQuery()}
          disabled={!electionId}
        >
          查询报告
        </button>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel form">
        <label>
          投票
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={(value) => {
              setElectionId(value);
              setReport(null);
              setConsistency(null);
            }}
          />
        </label>
      </div>

      {report ? (
        <>
          {consistency ? (
            <div className="panel receipt-panel">
              <div className="verification-heading">
                <h2>tallyConsistent</h2>
                <span
                  className={
                    consistency.tallyConsistent
                      ? "status-pill ok"
                      : "status-pill bad"
                  }
                >
                  {consistency.tallyConsistent ? "true" : "false"}
                </span>
              </div>
              <p className="empty">{consistency.consistencyMessage}</p>
            </div>
          ) : null}

          <div className="panel receipt-panel">
            <div className="verification-heading">
              <h2>receiptChainVerified</h2>
              <span
                className={
                  report.receiptChainVerified
                    ? "status-pill ok"
                    : "status-pill bad"
                }
              >
                {report.receiptChainVerified ? "true" : "false"}
              </span>
            </div>
            <p className="receipt-note">{receiptChainExplanation}</p>
            <ReceiptChainBreakList breaks={report.receiptChainBreaks} />
          </div>

          <div className="panel receipt-panel">
            <div className="hash-list">
              <div>
                <span>electionId</span>
                <code className="hash-value">{report.electionId}</code>
              </div>
              <div>
                <span>totalVotes</span>
                <code className="hash-value">{report.totalVotes}</code>
              </div>
              <div>
                <span>validVotes</span>
                <code className="hash-value">{report.validVotes}</code>
              </div>
              <div>
                <span>invalidVotes</span>
                <code className="hash-value">{report.invalidVotes}</code>
              </div>
              <div>
                <span>duplicateVotes</span>
                <code className="hash-value">{report.duplicateVotes}</code>
              </div>
              <div>
                <span>receiptChainVerified</span>
                <code className="hash-value">
                  {report.receiptChainVerified ? "true" : "false"}
                </code>
              </div>
              <div>
                <span>commitmentRoot</span>
                <code className="hash-value">{report.commitmentRoot}</code>
              </div>
              <div>
                <span>receiptRoot</span>
                <code className="hash-value">{report.receiptRoot}</code>
              </div>
              <div>
                <span>auditHash</span>
                <code className="hash-value">{report.auditHash}</code>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>tallyResult</h2>
            <TallyResultTable result={report.tallyResult} />
          </div>
        </>
      ) : null}
    </section>
  );
}

function getAuditModeLabel(auditMode: BlockchainAuditRecord["auditMode"]): string {
  return auditMode === "hardhat" ? "Hardhat Audit" : "Local Mock Chain Audit";
}

function ChainAuditDetails({ audit }: { audit: BlockchainAuditRecord }) {
  const submitter = audit.submitter ?? audit.mockSubmitter ?? "未记录";
  const transactionHash = audit.transactionHash || "查询模式未返回交易哈希";
  const rows = [
    ["electionId", audit.electionId],
    ["electionIdHash", audit.electionIdHash],
    ["merkleRoot", audit.merkleRoot],
    ["commitmentRoot", audit.commitmentRoot],
    ["receiptRoot", audit.receiptRoot],
    ["auditHash", audit.auditHash],
    ["tallyHash", audit.tallyHash],
    ["transactionHash", transactionHash],
    ["contractAddress", audit.contractAddress],
    ["auditMode", getAuditModeLabel(audit.auditMode)],
    ["createdAt", formatTime(audit.createdAt)],
    ["submitter / mockSubmitter", submitter],
    ["status", audit.status]
  ];

  return (
    <div className="panel receipt-panel">
      <div className="verification-heading">
        <h2>链上审计结果</h2>
        <span className={audit.status === "submitted" ? "status-pill ok" : "status-pill bad"}>
          {audit.status}
        </span>
      </div>

      <div className="hash-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <code className="hash-value">{value}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChainAuditPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [audit, setAudit] = useState<BlockchainAuditRecord | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingAction, setLoadingAction] = useState<"submit" | "query" | null>(
    null
  );

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  async function handleSubmit() {
    setNotice(null);

    if (!electionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      setLoadingAction("submit");
      const data = await apiRequest<SubmitBlockchainAuditResponse>(
        `/blockchain/elections/${electionId}/submit-audit`,
        {
          method: "POST"
        }
      );

      setAudit(data.audit);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setAudit(null);
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleQuery() {
    setNotice(null);

    if (!electionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      setLoadingAction("query");
      const data = await apiRequest<GetBlockchainAuditResponse>(
        `/blockchain/elections/${electionId}/audit`
      );

      setAudit(data.audit);
      setNotice({
        type: data.hasAudit ? "success" : "error",
        text: data.hasAudit
          ? `${getAuditModeLabel(data.auditMode)} 已找到审计摘要`
          : `${getAuditModeLabel(data.auditMode)} 尚未提交审计摘要`
      });
    } catch (error) {
      setAudit(null);
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Blockchain Audit</p>
          <h1>链上审计</h1>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel attack-warning">
        <strong>摘要上链</strong>
        <p>本阶段仅提交审计摘要，不上链明文选票。同一 electionId 已提交后会拒绝重复提交。</p>
      </div>

      <div className="panel form">
        <label>
          投票
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={(value) => {
              setElectionId(value);
              setAudit(null);
            }}
          />
        </label>
        <div className="button-row">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!electionId || loadingAction !== null}
          >
            {loadingAction === "submit" ? "提交中..." : "提交链上审计"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleQuery()}
            disabled={!electionId || loadingAction !== null}
          >
            {loadingAction === "query" ? "查询中..." : "查询链上审计"}
          </button>
        </div>
      </div>

      {audit ? (
        <ChainAuditDetails audit={audit} />
      ) : (
        <div className="panel">
          <p className="empty">尚未加载链上审计记录。</p>
        </div>
      )}
    </section>
  );
}

function BulletinBoardPage({
  elections,
  onRefreshElections
}: {
  elections: Election[];
  onRefreshElections: () => Promise<void>;
}) {
  const [electionId, setElectionId] = useState("");
  const [bulletin, setBulletin] = useState<BulletinBoard | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  useEffect(() => {
    let ignore = false;

    async function loadBulletin() {
      if (!electionId) {
        setBulletin(null);
        return;
      }

      try {
        const data = await apiRequest<GetBulletinBoardResponse>(
          `/elections/${electionId}/bulletin`
        );

        if (!ignore) {
          setBulletin(data.bulletin);
          setNotice(null);
        }
      } catch {
        if (!ignore) {
          setBulletin(null);
          setNotice(null);
        }
      }
    }

    void loadBulletin();

    return () => {
      ignore = true;
    };
  }, [electionId]);

  async function handleFinalize() {
    setNotice(null);

    if (!electionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      const data = await apiRequest<FinalizeElectionResponse>(
        `/elections/${electionId}/finalize`,
        {
          method: "POST"
        }
      );
      setBulletin(data.bulletin);
      await onRefreshElections();
      setNotice({ type: "success", text: "公告板已生成" });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Bulletin Board</p>
          <h1>公告板</h1>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => void handleFinalize()}
          disabled={!electionId}
        >
          生成公告板
        </button>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel form">
        <label>
          投票
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={setElectionId}
          />
        </label>
      </div>

      {bulletin ? (
        <>
          <div className="panel receipt-panel">
            <div className="result-heading">
              <div>
                <h2>公开公告板</h2>
                <p>创建时间：{formatTime(bulletin.createdAt)}</p>
              </div>
              <strong>{bulletin.totalVotes} 票</strong>
            </div>
            <div className="hash-list">
              <div>
                <span>electionId</span>
                <code className="hash-value">{bulletin.electionId}</code>
              </div>
              <div>
                <span>totalVotes</span>
                <code className="hash-value">{bulletin.totalVotes}</code>
              </div>
              <div>
                <span>merkleRoot</span>
                <code className="hash-value">{bulletin.merkleRoot}</code>
              </div>
              <div>
                <span>receiptChainVerified</span>
                <code className="hash-value">
                  {bulletin.receiptChainVerified ? "true" : "false"}
                </code>
              </div>
            </div>
          </div>

          <div className="panel receipt-panel">
            <div className="verification-heading">
              <h2>receiptChainVerified</h2>
              <span
                className={
                  bulletin.receiptChainVerified
                    ? "status-pill ok"
                    : "status-pill bad"
                }
              >
                {bulletin.receiptChainVerified ? "true" : "false"}
              </span>
            </div>
            <p className="receipt-note">{receiptChainExplanation}</p>
            <ReceiptChainBreakList breaks={bulletin.receiptChainBreaks} />
          </div>

          <div className="two-column">
            <div className="panel">
              <HashSequence
                title="commitments"
                values={bulletin.commitments}
                emptyText="暂无 commitment"
              />
            </div>
            <div className="panel">
              <HashSequence
                title="receiptCodeHashes"
                values={bulletin.receiptCodeHashes}
                emptyText="暂无 receiptCode hash"
              />
            </div>
          </div>

          <div className="panel">
            <h2>receipt chain</h2>
            <ReceiptChainTable records={bulletin.receiptChain} />
          </div>

          <div className="panel">
            <HashSequence
              title="Merkle leaves"
              values={bulletin.leaves}
              emptyText="暂无 Merkle leaf"
            />
          </div>

          <div className="panel">
            <h2>tallyResult</h2>
            <BulletinTallyTable bulletin={bulletin} />
          </div>
        </>
      ) : (
        <div className="panel">
          <p className="empty">该投票尚未生成公告板。</p>
        </div>
      )}
    </section>
  );
}

function MerkleVerificationPage() {
  const [receiptCode, setReceiptCode] = useState("");
  const [result, setResult] = useState<GetReceiptProofResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setResult(null);

    const trimmedReceiptCode = receiptCode.trim();

    if (!trimmedReceiptCode) {
      setNotice({ type: "error", text: "请输入回执码" });
      return;
    }

    try {
      const data = await apiRequest<GetReceiptProofResponse>(
        `/receipts/${encodeURIComponent(trimmedReceiptCode)}/proof`
      );
      setResult(data);
      setNotice({
        type: data.verifyResult ? "success" : "error",
        text: data.verifyResult ? "Merkle proof 验证通过" : "Merkle proof 验证失败"
      });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Merkle Proof</p>
          <h1>Merkle 验证</h1>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <form className="panel form narrow" onSubmit={handleVerify}>
        <label>
          receiptCode
          <input
            value={receiptCode}
            onChange={(event) => setReceiptCode(event.target.value)}
            placeholder="输入投票回执码"
          />
        </label>
        <button type="submit">验证</button>
      </form>

      {result ? (
        <div className="panel receipt-panel">
          <div className="verification-heading">
            <h2>verifyResult</h2>
            <span className={result.verifyResult ? "status-pill ok" : "status-pill bad"}>
              {result.verifyResult ? "true" : "false"}
            </span>
          </div>

          {result.verifyResult ? (
            <p className="receipt-note">该选票已包含在公告板中</p>
          ) : null}

          <div className="hash-list">
            <div>
              <span>voteId</span>
              <code className="hash-value">{result.voteId}</code>
            </div>
            <div>
              <span>electionId</span>
              <code className="hash-value">{result.electionId}</code>
            </div>
            <div>
              <span>leaf</span>
              <code className="hash-value">{result.leaf}</code>
            </div>
            <div>
              <span>merkleRoot</span>
              <code className="hash-value">{result.merkleRoot}</code>
            </div>
          </div>

          <div className="proof-block">
            <h2>proof</h2>
            {result.proof.length === 0 ? (
              <p className="empty">proof 为空</p>
            ) : (
              <ol className="proof-list">
                {result.proof.map((item, index) => (
                  <li key={`${item.sibling}-${index}`}>
                    <span>{index + 1}. {item.position}</span>
                    <code className="hash-value">{item.sibling}</code>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

const zkVotePresets: Array<{ label: string; voteVector: number[] }> = [
  { label: "合法票 A：[1,0,0,0]", voteVector: [1, 0, 0, 0] },
  { label: "合法票 B：[0,1,0,0]", voteVector: [0, 1, 0, 0] },
  { label: "非法多选：[1,1,0,0]", voteVector: [1, 1, 0, 0] },
  { label: "非法空票：[0,0,0,0]", voteVector: [0, 0, 0, 0] },
  { label: "非法数值：[2,0,0,0]", voteVector: [2, 0, 0, 0] }
];

function parseVoteVectorInput(value: string): number[] {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("请输入 voteVector");
  }

  const parsed = trimmed.startsWith("[")
    ? (JSON.parse(trimmed) as unknown)
    : trimmed.split(",").map((item) => Number(item.trim()));

  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    throw new Error("voteVector 必须是 number[]，例如 [1,0,0,0]");
  }

  return parsed;
}

function getZkProofModeLabel(proofMode: ZkValidityProofResponse["proofMode"]): string {
  return proofMode === "real"
    ? "Real Groth16 ZK Proof"
    : "Mock ZK Validity Proof";
}

function ZkValidationPage() {
  const [electionId, setElectionId] = useState("election_1");
  const [candidateCount, setCandidateCount] = useState("4");
  const [voteVectorText, setVoteVectorText] = useState("[1,0,0,0]");
  const [proofMode, setProofMode] = useState<ZkProofMode>("mock");
  const [proofResult, setProofResult] =
    useState<ZkValidityProofResponse | null>(null);
  const [verifyResult, setVerifyResult] =
    useState<ZkValidityVerifyResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingAction, setLoadingAction] = useState<"prove" | "verify" | null>(
    null
  );

  const voteVectorPreview = useMemo(() => {
    try {
      return parseVoteVectorInput(voteVectorText);
    } catch {
      return null;
    }
  }, [voteVectorText]);

  function applyPreset(voteVector: number[]) {
    setCandidateCount(String(voteVector.length));
    setVoteVectorText(`[${voteVector.join(",")}]`);
    setProofResult(null);
    setVerifyResult(null);
    setNotice(null);
  }

  async function handleProve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setProofResult(null);
    setVerifyResult(null);

    const trimmedElectionId = electionId.trim();
    const parsedCandidateCount = Number(candidateCount);

    if (!trimmedElectionId) {
      setNotice({ type: "error", text: "请输入 electionId" });
      return;
    }

    if (!Number.isInteger(parsedCandidateCount) || parsedCandidateCount <= 0) {
      setNotice({ type: "error", text: "candidateCount 必须是正整数" });
      return;
    }

    try {
      setLoadingAction("prove");
      const body: ZkProofModeRequest = {
        electionId: trimmedElectionId,
        voteVector: parseVoteVectorInput(voteVectorText),
        candidateCount: parsedCandidateCount,
        proofMode
      };
      const data = await apiRequest<ZkValidityProofResponse>(
        "/zk/prove-vote-validity",
        {
          method: "POST",
          body
        }
      );

      setProofResult(data);
      setNotice({
        type: data.valid ? "success" : "error",
        text: data.message
      });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleVerify() {
    setNotice(null);
    setVerifyResult(null);

    if (!proofResult) {
      setNotice({ type: "error", text: "请先生成 ZK 合法性证明" });
      return;
    }

    try {
      setLoadingAction("verify");
      const body: ZkValidityVerifyRequest = {
        proof: proofResult.proof,
        publicSignals: proofResult.publicSignals,
        proofMode: proofResult.proofMode
      };
      const data = await apiRequest<ZkValidityVerifyResponse>(
        "/zk/verify-vote-validity",
        {
          method: "POST",
          body
        }
      );

      setVerifyResult(data);
      setNotice({
        type: data.verified ? "success" : "error",
        text: data.message
      });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">ZK Validity</p>
          <h1>ZK 验证</h1>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel attack-warning">
        <strong>one-hot 合法性证明 demo</strong>
        <p>
          当前 ZK 模块用于证明 voteVector 是合法 one-hot 向量，即只选择一名候选人。后续可扩展为真实
          Circom/snarkjs proof，并接入完整计票正确性证明。
        </p>
      </div>

      <form className="panel form" onSubmit={handleProve}>
        <label>
          proofMode
          <select
            value={proofMode}
            onChange={(event) => {
              setProofMode(event.target.value as ZkProofMode);
              setProofResult(null);
              setVerifyResult(null);
              setNotice(null);
            }}
          >
            <option value="mock">Mock ZK Validity Proof</option>
            <option value="real">Real Groth16 ZK Proof</option>
          </select>
        </label>

        <div className="two-column">
          <label>
            electionId
            <input
              value={electionId}
              onChange={(event) => setElectionId(event.target.value)}
              placeholder="election_1"
            />
          </label>
          <label>
            candidateCount
            <input
              type="number"
              min="1"
              step="1"
              value={candidateCount}
              onChange={(event) => setCandidateCount(event.target.value)}
            />
          </label>
        </div>

        <label>
          voteVector
          <textarea
            value={voteVectorText}
            onChange={(event) => {
              setVoteVectorText(event.target.value);
              setProofResult(null);
              setVerifyResult(null);
            }}
            rows={3}
            placeholder="[1,0,0,0]"
          />
        </label>

        <div className="button-row">
          {zkVotePresets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="secondary"
              onClick={() => applyPreset(preset.voteVector)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="hash-list">
          <div>
            <span>proofMode</span>
            <code className="hash-value">{getZkProofModeLabel(proofMode)}</code>
          </div>
          <div>
            <span>当前 voteVector</span>
            <code className="hash-value">
              {voteVectorPreview ? `[${voteVectorPreview.join(", ")}]` : "格式无效"}
            </code>
          </div>
        </div>

        <div className="button-row">
          <button type="submit" disabled={loadingAction !== null}>
            {loadingAction === "prove" ? "生成中..." : "生成 ZK 合法性证明"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleVerify()}
            disabled={!proofResult || loadingAction !== null}
          >
            {loadingAction === "verify" ? "验证中..." : "验证证明"}
          </button>
        </div>
      </form>

      {proofResult ? (
        <div className="panel receipt-panel">
          <div className="verification-heading">
            <h2>proof result</h2>
            <span className={proofResult.valid ? "status-pill ok" : "status-pill bad"}>
              valid = {proofResult.valid ? "true" : "false"}
            </span>
          </div>

          <div className="hash-list">
            <div>
              <span>proofId</span>
              <code className="hash-value">{proofResult.proofId}</code>
            </div>
            <div>
              <span>proofMode</span>
              <code className="hash-value">
                {getZkProofModeLabel(proofResult.proofMode)}
              </code>
            </div>
            <div>
              <span>message</span>
              <code className="hash-value">{proofResult.message}</code>
            </div>
          </div>

          <div className="two-column">
            <div>
              <h2>publicSignals</h2>
              <pre>{formatJson(proofResult.publicSignals)}</pre>
            </div>
            <div>
              <h2>proof</h2>
              <pre>{formatJson(proofResult.proof)}</pre>
            </div>
          </div>
        </div>
      ) : null}

      {verifyResult ? (
        <div className="panel receipt-panel">
          <div className="verification-heading">
            <h2>verify result</h2>
            <span className={verifyResult.verified ? "status-pill ok" : "status-pill bad"}>
              verified = {verifyResult.verified ? "true" : "false"}
            </span>
          </div>
          <div className="hash-list">
            <div>
              <span>proofMode</span>
              <code className="hash-value">
                {getZkProofModeLabel(verifyResult.proofMode)}
              </code>
            </div>
            <div>
              <span>verify message</span>
              <code className="hash-value">{verifyResult.message}</code>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TotalTrendChart({
  values
}: {
  values: Array<{ voteCount: number; totalMs: number }>;
}) {
  const width = 640;
  const height = 260;
  const padding = 44;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const maxTotal = Math.max(...values.map((value) => value.totalMs), 1);
  const points = values.map((value, index) => {
    const x =
      values.length === 1
        ? width / 2
        : padding + (plotWidth * index) / (values.length - 1);
    const y = height - padding - (value.totalMs / maxTotal) * plotHeight;

    return {
      ...value,
      x,
      y
    };
  });
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <svg
      className="benchmark-line-chart"
      role="img"
      aria-label="不同 voteCount 下 totalMs 趋势图"
      viewBox={`0 0 ${width} ${height}`}
    >
      <line
        className="chart-axis"
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
      />
      <line
        className="chart-axis"
        x1={padding}
        y1={padding}
        x2={padding}
        y2={height - padding}
      />
      <polyline className="chart-line" points={linePoints} />
      {points.map((point) => (
        <g key={point.voteCount}>
          <circle className="chart-point" cx={point.x} cy={point.y} r="5" />
          <text className="chart-value" x={point.x} y={point.y - 12}>
            {point.totalMs.toFixed(1)}ms
          </text>
          <text className="chart-label" x={point.x} y={height - 18}>
            {point.voteCount}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ModuleAverageChart({
  values
}: {
  values: Array<{ label: string; averageMs: number }>;
}) {
  const maxAverage = Math.max(...values.map((value) => value.averageMs), 1);

  return (
    <div className="benchmark-bars" aria-label="各模块平均耗时对比图">
      {values.map((value) => (
        <div className="benchmark-bar-row" key={value.label}>
          <span>{value.label}</span>
          <div className="benchmark-bar-track">
            <div
              className="benchmark-bar-fill"
              style={{ width: `${(value.averageMs / maxAverage) * 100}%` }}
            />
          </div>
          <strong>{formatBenchmarkMs(value.averageMs)}</strong>
        </div>
      ))}
    </div>
  );
}

function PerformancePage() {
  const benchmarkRows = benchmarkData.results;
  const totalTrendValues = benchmarkRows.map((result) => ({
    voteCount: result.voteCount,
    totalMs: getBenchmarkAverage(result.summary, "totalMs")
  }));
  const moduleAverageValues = benchmarkMetrics
    .filter((metric) => metric.key !== "totalMs")
    .map((metric) => {
      const total = benchmarkRows.reduce(
        (sum, result) => sum + getBenchmarkAverage(result.summary, metric.key),
        0
      );

      return {
        label: metric.shortLabel,
        averageMs: total / benchmarkRows.length
      };
    });

  return (
    <section className="page-section performance-page">
      <div className="section-header">
        <div>
          <p className="eyebrow">Benchmark</p>
          <h1>性能评估</h1>
        </div>
      </div>

      <p className="page-lead">
        该性能测试基于本地模拟数据，主要用于评估 commitment、Merkle
        构建、Merkle proof、聚合审计等核心流程的计算开销；链上 gas 与 ZK
        proof 性能将在后续阶段单独测试。
      </p>

      <div className="panel benchmark-env">
        <h2>测试环境</h2>
        <div className="benchmark-env-grid">
          <div>
            <span>generatedAt</span>
            <code>{benchmarkData.generatedAt}</code>
          </div>
          <div>
            <span>nodeVersion</span>
            <code>{benchmarkData.environment.nodeVersion}</code>
          </div>
          <div>
            <span>platform</span>
            <code>{benchmarkData.environment.platform}</code>
          </div>
          <div>
            <span>arch</span>
            <code>{benchmarkData.environment.arch}</code>
          </div>
        </div>
      </div>

      <div className="panel benchmark-table-panel">
        <h2>结果表格</h2>
        <table>
          <thead>
            <tr>
              <th>voteCount</th>
              {benchmarkMetrics.map((metric) => (
                <th key={metric.key}>{metric.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {benchmarkRows.map((result) => (
              <tr key={result.voteCount}>
                <td>{result.voteCount}</td>
                {benchmarkMetrics.map((metric) => (
                  <td key={metric.key}>
                    {formatBenchmarkMs(
                      getBenchmarkAverage(result.summary, metric.key)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="two-column benchmark-chart-grid">
        <div className="panel benchmark-chart-panel">
          <h2>totalMs 趋势</h2>
          <TotalTrendChart values={totalTrendValues} />
        </div>
        <div className="panel benchmark-chart-panel">
          <h2>模块平均耗时</h2>
          <ModuleAverageChart values={moduleAverageValues} />
        </div>
      </div>

      <div className="panel benchmark-interpretation">
        <h2>结果解读</h2>
        <ul>
          <li>
            voteCount 增加时，totalMs 整体呈上升趋势，说明当前本地核心流程耗时会随投票规模扩大而增长。
          </li>
          <li>
            Merkle 构建和 commitment 生成是主要计算开销之一；在当前抽样 proof 设置下，Merkle proof 生成也占据了较明显的耗时。
          </li>
          <li>
            当前 benchmark 不包含真实链上 gas 和 ZK proof 开销，因此不能代表完整链上审计或零知识证明成本。
          </li>
          <li>后续会补充链上 gas 测试和 ZK proof 性能测试。</li>
        </ul>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
// Pedersen 实验页：承诺生成、开通验证、汇总承诺核查。
// --------------------------------------------------------------------------

interface PedersenContextSnapshot {
  electionId: string;
  contextLabel: string;
  contextHash: string;
  p: string;
  q: string;
  g: string;
  h: string[];
}

interface PedersenCommitmentRecord {
  commitment: string;
  randomness: string;
  length: number;
  contextHash: string;
}

interface PedersenCommitResponse {
  context: PedersenContextSnapshot;
  commitmentRecord: PedersenCommitmentRecord;
  message: string;
}

interface PedersenVerifyOpeningResponse {
  context: PedersenContextSnapshot;
  verified: boolean;
  message: string;
}

interface PedersenAggregateResponse {
  context: PedersenContextSnapshot;
  aggregatedCommitment: string;
  expectedCommitment: string;
  aggregatedRandomness: string;
  aggregatedVector: number[];
  verified: boolean;
  message: string;
}

interface PedersenBatchEntry {
  voteVector: string;
  randomness: string;
  commitment: string;
}

function parseIntegerVector(raw: string): number[] {
  return raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const n = Number(part);
      if (!Number.isInteger(n)) {
        throw new Error(`voteVector 包含非整数: ${part}`);
      }
      return n;
    });
}

function PedersenExperimentPage() {
  const [electionId, setElectionId] = useState("demo_pedersen_election");
  const [candidateCount, setCandidateCount] = useState(4);
  const [voteVectorText, setVoteVectorText] = useState("1,0,0,0");
  const [lastCommit, setLastCommit] = useState<PedersenCommitResponse | null>(
    null
  );
  const [openingResult, setOpeningResult] =
    useState<PedersenVerifyOpeningResponse | null>(null);
  const [tamperRandomness, setTamperRandomness] = useState("");
  const [batch, setBatch] = useState<PedersenBatchEntry[]>([]);
  const [aggregateResult, setAggregateResult] =
    useState<PedersenAggregateResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleCommit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setOpeningResult(null);
    try {
      const voteVector = parseIntegerVector(voteVectorText);
      if (voteVector.length !== candidateCount) {
        throw new Error(
          `voteVector 长度 ${voteVector.length} 与 candidateCount ${candidateCount} 不一致`
        );
      }
      const data = await apiRequest<PedersenCommitResponse>(
        "/crypto/pedersen/commit",
        {
          method: "POST",
          body: { electionId, candidateCount, voteVector }
        }
      );
      setLastCommit(data);
      setTamperRandomness(data.commitmentRecord.randomness);
      setBatch((previous) => [
        ...previous,
        {
          voteVector: voteVector.join(","),
          randomness: data.commitmentRecord.randomness,
          commitment: data.commitmentRecord.commitment
        }
      ]);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  async function handleVerifyOpening(useTamper: boolean) {
    if (!lastCommit) {
      setNotice({ type: "error", text: "请先生成一次 commitment" });
      return;
    }
    setNotice(null);
    try {
      const voteVector = parseIntegerVector(voteVectorText);
      const randomness = useTamper ? tamperRandomness : lastCommit.commitmentRecord.randomness;
      const data = await apiRequest<PedersenVerifyOpeningResponse>(
        "/crypto/pedersen/verify-opening",
        {
          method: "POST",
          body: {
            electionId,
            candidateCount,
            voteVector,
            randomness,
            commitment: lastCommit.commitmentRecord.commitment
          }
        }
      );
      setOpeningResult(data);
      setNotice({ type: data.verified ? "success" : "error", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  function updateBatchEntry(index: number, key: keyof PedersenBatchEntry, value: string) {
    setBatch((previous) =>
      previous.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [key]: value } : entry
      )
    );
  }

  function removeBatchEntry(index: number) {
    setBatch((previous) => previous.filter((_, entryIndex) => entryIndex !== index));
  }

  async function handleAggregateVerify() {
    setNotice(null);
    setAggregateResult(null);
    try {
      if (batch.length === 0) {
        throw new Error("batch 不能为空");
      }
      const payload = batch.map((entry) => ({
        voteVector: parseIntegerVector(entry.voteVector),
        randomness: entry.randomness.trim(),
        commitment: entry.commitment.trim()
      }));
      const data = await apiRequest<PedersenAggregateResponse>(
        "/crypto/pedersen/aggregate-verify",
        {
          method: "POST",
          body: {
            electionId,
            candidateCount,
            batch: payload
          }
        }
      );
      setAggregateResult(data);
      setNotice({ type: data.verified ? "success" : "error", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Experiment</p>
          <h1>Pedersen 承诺实验模块</h1>
        </div>
      </div>
      <p className="page-lead">
        Haechi 风格的向量承诺实验模块。用 RFC 3526 MODP Group 14（2048-bit）素数群、
        c = g^r · ∏ h_i^(v_i) mod p 构造。仅用于展示开通验证与汇总承诺核查，
        <strong>不替换</strong>现有 SHA-256 主流程。
      </p>

      <NoticeMessage notice={notice} />

      <form className="panel form" onSubmit={handleCommit}>
        <h2>1. 生成承诺</h2>
        <label>
          electionId
          <input value={electionId} onChange={(e) => setElectionId(e.target.value)} />
        </label>
        <label>
          candidateCount
          <input
            type="number"
            min={1}
            value={candidateCount}
            onChange={(e) => setCandidateCount(Number(e.target.value))}
          />
        </label>
        <label>
          voteVector (逗号或空格分隔的整数)
          <input value={voteVectorText} onChange={(e) => setVoteVectorText(e.target.value)} />
        </label>
        <button type="submit">commit(voteVector, r)</button>
      </form>

      {lastCommit ? (
        <div className="panel receipt-panel">
          <h2>最新承诺</h2>
          <div className="hash-list">
            <div>
              <span>contextHash</span>
              <code className="hash-value">{lastCommit.context.contextHash}</code>
            </div>
            <div>
              <span>commitment</span>
              <code className="hash-value">{lastCommit.commitmentRecord.commitment}</code>
            </div>
            <div>
              <span>randomness</span>
              <code className="hash-value">{lastCommit.commitmentRecord.randomness}</code>
            </div>
          </div>
        </div>
      ) : null}

      <div className="panel form">
        <h2>2. 开通验证 (Opening Verification)</h2>
        <p>
          使用当前页面的 (electionId, candidateCount, voteVector) 和最新承诺进行验证。
          可以改下面的 randomness 来演示<strong>篡改 opening</strong>导致验证失败。
        </p>
        <label>
          randomness (可篡改)
          <input value={tamperRandomness} onChange={(e) => setTamperRandomness(e.target.value)} />
        </label>
        <div className="inline-list">
          <button
            type="button"
            onClick={() => void handleVerifyOpening(false)}
            disabled={!lastCommit}
          >
            以原 randomness 验证
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleVerifyOpening(true)}
            disabled={!lastCommit}
          >
            以当前输入 randomness 验证（演示篡改）
          </button>
        </div>
        {openingResult ? (
          <div className="hash-list">
            <div>
              <span>verified</span>
              <code className="hash-value">{String(openingResult.verified)}</code>
            </div>
            <div>
              <span>message</span>
              <code className="hash-value">{openingResult.message}</code>
            </div>
          </div>
        ) : null}
      </div>

      <div className="panel form">
        <h2>3. 汇总承诺核查 (Aggregate Opening)</h2>
        <p>
          同态聚合：∏ C_i 应等于 commit(Σ v_i, Σ r_i mod q)。
          批次可以用上面「生成承诺」按钮自动累积，也可以手动编辑。
        </p>
        {batch.length === 0 ? (
          <p className="empty">暂无 batch 条目。点一次「commit」会自动加入。</p>
        ) : (
          <div className="list">
            {batch.map((entry, index) => (
              <article key={index} className="list-row">
                <div style={{ flex: 1 }}>
                  <label>
                    voteVector
                    <input
                      value={entry.voteVector}
                      onChange={(e) => updateBatchEntry(index, "voteVector", e.target.value)}
                    />
                  </label>
                  <label>
                    randomness
                    <input
                      value={entry.randomness}
                      onChange={(e) => updateBatchEntry(index, "randomness", e.target.value)}
                    />
                  </label>
                  <label>
                    commitment
                    <input
                      value={entry.commitment}
                      onChange={(e) => updateBatchEntry(index, "commitment", e.target.value)}
                    />
                  </label>
                </div>
                <button type="button" className="secondary" onClick={() => removeBatchEntry(index)}>
                  移除
                </button>
              </article>
            ))}
          </div>
        )}
        <button type="button" onClick={() => void handleAggregateVerify()}>
          运行 aggregate-verify
        </button>
        {aggregateResult ? (
          <div className="hash-list">
            <div>
              <span>verified</span>
              <code className="hash-value">{String(aggregateResult.verified)}</code>
            </div>
            <div>
              <span>aggregatedCommitment</span>
              <code className="hash-value">{aggregateResult.aggregatedCommitment}</code>
            </div>
            <div>
              <span>expectedCommitment</span>
              <code className="hash-value">{aggregateResult.expectedCommitment}</code>
            </div>
            <div>
              <span>aggregatedRandomness</span>
              <code className="hash-value">{aggregateResult.aggregatedRandomness}</code>
            </div>
            <div>
              <span>aggregatedVector</span>
              <code className="hash-value">
                [{aggregateResult.aggregatedVector.join(", ")}]
              </code>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
// 审计包导出页（Zeeperio 风格 artifact export）。
// --------------------------------------------------------------------------

const exportArtifactDescriptors: Array<{
  file: string;
  label: string;
  path: (electionId: string) => string;
}> = [
  {
    file: "bulletin_board.json",
    label: "公告板 / Merkle leaves",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/bulletin_board.json`
  },
  {
    file: "aggregator_report.json",
    label: "聚合器审计报告",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/aggregator_report.json`
  },
  {
    file: "zk_summary.json",
    label: "ZK 摘要",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/zk_summary.json`
  },
  {
    file: "chain_audit.json",
    label: "链上审计摘要",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/chain_audit.json`
  },
  {
    file: "public_inputs.json",
    label: "公共输入",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/public_inputs.json`
  }
];

// --------------------------------------------------------------------------
// Tally ZK 页：生成批次 tally correctness proof、查看 Solidity calldata、
// 走链上 verifier 提交审计摘要。
// --------------------------------------------------------------------------

interface TallyProofResponseUI {
  proofId: string;
  publicSignals: {
    electionIdHash: string;
    tally: number[];
    batchSize: number;
    circuitId: string;
  };
  proof: unknown;
  valid: boolean;
  message: string;
}

const TALLY_BATCH = 8;
const TALLY_CANDS = 4;

function createBalancedBatch(): number[][] {
  return Array.from({ length: TALLY_BATCH }, (_, i) =>
    Array.from({ length: TALLY_CANDS }, (_, j) => (i % TALLY_CANDS === j ? 1 : 0))
  );
}

function columnSums(matrix: number[][]): number[] {
  const sums = new Array(TALLY_CANDS).fill(0);
  for (const row of matrix) {
    for (let j = 0; j < TALLY_CANDS; j++) sums[j] += row[j];
  }
  return sums;
}

function TallyZkPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [matrixText, setMatrixText] = useState(
    JSON.stringify(createBalancedBatch())
  );
  const [tallyText, setTallyText] = useState(
    JSON.stringify(columnSums(createBalancedBatch()))
  );
  const [proofResult, setProofResult] = useState<TallyProofResponseUI | null>(null);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingProof, setLoadingProof] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);

  useEffect(() => {
    if (!electionId && elections.length > 0) setElectionId(elections[0].id);
  }, [electionId, elections]);

  function loadSamplePreset(preset: "valid" | "invalid-tally") {
    const batch = createBalancedBatch();
    setMatrixText(JSON.stringify(batch));
    const sums = columnSums(batch);
    if (preset === "invalid-tally") {
      sums[0] += 1;
      sums[1] -= 1;
    }
    setTallyText(JSON.stringify(sums));
    setProofResult(null);
    setSubmitResult(null);
    setNotice(null);
  }

  async function handleGenerate() {
    setNotice(null);
    setProofResult(null);
    setSubmitResult(null);
    if (!electionId) {
      setNotice({ type: "error", text: "请先选择 election" });
      return;
    }
    let voteVectors: number[][];
    let tally: number[];
    try {
      voteVectors = JSON.parse(matrixText);
      tally = JSON.parse(tallyText);
    } catch {
      setNotice({ type: "error", text: "voteVectors / tally 必须是合法 JSON 数组" });
      return;
    }
    setLoadingProof(true);
    try {
      const data = await apiRequest<TallyProofResponseUI>(
        "/zk/prove-tally-correctness",
        {
          method: "POST",
          body: { electionId, voteVectors, tally }
        }
      );
      setProofResult(data);
      setNotice({
        type: data.valid ? "success" : "error",
        text: data.message
      });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingProof(false);
    }
  }

  async function handleSubmitWithProof() {
    if (!electionId || !proofResult) {
      setNotice({ type: "error", text: "请先生成 tally proof" });
      return;
    }
    setSubmitResult(null);
    setLoadingSubmit(true);
    try {
      const data = await apiRequest<{ audit: { zkVerified?: boolean; transactionHash: string }; message: string }>(
        `/blockchain/elections/${encodeURIComponent(electionId)}/submit-audit-with-tally-proof`,
        {
          method: "POST",
          body: { tallyProofResponse: proofResult }
        }
      );
      setSubmitResult(
        `zkVerified=${String(Boolean(data.audit?.zkVerified))}  tx=${data.audit?.transactionHash}`
      );
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingSubmit(false);
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">ZK · batch</p>
          <h1>Tally Correctness ZK（批次计票正确性 + 链上 verifier）</h1>
        </div>
      </div>
      <p className="page-lead">
        对 {TALLY_BATCH} 张票 × {TALLY_CANDS} 候选人固定规模的批次，生成 Groth16 证明：
        每张票是合法 one-hot，并且列求和 = 公共 tally。
        可继续把该 proof 提交给 <code>/blockchain/elections/:id/submit-audit-with-tally-proof</code>，
        由链上 <code>TallyVerifier</code> 合约真正验证后写入 audit 记录。
      </p>

      <NoticeMessage notice={notice} />

      <div className="panel form">
        <div className="two-column">
          <label>
            选择 election
            <ElectionSelect
              elections={elections}
              value={electionId}
              onChange={setElectionId}
            />
          </label>
          <div className="inline-list" style={{ alignSelf: "flex-end" }}>
            <button
              type="button"
              className="secondary"
              onClick={() => loadSamplePreset("valid")}
            >
              载入 合法 batch
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => loadSamplePreset("invalid-tally")}
            >
              载入 篡改 tally
            </button>
          </div>
        </div>

        <label>
          voteVectors（{TALLY_BATCH} × {TALLY_CANDS} 的 JSON 矩阵）
          <textarea
            rows={6}
            value={matrixText}
            onChange={(e) => setMatrixText(e.target.value)}
          />
        </label>

        <label>
          tally（长度 {TALLY_CANDS} 的 JSON 数组）
          <input value={tallyText} onChange={(e) => setTallyText(e.target.value)} />
        </label>

        <div className="inline-list">
          <button type="button" onClick={() => void handleGenerate()} disabled={loadingProof}>
            {loadingProof ? "生成中..." : "生成 tally proof"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleSubmitWithProof()}
            disabled={!proofResult || !proofResult.valid || loadingSubmit}
          >
            {loadingSubmit ? "提交中..." : "提交到链上 (submitAuditWithTallyProof)"}
          </button>
        </div>
      </div>

      {proofResult ? (
        <div className="panel">
          <h2>proof 概览</h2>
          <div className="hash-list">
            <div>
              <span>proofId</span>
              <code className="hash-value">{proofResult.proofId}</code>
            </div>
            <div>
              <span>valid</span>
              <code className="hash-value">{String(proofResult.valid)}</code>
            </div>
            <div>
              <span>circuitId</span>
              <code className="hash-value">{proofResult.publicSignals.circuitId}</code>
            </div>
            <div>
              <span>tally (public)</span>
              <code className="hash-value">
                [{proofResult.publicSignals.tally.join(", ")}]
              </code>
            </div>
            <div>
              <span>batchSize (public)</span>
              <code className="hash-value">{proofResult.publicSignals.batchSize}</code>
            </div>
            <div>
              <span>electionIdHash</span>
              <code className="hash-value">{proofResult.publicSignals.electionIdHash}</code>
            </div>
          </div>
        </div>
      ) : null}

      {submitResult ? (
        <div className="panel receipt-panel">
          <h2>链上审计结果</h2>
          <code className="hash-value" style={{ whiteSpace: "pre-wrap" }}>
            {submitResult}
          </code>
        </div>
      ) : null}

      <div className="panel">
        <h2>流程解释</h2>
        <ol>
          <li>在 <strong>合法 batch</strong>、<strong>篡改 tally</strong> 两个预设间切换；前者 witness 生成 + Groth16 verify 都通过，后者 witness 生成阶段就会失败。</li>
          <li>点 <strong>提交到链上</strong> 会先调 <code>/blockchain/elections/:id/submit-audit-with-tally-proof</code>，后端再把 proof 编码成 <code>(a, b, c, input)</code> calldata 调 <code>VeriVoteAudit.submitAuditWithTallyProof(...)</code>。</li>
          <li>链上合约会委托 <code>TallyVerifier</code>（snarkjs 导出的 Solidity verifier；本地未生成时会回退到 <code>MockTallyVerifier</code>）。只有合约认可的 proof 才能写入 audit 记录，<code>record.zkVerified=true</code>。</li>
          <li>默认 <code>BLOCKCHAIN_AUDIT_MODE=local-mock</code>，不会真上链；要跑真实链上验证请切到 <code>hardhat</code> 模式并 <code>pnpm contract:deploy</code>。</li>
        </ol>
      </div>
    </section>
  );
}

function ArtifactExportPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingBundle, setLoadingBundle] = useState(false);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  async function downloadArtifact(path: string, filename: string) {
    setNotice(null);
    try {
      const response = await fetch(`${API_BASE_URL}${path}`);
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | ApiErrorResponse
          | null;
        throw new Error(errorPayload?.error ?? `请求失败 (${response.status})`);
      }
      const text = await response.text();
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPreviewTitle(filename);
      try {
        setPreview(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setPreview(text);
      }
      setNotice({ type: "success", text: `${filename} 已下载并预览。` });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  async function downloadBundle() {
    if (!electionId) {
      setNotice({ type: "error", text: "请先选择 election" });
      return;
    }
    setLoadingBundle(true);
    setNotice(null);
    try {
      const data = await apiRequest<{ bundle: unknown }>(
        `/elections/${encodeURIComponent(electionId)}/export-bundle`
      );
      const text = JSON.stringify(data.bundle, null, 2);
      const filename = `verivote_bundle_${electionId}.json`;
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPreviewTitle(filename);
      setPreview(text);
      setNotice({ type: "success", text: `${filename} 已下载并预览。` });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingBundle(false);
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Artifact</p>
          <h1>审计材料导出</h1>
        </div>
      </div>
      <p className="page-lead">
        Zeeperio 风格的 artifact export。按文件独立下载，也可以一次性下载合并 bundle。
        所有文件都包含当前选举的公开审计信息，可交给外部验证器复查。
      </p>

      <NoticeMessage notice={notice} />

      <div className="panel form">
        <label>
          选择选举
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={setElectionId}
          />
        </label>
        <div className="inline-list">
          {exportArtifactDescriptors.map((descriptor) => (
            <button
              key={descriptor.file}
              type="button"
              className="secondary"
              disabled={!electionId}
              onClick={() =>
                void downloadArtifact(
                  descriptor.path(electionId),
                  `${electionId}_${descriptor.file}`
                )
              }
            >
              下载 {descriptor.file}
            </button>
          ))}
          <button
            type="button"
            disabled={!electionId || loadingBundle}
            onClick={() => void downloadBundle()}
          >
            {loadingBundle ? "打包中..." : "下载合并 bundle.json"}
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>文件说明</h2>
        <ul>
          {exportArtifactDescriptors.map((descriptor) => (
            <li key={descriptor.file}>
              <code>{descriptor.file}</code> — {descriptor.label}
            </li>
          ))}
        </ul>
      </div>

      {preview ? (
        <div className="panel">
          <div className="verification-heading">
            <h2>预览：{previewTitle}</h2>
          </div>
          <pre
            className="hash-value"
            style={{ whiteSpace: "pre-wrap", maxHeight: "32rem", overflow: "auto" }}
          >
            {preview}
          </pre>
        </div>
      ) : null}
    </section>
  );
}

export function App() {
  const [portal, setPortal] = useState<Portal>("home");
  const [view, setView] = useState<View>("home");
  const [elections, setElections] = useState<Election[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const activePortal = portal === "home" ? null : portal;
  const activeNavItems = activePortal ? portalNavItems[activePortal] : [];

  async function refreshElections() {
    try {
      const data = await apiRequest<ListElectionsResponse>("/elections");
      setElections(data.elections);
      setNotice(null);
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  useEffect(() => {
    void refreshElections();
  }, []);

  function enterPortal(nextPortal: ActivePortal) {
    setPortal(nextPortal);
    setView("home");
  }

  function goPlatformHome() {
    setPortal("home");
    setView("home");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <button type="button" className="brand" onClick={goPlatformHome}>
            VeriVote
          </button>
          {activePortal ? (
            <span className="portal-chip">{portalLabels[activePortal].title}</span>
          ) : null}
        </div>
        {activePortal ? (
          <div className="topbar-actions">
            <nav aria-label={`${portalLabels[activePortal].title}导航`}>
              {activeNavItems.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  className={view === item.view ? "active" : ""}
                  onClick={() => setView(item.view)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <button type="button" className="secondary home-return" onClick={goPlatformHome}>
              平台首页
            </button>
          </div>
        ) : null}
      </header>

      <main>
        <NoticeMessage notice={notice} />
        {activePortal ? (
          <>
            {view === "home" ? (
              <HomePage
                portal={activePortal}
                elections={elections}
                onRefresh={refreshElections}
              />
            ) : null}
            {view === "create" ? (
              <CreateElectionPage
                elections={elections}
                onRefreshElections={refreshElections}
              />
            ) : null}
            {view === "register" ? (
              <RegisterUserPage
                title={portalLabels[activePortal].registerTitle}
                description={portalLabels[activePortal].registerLead}
              />
            ) : null}
            {view === "vote" ? <VotePage elections={elections} /> : null}
            {view === "challengeAudit" ? (
              <ChallengeAuditPage elections={elections} />
            ) : null}
            {view === "receipt" ? <ReceiptQueryPage /> : null}
            {view === "result" ? <ResultPage elections={elections} /> : null}
            {view === "bulletin" ? (
              <BulletinBoardPage
                elections={elections}
                onRefreshElections={refreshElections}
              />
            ) : null}
            {view === "merkle" ? <MerkleVerificationPage /> : null}
            {view === "aggregator" ? (
              <AggregatorPage elections={elections} />
            ) : null}
            {view === "audit" ? <AuditReportPage elections={elections} /> : null}
            {view === "chainAudit" ? (
              <ChainAuditPage elections={elections} />
            ) : null}
            {view === "zk" ? <ZkValidationPage /> : null}
            {view === "pedersen" ? <PedersenExperimentPage /> : null}
            {view === "tallyZk" ? (
              <TallyZkPage elections={elections} />
            ) : null}
            {view === "export" ? (
              <ArtifactExportPage elections={elections} />
            ) : null}
            {view === "benchmark" ? <PerformancePage /> : null}
            {view === "attack" ? <AttackLabPage elections={elections} /> : null}
          </>
        ) : (
          <PlatformHomePage onSelectPortal={enterPortal} />
        )}
      </main>
    </div>
  );
}
