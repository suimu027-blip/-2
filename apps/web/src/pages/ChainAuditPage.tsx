import { useEffect, useState } from "react";
import type {
  Election,
  BlockchainAuditRecord,
  SubmitBlockchainAuditResponse,
  GetBlockchainAuditResponse
} from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  formatTime,
  NoticeMessage,
  ElectionSelect,
  type Notice
} from "../common";

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

export function ChainAuditPage({ elections }: { elections: Election[] }) {
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
