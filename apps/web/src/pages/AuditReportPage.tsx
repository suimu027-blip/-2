import { useEffect, useState } from "react";
import type {
  Election,
  AggregatorReport,
  GetAggregatorReportResponse
} from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  receiptChainExplanation,
  type Notice
} from "../common";
import {
  ReceiptChainBreakList,
  TallyResultTable
} from "../components/AuditComponents";

export function AuditReportPage({ elections }: { elections: Election[] }) {
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
