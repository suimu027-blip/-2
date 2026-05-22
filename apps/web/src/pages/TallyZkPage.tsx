import { useEffect, useState } from "react";
import type { Election } from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  type Notice
} from "../common";

interface TallyProofResponseUI {
  proofId: string;
  publicSignals: {
    electionIdHash: string;
    tally: number[];
    batchSize: number;
    circuitId: string;
  };
  proof: unknown;
  valid: boolean;
  message: string;
}

const TALLY_BATCH = 8;
const TALLY_CANDS = 4;

function createBalancedBatch(): number[][] {
  return Array.from({ length: TALLY_BATCH }, (_, i) =>
    Array.from({ length: TALLY_CANDS }, (_, j) => (i % TALLY_CANDS === j ? 1 : 0))
  );
}

function columnSums(matrix: number[][]): number[] {
  const sums = new Array(TALLY_CANDS).fill(0);
  for (const row of matrix) {
    for (let j = 0; j < TALLY_CANDS; j++) sums[j] += row[j];
  }
  return sums;
}

export function TallyZkPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [matrixText, setMatrixText] = useState(
    JSON.stringify(createBalancedBatch())
  );
  const [tallyText, setTallyText] = useState(
    JSON.stringify(columnSums(createBalancedBatch()))
  );
  const [proofResult, setProofResult] = useState<TallyProofResponseUI | null>(null);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingProof, setLoadingProof] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);

  useEffect(() => {
    if (!electionId && elections.length > 0) setElectionId(elections[0].id);
  }, [electionId, elections]);

  function loadSamplePreset(preset: "valid" | "invalid-tally") {
    const batch = createBalancedBatch();
    setMatrixText(JSON.stringify(batch));
    const sums = columnSums(batch);
    if (preset === "invalid-tally") {
      sums[0] += 1;
      sums[1] -= 1;
    }
    setTallyText(JSON.stringify(sums));
    setProofResult(null);
    setSubmitResult(null);
    setNotice(null);
  }

  async function handleGenerate() {
    setNotice(null);
    setProofResult(null);
    setSubmitResult(null);
    if (!electionId) {
      setNotice({ type: "error", text: "请先选择 election" });
      return;
    }
    let voteVectors: number[][];
    let tally: number[];
    try {
      voteVectors = JSON.parse(matrixText);
      tally = JSON.parse(tallyText);
    } catch {
      setNotice({ type: "error", text: "voteVectors / tally 必须是合法 JSON 数组" });
      return;
    }
    setLoadingProof(true);
    try {
      const data = await apiRequest<TallyProofResponseUI>(
        "/zk/prove-tally-correctness",
        {
          method: "POST",
          body: { electionId, voteVectors, tally }
        }
      );
      setProofResult(data);
      setNotice({
        type: data.valid ? "success" : "error",
        text: data.message
      });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingProof(false);
    }
  }

  async function handleSubmitWithProof() {
    if (!electionId || !proofResult) {
      setNotice({ type: "error", text: "请先生成 tally proof" });
      return;
    }
    setSubmitResult(null);
    setLoadingSubmit(true);
    try {
      const data = await apiRequest<{ audit: { zkVerified?: boolean; transactionHash: string }; message: string }>(
        `/blockchain/elections/${encodeURIComponent(electionId)}/submit-audit-with-tally-proof`,
        {
          method: "POST",
          body: { tallyProofResponse: proofResult }
        }
      );
      setSubmitResult(
        `zkVerified=${String(Boolean(data.audit?.zkVerified))}  tx=${data.audit?.transactionHash}`
      );
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingSubmit(false);
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">ZK · batch</p>
          <h1>Tally Correctness ZK（批次计票正确性 + 链上 verifier）</h1>
        </div>
      </div>
      <p className="page-lead">
        对 {TALLY_BATCH} 张票 × {TALLY_CANDS} 候选人固定规模的批次，生成 Groth16 证明：
        每张票是合法 one-hot，并且列求和 = 公共 tally。
        可继续把该 proof 提交给 <code>/blockchain/elections/:id/submit-audit-with-tally-proof</code>，
        由链上 <code>TallyVerifier</code> 合约真正验证后写入 audit 记录。
      </p>

      <NoticeMessage notice={notice} />

      <div className="panel form">
        <div className="two-column">
          <label>
            选择 election
            <ElectionSelect
              elections={elections}
              value={electionId}
              onChange={setElectionId}
            />
          </label>
          <div className="inline-list" style={{ alignSelf: "flex-end" }}>
            <button
              type="button"
              className="secondary"
              onClick={() => loadSamplePreset("valid")}
            >
              载入 合法 batch
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => loadSamplePreset("invalid-tally")}
            >
              载入 篡改 tally
            </button>
          </div>
        </div>

        <label>
          voteVectors（{TALLY_BATCH} × {TALLY_CANDS} 的 JSON 矩阵）
          <textarea
            rows={6}
            value={matrixText}
            onChange={(e) => setMatrixText(e.target.value)}
          />
        </label>

        <label>
          tally（长度 {TALLY_CANDS} 的 JSON 数组）
          <input value={tallyText} onChange={(e) => setTallyText(e.target.value)} />
        </label>

        <div className="inline-list">
          <button type="button" onClick={() => void handleGenerate()} disabled={loadingProof}>
            {loadingProof ? "生成中..." : "生成 tally proof"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleSubmitWithProof()}
            disabled={!proofResult || !proofResult.valid || loadingSubmit}
          >
            {loadingSubmit ? "提交中..." : "提交到链上 (submitAuditWithTallyProof)"}
          </button>
        </div>
      </div>

      {proofResult ? (
        <div className="panel">
          <h2>proof 概览</h2>
          <div className="hash-list">
            <div>
              <span>proofId</span>
              <code className="hash-value">{proofResult.proofId}</code>
            </div>
            <div>
              <span>valid</span>
              <code className="hash-value">{String(proofResult.valid)}</code>
            </div>
            <div>
              <span>circuitId</span>
              <code className="hash-value">{proofResult.publicSignals.circuitId}</code>
            </div>
            <div>
              <span>tally (public)</span>
              <code className="hash-value">
                [{proofResult.publicSignals.tally.join(", ")}]
              </code>
            </div>
            <div>
              <span>batchSize (public)</span>
              <code className="hash-value">{proofResult.publicSignals.batchSize}</code>
            </div>
            <div>
              <span>electionIdHash</span>
              <code className="hash-value">{proofResult.publicSignals.electionIdHash}</code>
            </div>
          </div>
        </div>
      ) : null}

      {submitResult ? (
        <div className="panel receipt-panel">
          <h2>链上审计结果</h2>
          <code className="hash-value" style={{ whiteSpace: "pre-wrap" }}>
            {submitResult}
          </code>
        </div>
      ) : null}

      <div className="panel">
        <h2>流程解释</h2>
        <ol>
          <li>在 <strong>合法 batch</strong>、<strong>篡改 tally</strong> 两个预设间切换；前者 witness 生成 + Groth16 verify 都通过，后者 witness 生成阶段就会失败。</li>
          <li>点 <strong>提交到链上</strong> 会先调 <code>/blockchain/elections/:id/submit-audit-with-tally-proof</code>，后端再把 proof 编码成 <code>(a, b, c, input)</code> calldata 调 <code>VeriVoteAudit.submitAuditWithTallyProof(...)</code>。</li>
          <li>链上合约会委托 <code>TallyVerifier</code>（snarkjs 导出的 Solidity verifier；本地未生成时会回退到 <code>MockTallyVerifier</code>）。只有合约认可的 proof 才能写入 audit 记录，<code>record.zkVerified=true</code>。</li>
          <li>默认 <code>BLOCKCHAIN_AUDIT_MODE=local-mock</code>，不会真上链；要跑真实链上验证请切到 <code>hardhat</code> 模式并 <code>pnpm contract:deploy</code>。</li>
        </ol>
      </div>
    </section>
  );
}
