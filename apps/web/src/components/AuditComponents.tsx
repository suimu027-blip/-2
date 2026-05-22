import type {
  ReceiptChainBreak,
  ReceiptChainRecord,
  BulletinBoard,
  AggregatorReport
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
