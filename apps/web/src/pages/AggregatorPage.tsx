import { useEffect, useMemo, useState } from "react";
import type {
  AggregatorReportV2,
  Election,
  RunAggregatorResponse
} from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  receiptChainExplanation,
  formatTime,
  type Notice
} from "../common";
import { HashSequence, ReceiptChainBreakList } from "../components/AuditComponents";
import { demoAggregatorReportV2Sample } from "../data/demo-fixtures";

interface AggregatorPageProps {
  elections: Election[];
}

function getPedersenStatus(report: AggregatorReportV2): {
  label: string;
  ok: boolean | null;
} {
  if (report.pedersenAggregateAudit) {
    return {
      label: report.pedersenAggregateAudit.verified ? "ok" : "failed",
      ok: report.pedersenAggregateAudit.verified
    };
  }

  if (report.pedersenTallyVerified !== undefined) {
    return {
      label: report.pedersenTallyVerified ? "ok" : "failed",
      ok: report.pedersenTallyVerified
    };
  }

  return { label: "pending", ok: null };
}

export function AggregatorPage({ elections }: AggregatorPageProps) {
  const [electionId, setElectionId] = useState("");
  const [report, setReport] = useState<AggregatorReportV2 | null>(null);
  const [useSample, setUseSample] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  const displayedReport = useMemo(
    () => (report ?? (useSample ? (demoAggregatorReportV2Sample as AggregatorReportV2) : null)),
    [report, useSample]
  );

  async function handleRun() {
    setNotice(null);
    setUseSample(false);

    if (!electionId) {
      setNotice({ type: "error", text: "Select an election first." });
      return;
    }

    try {
      const data = await apiRequest<RunAggregatorResponse>(
        `/aggregator/elections/${electionId}/run`,
        { method: "POST" }
      );
      setReport(data.report as AggregatorReportV2);
      setNotice({ type: "success", text: "Aggregator report generated." });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  function handleLoadSample() {
    setReport(null);
    setUseSample(true);
    setNotice({ type: "success", text: "Loaded AggregatorReport v2 sample." });
  }

  const pedersenStatus = displayedReport ? getPedersenStatus(displayedReport) : null;

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Aggregator</p>
          <h1>Aggregator Audit</h1>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="secondary"
            onClick={handleLoadSample}
          >
            Load v2 sample
          </button>
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={!electionId}
          >
            Run aggregator
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
              setUseSample(false);
            }}
          />
        </label>
      </div>

      {displayedReport ? (
        <>
          {useSample ? (
            <p className="receipt-note">
              Fixture mode: this page is rendering docs/contracts/aggregator_report_v2.sample.json shape.
            </p>
          ) : null}

          <div className="stats">
            <div>
              <span>{displayedReport.totalVotes}</span>
              <p>totalVotes</p>
            </div>
            <div>
              <span>{displayedReport.validVotes}</span>
              <p>validVotes</p>
            </div>
            <div>
              <span>{displayedReport.invalidVotes}</span>
              <p>invalidVotes</p>
            </div>
            <div>
              <span>{displayedReport.duplicateVotes}</span>
              <p>duplicateVotes</p>
            </div>
          </div>

          <div className="panel">
            <div className="verification-heading">
              <h2>Security checklist</h2>
              <span
                className={
                  displayedReport.receiptChainVerified &&
                  displayedReport.partitionAudit?.coverComplete !== false &&
                  pedersenStatus?.ok !== false
                    ? "status-pill ok"
                    : "status-pill bad"
                }
              >
                D-demo
              </span>
            </div>
            <div className="checklist-grid">
              <span>{displayedReport.receiptChainVerified ? "ok" : "fail"} receipt included</span>
              <span>{displayedReport.partitionAudit ? "ok" : "pending"} partition audit</span>
              <span>{pedersenStatus?.label ?? "pending"} Pedersen aggregate</span>
              <span>pending ZK verified</span>
              <span>pending chain matched</span>
            </div>
          </div>

          <div className="panel receipt-panel">
            <div className="hash-list">
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
                <span>createdAt</span>
                <code className="hash-value">{formatTime(displayedReport.createdAt)}</code>
              </div>
            </div>
            <p className="receipt-note">{receiptChainExplanation}</p>
          </div>

          <div className="panel">
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
            <ReceiptChainBreakList breaks={displayedReport.receiptChainBreaks} />
          </div>

          <div className="panel">
            <h2>partitionAudit buckets</h2>
            {displayedReport.partitionAudit ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>candidate</th>
                      <th>voteCount</th>
                      <th>voteIds</th>
                      <th>bucketAuditHash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedReport.partitionAudit.buckets.map((bucket) => (
                      <tr key={bucket.candidateId}>
                        <td>{bucket.candidateName}</td>
                        <td>{bucket.voteCount}</td>
                        <td>
                          <code>{bucket.voteIds.join(", ")}</code>
                        </td>
                        <td>
                          <code className="hash-value">{bucket.bucketAuditHash}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">partitionAudit pending. A can replace this with real report fields later.</p>
            )}
          </div>

          <div className="panel">
            <h2>invalidVoteDiagnostics</h2>
            {displayedReport.invalidVoteDiagnostics?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>voteId</th>
                      <th>reason</th>
                      <th>detail</th>
                      <th>evidenceHash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedReport.invalidVoteDiagnostics.map((diagnostic) => (
                      <tr key={`${diagnostic.voteId}-${diagnostic.reason}`}>
                        <td>
                          <code>{diagnostic.voteId}</code>
                        </td>
                        <td>{diagnostic.reason}</td>
                        <td>{diagnostic.detail}</td>
                        <td>
                          <code className="hash-value">{diagnostic.evidenceHash}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">No invalid diagnostics in current report.</p>
            )}
          </div>

          <div className="two-column">
            <div className="panel">
              <HashSequence
                title="voteTokenHashes"
                values={displayedReport.voteTokenHashes}
                emptyText="No vote token hashes"
              />
            </div>
            <div className="panel">
              <HashSequence
                title="duplicateTokenHashes"
                values={displayedReport.duplicateTokenHashes}
                emptyText="No duplicate tokens"
              />
            </div>
          </div>
        </>
      ) : (
        <div className="panel">
          <p className="empty">Run the aggregator or load the v2 sample.</p>
        </div>
      )}
    </section>
  );
}
