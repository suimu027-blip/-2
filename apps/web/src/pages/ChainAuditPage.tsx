import { useEffect, useMemo, useState } from "react";
import type {
  BlockchainAuditRecord,
  Election,
  GetBlockchainAuditResponse,
  SubmitBlockchainAuditResponse
} from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  formatTime,
  NoticeMessage,
  ElectionSelect,
  type Notice
} from "../common";
import { demoChainAuditV2Sample } from "../data/demo-fixtures";

function getAuditModeLabel(auditMode: BlockchainAuditRecord["auditMode"]): string {
  return auditMode === "hardhat" ? "Hardhat" : "local-mock";
}

function ChainAuditDetails({ audit }: { audit: BlockchainAuditRecord }) {
  const verifierMode =
    audit.verifierMode ?? (audit.zkVerified ? "real-hardhat" : "pending");
  const rows = [
    ["auditMode", getAuditModeLabel(audit.auditMode)],
    ["verifierMode", verifierMode],
    ["contractAddress", audit.contractAddress],
    ["transactionHash", audit.transactionHash || "pending"],
    ["zkVerified", String(Boolean(audit.zkVerified))],
    ["gasUsed", audit.gasUsed === undefined ? "pending" : String(audit.gasUsed)],
    ["status", audit.status],
    ["electionId", audit.electionId],
    ["electionIdHash", audit.electionIdHash],
    ["merkleRoot", audit.merkleRoot],
    ["commitmentRoot", audit.commitmentRoot],
    ["receiptRoot", audit.receiptRoot],
    ["auditHash", audit.auditHash],
    ["tallyHash", audit.tallyHash],
    ["submitter", audit.submitter ?? audit.mockSubmitter ?? "pending"],
    ["createdAt", formatTime(audit.createdAt)]
  ];

  return (
    <div className="panel receipt-panel">
      <div className="verification-heading">
        <h2>chain audit result</h2>
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
  const [loadingAction, setLoadingAction] = useState<"submit" | "query" | null>(null);
  const [sampleMode, setSampleMode] = useState(false);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  const displayedAudit = useMemo(
    () => audit ?? (sampleMode ? (demoChainAuditV2Sample as BlockchainAuditRecord) : null),
    [audit, sampleMode]
  );

  async function handleSubmit() {
    setNotice(null);
    setSampleMode(false);

    if (!electionId) {
      setNotice({ type: "error", text: "Select an election first." });
      return;
    }

    try {
      setLoadingAction("submit");
      const data = await apiRequest<SubmitBlockchainAuditResponse>(
        `/blockchain/elections/${electionId}/submit-audit`,
        { method: "POST" }
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
    setSampleMode(false);

    if (!electionId) {
      setNotice({ type: "error", text: "Select an election first." });
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
          ? `${getAuditModeLabel(data.auditMode)} audit found.`
          : `${getAuditModeLabel(data.auditMode)} audit not found.`
      });
    } catch (error) {
      setAudit(null);
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingAction(null);
    }
  }

  function handleLoadSample() {
    setAudit(null);
    setSampleMode(true);
    setNotice({ type: "success", text: "Loaded chain audit v2 sample." });
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Blockchain Audit</p>
          <h1>Chain Audit</h1>
        </div>
        <button type="button" className="secondary" onClick={handleLoadSample}>
          Load real-hardhat sample
        </button>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel attack-warning">
        <strong>Summary anchoring</strong>
        <p>
          Only public audit hashes are submitted. Ballot plaintexts and challenge openings are not sent to the chain.
        </p>
      </div>

      <div className="panel form">
        <label>
          Election
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={(value) => {
              setElectionId(value);
              setAudit(null);
              setSampleMode(false);
            }}
          />
        </label>
        <div className="button-row">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!electionId || loadingAction !== null}
          >
            {loadingAction === "submit" ? "Submitting..." : "Submit audit"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleQuery()}
            disabled={!electionId || loadingAction !== null}
          >
            {loadingAction === "query" ? "Querying..." : "Query audit"}
          </button>
        </div>
      </div>

      {displayedAudit ? (
        <>
          {sampleMode ? (
            <p className="receipt-note">
              Fixture mode: this record mirrors docs/contracts/chain_audit.real.sample.json.
            </p>
          ) : null}
          <ChainAuditDetails audit={displayedAudit} />
        </>
      ) : (
        <div className="panel">
          <p className="empty">No chain audit record loaded.</p>
        </div>
      )}
    </section>
  );
}
