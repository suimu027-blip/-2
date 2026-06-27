import type {
  ReceiptChainBreak,
  ReceiptChainRecord,
  BulletinBoard,
  AggregatorReport,
  CandidatePartitionBucket,
  InvalidVoteDiagnostic,
  AggregatorReportIntegrityCheck
} from "@verivote/shared";
import { formatTime } from "../common";

interface HashSequenceProps {
  title: string;
  values: string[];
  emptyText: string;
}

export function HashSequence({ title, values, emptyText }: HashSequenceProps) {
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

interface ReceiptChainBreakListProps {
  breaks: ReceiptChainBreak[];
}

export function ReceiptChainBreakList({ breaks }: ReceiptChainBreakListProps) {
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

interface ReceiptChainTableProps {
  records: ReceiptChainRecord[];
}

export function ReceiptChainTable({ records }: ReceiptChainTableProps) {
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

interface BulletinTallyTableProps {
  bulletin: BulletinBoard;
}

export function BulletinTallyTable({ bulletin }: BulletinTallyTableProps) {
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

interface TallyResultTableProps {
  result: AggregatorReport["tallyResult"];
}

export function TallyResultTable({ result }: TallyResultTableProps) {
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

interface PartitionBucketTableProps {
  buckets: CandidatePartitionBucket[];
}

export function PartitionBucketTable({ buckets }: PartitionBucketTableProps) {
  if (buckets.length === 0) {
    return <p className="empty">暂无 partition bucket</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>候选人</th>
            <th>票数</th>
            <th>voteIds</th>
            <th>tokenHashes</th>
            <th>tokenRoot</th>
            <th>commitmentRoot</th>
            <th>receiptRoot</th>
            <th>bucketAuditHash</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.candidateId}>
              <td>
                {bucket.candidateName}
                <br />
                <code>{bucket.candidateId}</code>
              </td>
              <td>{bucket.voteCount}</td>
              <td>
                <code className="hash-value">
                  {bucket.voteIds.length === 0 ? "[]" : bucket.voteIds.join(", ")}
                </code>
              </td>
              <td>
                <code className="hash-value">
                  {bucket.tokenHashes.length === 0
                    ? "[]"
                    : bucket.tokenHashes.join(", ")}
                </code>
              </td>
              <td>
                <code className="hash-value">{bucket.tokenRoot}</code>
              </td>
              <td>
                <code className="hash-value">{bucket.commitmentRoot}</code>
              </td>
              <td>
                <code className="hash-value">{bucket.receiptRoot}</code>
              </td>
              <td>
                <code className="hash-value">{bucket.bucketAuditHash}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ReportProofAndPedersenPanelProps {
  report: AggregatorReport;
}

export function ReportProofAndPedersenPanel({
  report
}: ReportProofAndPedersenPanelProps) {
  const proof = report.tallyProofSummary;
  const pedersen = report.pedersenAggregateAudit;

  return (
    <div className="hash-list">
      <div>
        <span>proofStatus</span>
        <code className="hash-value">{report.proofStatus}</code>
      </div>
      <div>
        <span>tallyProofSummary.proofStatus</span>
        <code className="hash-value">{proof?.proofStatus ?? "null"}</code>
      </div>
      <div>
        <span>tallyProofSummary.proofId</span>
        <code className="hash-value">{proof?.proofId ?? "null"}</code>
      </div>
      <div>
        <span>tallyProofSummary.proofMode</span>
        <code className="hash-value">{proof?.proofMode ?? "null"}</code>
      </div>
      <div>
        <span>tallyProofSummary.verifierMode</span>
        <code className="hash-value">{proof?.verifierMode ?? "null"}</code>
      </div>
      <div>
        <span>tallyProofSummary.circuitId</span>
        <code className="hash-value">{proof?.circuitId ?? "null"}</code>
      </div>
      <div>
        <span>tallyProofSummary.proofHash</span>
        <code className="hash-value">{proof?.proofHash ?? "null"}</code>
      </div>
      <div>
        <span>tallyProofSummary.message</span>
        <code className="hash-value">{proof?.message ?? "null"}</code>
      </div>
      <div>
        <span>pedersenAggregateStatus</span>
        <code className="hash-value">{report.pedersenAggregateStatus}</code>
      </div>
      <div>
        <span>pedersenAggregateHash</span>
        <code className="hash-value">
          {report.pedersenAggregateHash ?? "null"}
        </code>
      </div>
      <div>
        <span>pedersenAggregateAudit.verified</span>
        <code className="hash-value">
          {pedersen ? String(pedersen.verified) : "null"}
        </code>
      </div>
      <div>
        <span>pedersenAggregateAudit.contextHash</span>
        <code className="hash-value">{pedersen?.contextHash ?? "null"}</code>
      </div>
      <div>
        <span>pedersenAggregateAudit.castVoteCount</span>
        <code className="hash-value">
          {pedersen?.castVoteCount ?? "null"}
        </code>
      </div>
      <div>
        <span>pedersenAggregateAudit.message</span>
        <code className="hash-value">{pedersen?.message ?? "null"}</code>
      </div>
    </div>
  );
}

interface PublicInputHintsPanelProps {
  hints: AggregatorReport["publicInputHints"];
}

export function PublicInputHintsPanel({ hints }: PublicInputHintsPanelProps) {
  return (
    <div className="hash-list">
      <div>
        <span>publicInputHints.electionIdHash</span>
        <code className="hash-value">{hints.electionIdHash}</code>
      </div>
      <div>
        <span>publicInputHints.candidateCount</span>
        <code className="hash-value">{hints.candidateCount}</code>
      </div>
      <div>
        <span>publicInputHints.validVotes</span>
        <code className="hash-value">{hints.validVotes}</code>
      </div>
      <div>
        <span>publicInputHints.tallyHash</span>
        <code className="hash-value">{hints.tallyHash}</code>
      </div>
      <div>
        <span>publicInputHints.commitmentRoot</span>
        <code className="hash-value">{hints.commitmentRoot}</code>
      </div>
      <div>
        <span>publicInputHints.receiptRoot</span>
        <code className="hash-value">{hints.receiptRoot}</code>
      </div>
      <div>
        <span>publicInputHints.partitionHash</span>
        <code className="hash-value">{hints.partitionHash}</code>
      </div>
      <div>
        <span>publicInputHints.diagnosticsHash</span>
        <code className="hash-value">{hints.diagnosticsHash}</code>
      </div>
      <div>
        <span>publicInputHints.pedersenAggregateHash</span>
        <code className="hash-value">
          {hints.pedersenAggregateHash ?? "null"}
        </code>
      </div>
    </div>
  );
}

interface VoteIdAccountingPanelProps {
  report: AggregatorReport;
}

export function VoteIdAccountingPanel({ report }: VoteIdAccountingPanelProps) {
  return (
    <div className="two-column">
      <HashSequence
        title="validVoteIds"
        values={report.validVoteIds}
        emptyText="No validVoteIds"
      />
      <HashSequence
        title="invalidVoteIds"
        values={report.invalidVoteIds}
        emptyText="No invalidVoteIds"
      />
    </div>
  );
}

interface InvalidVoteDiagnosticsTableProps {
  diagnostics: InvalidVoteDiagnostic[];
}

export function InvalidVoteDiagnosticsTable({
  diagnostics
}: InvalidVoteDiagnosticsTableProps) {
  if (diagnostics.length === 0) {
    return <p className="empty">暂无 invalid vote diagnostics</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>voteId</th>
            <th>reason</th>
            <th>detail</th>
            <th>tokenHash</th>
            <th>evidenceHash</th>
          </tr>
        </thead>
        <tbody>
          {diagnostics.map((diagnostic) => (
            <tr key={`${diagnostic.voteId}-${diagnostic.reason}-${diagnostic.evidenceHash}`}>
              <td>
                <code>{diagnostic.voteId}</code>
              </td>
              <td>{diagnostic.reason}</td>
              <td>{diagnostic.detail}</td>
              <td>
                <code className="hash-value">{diagnostic.tokenHash}</code>
              </td>
              <td>
                <code className="hash-value">{diagnostic.evidenceHash}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface IntegrityCheckTableProps {
  integrityCheck: AggregatorReportIntegrityCheck;
}

export function IntegrityCheckTable({
  integrityCheck
}: IntegrityCheckTableProps) {
  const entries = Object.entries(integrityCheck.checks);

  return (
    <div className="integrity-check">
      <div className="verification-heading">
        <h2>integrityCheck</h2>
        <span
          className={
            integrityCheck.verified ? "status-pill ok" : "status-pill bad"
          }
        >
          {integrityCheck.verified ? "verified" : "failed"}
        </span>
      </div>
      {integrityCheck.failures.length === 0 ? (
        <p className="empty">AggregatorReport v2 自校验全部通过</p>
      ) : (
        <p className="empty">
          失败项：{integrityCheck.failures.join(", ")}
        </p>
      )}
      <div className="hash-list">
        <div>
          <span>recomputed.auditHash</span>
          <code className="hash-value">
            {integrityCheck.recomputed.auditHash}
          </code>
        </div>
        <div>
          <span>recomputed.partitionHash</span>
          <code className="hash-value">
            {integrityCheck.recomputed.partitionHash}
          </code>
        </div>
        <div>
          <span>recomputed.diagnosticsHash</span>
          <code className="hash-value">
            {integrityCheck.recomputed.diagnosticsHash}
          </code>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>check</th>
              <th>result</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, ok]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>
                  <span className={ok ? "status-pill ok" : "status-pill bad"}>
                    {ok ? "true" : "false"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
