import { useEffect, useMemo, useState } from "react";
import type {
  AggregatorReportV2,
  Election,
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
import { demoAggregatorReportV2Sample } from "../data/demo-fixtures";

export function AuditReportPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [report, setReport] = useState<AggregatorReportV2 | null>(null);
  const [sampleMode, setSampleMode] = useState(false);
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

  const displayedReport = useMemo(
    () => (report ?? (sampleMode ? (demoAggregatorReportV2Sample as AggregatorReportV2) : null)),
    [report, sampleMode]
  );
  const displayedConsistency = consistency ??
    (sampleMode
      ? {
          tallyConsistent: true,
          consistencyMessage: "Sample tally is internally consistent."
        }
      : null);

  async function handleQuery() {
    setNotice(null);
    setSampleMode(false);

    if (!electionId) {
      setNotice({ type: "error", text: "Select an election first." });
      return;
    }

    try {
      const data = await apiRequest<GetAggregatorReportResponse>(
        `/aggregator/elections/${electionId}/report`
      );
      setReport(data.report as AggregatorReportV2);
      setConsistency({
        tallyConsistent: data.tallyConsistent,
        consistencyMessage: data.consistencyMessage
      });
      setNotice({ type: "success", text: "Audit report loaded." });
    } catch (error) {
      setReport(null);
      setConsistency(null);
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  function handleSample() {
    setReport(null);
    setConsistency(null);
    setSampleMode(true);
    setNotice({ type: "success", text: "Loaded audit report v2 sample." });
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Audit</p>
          <h1>Audit Report</h1>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={handleSample}>
            Load v2 sample
          </button>
          <button
            type="button"
            onClick={() => void handleQuery()}
            disabled={!electionId}
          >
            Query report
          </button>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel form">
        <label>
          Election
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={(value) => {
              setElectionId(value);
              setReport(null);
              setConsistency(null);
              setSampleMode(false);
            }}
          />
        </label>
      </div>

      {displayedReport ? (
        <>
          {sampleMode ? (
            <p className="receipt-note">
              Fixture mode: diagnostics and partition fields are rendered from v2 sample JSON.
            </p>
          ) : null}

          {displayedConsistency ? (
            <div className="panel receipt-panel">
              <div className="verification-heading">
                <h2>tallyConsistent</h2>
                <span
                  className={
                    displayedConsistency.tallyConsistent
                      ? "status-pill ok"
                      : "status-pill bad"
                  }
                >
                  {String(displayedConsistency.tallyConsistent)}
                </span>
              </div>
              <p>{displayedConsistency.consistencyMessage}</p>
            </div>
          ) : null}

          <div className="panel receipt-panel">
            <div className="verification-heading">
              <h2>receiptChainVerified</h2>
              <span
                className={
                  displayedReport.receiptChainVerified
                    ? "status-pill ok"
                    : "status-pill bad"
                }
              >
                {String(displayedReport.receiptChainVerified)}
              </span>
            </div>
            <p className="receipt-note">{receiptChainExplanation}</p>
            <ReceiptChainBreakList breaks={displayedReport.receiptChainBreaks} />
          </div>

          <div className="panel receipt-panel">
            <h2>v2 hashes</h2>
            <div className="hash-list">
              <div>
                <span>electionId</span>
                <code className="hash-value">{displayedReport.electionId}</code>
              </div>
              <div>
                <span>auditHash</span>
                <code className="hash-value">{displayedReport.auditHash}</code>
              </div>
              <div>
                <span>partitionHash</span>
                <code className="hash-value">
                  {displayedReport.partitionAudit?.partitionHash ?? "pending"}
                </code>
              </div>
              <div>
                <span>diagnosticsHash</span>
                <code className="hash-value">
                  {displayedReport.diagnosticsHash ?? "pending"}
                </code>
              </div>
              <div>
                <span>pedersenAggregateHash</span>
                <code className="hash-value">
                  {displayedReport.pedersenAggregateHash ?? "pending"}
                </code>
              </div>
              <div>
                <span>commitmentRoot</span>
                <code className="hash-value">{displayedReport.commitmentRoot}</code>
              </div>
              <div>
                <span>receiptRoot</span>
                <code className="hash-value">{displayedReport.receiptRoot}</code>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>invalidVoteDiagnostics</h2>
            {displayedReport.invalidVoteDiagnostics?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>voteId</th>
                      <th>tokenHash</th>
                      <th>reason</th>
                      <th>evidenceHash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedReport.invalidVoteDiagnostics.map((diagnostic) => (
                      <tr key={`${diagnostic.voteId}-${diagnostic.evidenceHash}`}>
                        <td>
                          <code>{diagnostic.voteId}</code>
                        </td>
                        <td>
                          <code className="hash-value">{diagnostic.tokenHash}</code>
                        </td>
                        <td>{diagnostic.reason}</td>
                        <td>
                          <code className="hash-value">{diagnostic.evidenceHash}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">No invalid vote diagnostics.</p>
            )}
          </div>

          <div className="panel">
            <h2>tallyResult</h2>
            <TallyResultTable result={displayedReport.tallyResult} />
          </div>
        </>
      ) : (
        <div className="panel">
          <p className="empty">Query the report or load the v2 sample.</p>
        </div>
      )}
    </section>
  );
}
