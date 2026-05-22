import { useEffect, useState } from "react";
import type { Election, AggregatorReport, RunAggregatorResponse } from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  receiptChainExplanation,
  formatTime,
  type Notice
} from "../common";
import { ReceiptChainBreakList, HashSequence } from "../components/AuditComponents";

interface AggregatorPageProps {
  elections: Election[];
}

export function AggregatorPage({ elections }: AggregatorPageProps) {
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
