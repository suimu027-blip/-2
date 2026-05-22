import { type FormEvent, useState } from "react";
import type { GetReceiptResponse } from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  formatTime,
  receiptChainExplanation,
  type Notice
} from "../common";

export function ReceiptQueryPage() {
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
