import { type FormEvent, useState } from "react";
import type {
  PedersenCommitResponse,
  PedersenVerifyOpeningResponse,
  PedersenAggregateResponse
} from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  type Notice
} from "../common";

interface PedersenBatchEntry {
  voteVector: string;
  randomness: string;
  commitment: string;
}

function parseIntegerVector(raw: string): number[] {
  return raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const n = Number(part);
      if (!Number.isInteger(n)) {
        throw new Error(`voteVector 包含非整数: ${part}`);
      }
      return n;
    });
}

export function PedersenExperimentPage() {
  const [electionId, setElectionId] = useState("demo_pedersen_election");
  const [candidateCount, setCandidateCount] = useState(4);
  const [voteVectorText, setVoteVectorText] = useState("1,0,0,0");
  const [lastCommit, setLastCommit] = useState<PedersenCommitResponse | null>(
    null
  );
  const [openingResult, setOpeningResult] =
    useState<PedersenVerifyOpeningResponse | null>(null);
  const [tamperRandomness, setTamperRandomness] = useState("");
  const [batch, setBatch] = useState<PedersenBatchEntry[]>([]);
  const [aggregateResult, setAggregateResult] =
    useState<PedersenAggregateResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleCommit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setOpeningResult(null);
    try {
      const voteVector = parseIntegerVector(voteVectorText);
      if (voteVector.length !== candidateCount) {
        throw new Error(
          `voteVector 长度 ${voteVector.length} 与 candidateCount ${candidateCount} 不一致`
        );
      }
      const data = await apiRequest<PedersenCommitResponse>(
        "/crypto/pedersen/commit",
        {
          method: "POST",
          body: { electionId, candidateCount, voteVector }
        }
      );
      setLastCommit(data);
      setTamperRandomness(data.commitmentRecord.randomness);
      setBatch((previous) => [
        ...previous,
        {
          voteVector: voteVector.join(","),
          randomness: data.commitmentRecord.randomness,
          commitment: data.commitmentRecord.commitment
        }
      ]);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  async function handleVerifyOpening(useTamper: boolean) {
    if (!lastCommit) {
      setNotice({ type: "error", text: "请先生成一次 commitment" });
      return;
    }
    setNotice(null);
    try {
      const voteVector = parseIntegerVector(voteVectorText);
      const randomness = useTamper ? tamperRandomness : lastCommit.commitmentRecord.randomness;
      const data = await apiRequest<PedersenVerifyOpeningResponse>(
        "/crypto/pedersen/verify-opening",
        {
          method: "POST",
          body: {
            electionId,
            candidateCount,
            voteVector,
            randomness,
            commitment: lastCommit.commitmentRecord.commitment
          }
        }
      );
      setOpeningResult(data);
      setNotice({ type: data.verified ? "success" : "error", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  function updateBatchEntry(index: number, key: keyof PedersenBatchEntry, value: string) {
    setBatch((previous) =>
      previous.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [key]: value } : entry
      )
    );
  }

  function removeBatchEntry(index: number) {
    setBatch((previous) => previous.filter((_, entryIndex) => entryIndex !== index));
  }

  async function handleAggregateVerify() {
    setNotice(null);
    setAggregateResult(null);
    try {
      if (batch.length === 0) {
        throw new Error("batch 不能为空");
      }
      const payload = batch.map((entry) => ({
        voteVector: parseIntegerVector(entry.voteVector),
        randomness: entry.randomness.trim(),
        commitment: entry.commitment.trim()
      }));
      const data = await apiRequest<PedersenAggregateResponse>(
        "/crypto/pedersen/aggregate-verify",
        {
          method: "POST",
          body: {
            electionId,
            candidateCount,
            batch: payload
          }
        }
      );
      setAggregateResult(data);
      setNotice({ type: data.verified ? "success" : "error", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Experiment</p>
          <h1>Pedersen 承诺实验模块</h1>
        </div>
      </div>
      <p className="page-lead">
        Haechi 风格的向量承诺实验模块。用 RFC 3526 MODP Group 14（2048-bit）素数群、
        c = g^r · ∏ h_i^(v_i) mod p 构造。仅用于展示开通验证与汇总承诺核查，
        <strong>不替换</strong>现有 SHA-256 主流程。
      </p>

      <NoticeMessage notice={notice} />

      <form className="panel form" onSubmit={handleCommit}>
        <h2>1. 生成承诺</h2>
        <label>
          electionId
          <input value={electionId} onChange={(e) => setElectionId(e.target.value)} />
        </label>
        <label>
          candidateCount
          <input
            type="number"
            min={1}
            value={candidateCount}
            onChange={(e) => setCandidateCount(Number(e.target.value))}
          />
        </label>
        <label>
          voteVector (逗号或空格分隔的整数)
          <input value={voteVectorText} onChange={(e) => setVoteVectorText(e.target.value)} />
        </label>
        <button type="submit">commit(voteVector, r)</button>
      </form>

      {lastCommit ? (
        <div className="panel receipt-panel">
          <h2>最新承诺</h2>
          <div className="hash-list">
            <div>
              <span>contextHash</span>
              <code className="hash-value">{lastCommit.context.contextHash}</code>
            </div>
            <div>
              <span>commitment</span>
              <code className="hash-value">{lastCommit.commitmentRecord.commitment}</code>
            </div>
            <div>
              <span>randomness</span>
              <code className="hash-value">{lastCommit.commitmentRecord.randomness}</code>
            </div>
          </div>
        </div>
      ) : null}

      <div className="panel form">
        <h2>2. 开通验证 (Opening Verification)</h2>
        <p>
          使用当前页面的 (electionId, candidateCount, voteVector) 和最新承诺进行验证。
          可以改下面的 randomness 来演示<strong>篡改 opening</strong>导致验证失败。
        </p>
        <label>
          randomness (可篡改)
          <input value={tamperRandomness} onChange={(e) => setTamperRandomness(e.target.value)} />
        </label>
        <div className="inline-list">
          <button
            type="button"
            onClick={() => void handleVerifyOpening(false)}
            disabled={!lastCommit}
          >
            以原 randomness 验证
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleVerifyOpening(true)}
            disabled={!lastCommit}
          >
            以当前输入 randomness 验证（演示篡改）
          </button>
        </div>
        {openingResult ? (
          <div className="hash-list">
            <div>
              <span>verified</span>
              <code className="hash-value">{String(openingResult.verified)}</code>
            </div>
            <div>
              <span>message</span>
              <code className="hash-value">{openingResult.message}</code>
            </div>
          </div>
        ) : null}
      </div>

      <div className="panel form">
        <h2>3. 汇总承诺核查 (Aggregate Opening)</h2>
        <p>
          同态聚合：∏ C_i 应等于 commit(Σ v_i, Σ r_i mod q)。
          批次可以用上面「生成承诺」按钮自动累积，也可以手动编辑。
        </p>
        {batch.length === 0 ? (
          <p className="empty">暂无 batch 条目。点一次「commit」会自动加入。</p>
        ) : (
          <div className="list">
            {batch.map((entry, index) => (
              <article key={index} className="list-row">
                <div style={{ flex: 1 }}>
                  <label>
                    voteVector
                    <input
                      value={entry.voteVector}
                      onChange={(e) => updateBatchEntry(index, "voteVector", e.target.value)}
                    />
                  </label>
                  <label>
                    randomness
                    <input
                      value={entry.randomness}
                      onChange={(e) => updateBatchEntry(index, "randomness", e.target.value)}
                    />
                  </label>
                  <label>
                    commitment
                    <input
                      value={entry.commitment}
                      onChange={(e) => updateBatchEntry(index, "commitment", e.target.value)}
                    />
                  </label>
                </div>
                <button type="button" className="secondary" onClick={() => removeBatchEntry(index)}>
                  移除
                </button>
              </article>
            ))}
          </div>
        )}
        <button type="button" onClick={() => void handleAggregateVerify()}>
          运行 aggregate-verify
        </button>
        {aggregateResult ? (
          <div className="hash-list">
            <div>
              <span>verified</span>
              <code className="hash-value">{String(aggregateResult.verified)}</code>
            </div>
            <div>
              <span>aggregatedCommitment</span>
              <code className="hash-value">{aggregateResult.aggregatedCommitment}</code>
            </div>
            <div>
              <span>expectedCommitment</span>
              <code className="hash-value">{aggregateResult.expectedCommitment}</code>
            </div>
            <div>
              <span>aggregatedRandomness</span>
              <code className="hash-value">{aggregateResult.aggregatedRandomness}</code>
            </div>
            <div>
              <span>aggregatedVector</span>
              <code className="hash-value">
                [{aggregateResult.aggregatedVector.join(", ")}]
              </code>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
