import { type FormEvent, useState } from "react";
import type { GetReceiptProofResponse } from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  type Notice
} from "../common";

export function MerkleVerificationPage() {
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
