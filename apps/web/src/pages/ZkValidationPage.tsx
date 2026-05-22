import { type FormEvent, useMemo, useState } from "react";
import type {
  ZkValidityProofRequest,
  ZkValidityProofResponse,
  ZkValidityVerifyRequest,
  ZkValidityVerifyResponse
} from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  formatJson,
  NoticeMessage,
  type ZkProofMode,
  type Notice
} from "../common";

const zkVotePresets: Array<{ label: string; voteVector: number[] }> = [
  { label: "合法票 A：[1,0,0,0]", voteVector: [1, 0, 0, 0] },
  { label: "合法票 B：[0,1,0,0]", voteVector: [0, 1, 0, 0] },
  { label: "非法多选：[1,1,0,0]", voteVector: [1, 1, 0, 0] },
  { label: "非法空票：[0,0,0,0]", voteVector: [0, 0, 0, 0] },
  { label: "非法数值：[2,0,0,0]", voteVector: [2, 0, 0, 0] }
];

function parseVoteVectorInput(value: string): number[] {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("请输入 voteVector");
  }

  const parsed = trimmed.startsWith("[")
    ? (JSON.parse(trimmed) as unknown)
    : trimmed.split(",").map((item) => Number(item.trim()));

  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    throw new Error("voteVector 必须 be number[]，例如 [1,0,0,0]");
  }

  return parsed;
}

function getZkProofModeLabel(proofMode: ZkValidityProofResponse["proofMode"]): string {
  return proofMode === "real"
    ? "Real Groth16 ZK Proof"
    : "Mock ZK Validity Proof";
}

interface ZkProofModeRequest extends ZkValidityProofRequest {
  proofMode: ZkProofMode;
}

export function ZkValidationPage() {
  const [electionId, setElectionId] = useState("election_1");
  const [candidateCount, setCandidateCount] = useState("4");
  const [voteVectorText, setVoteVectorText] = useState("[1,0,0,0]");
  const [proofMode, setProofMode] = useState<ZkProofMode>("mock");
  const [proofResult, setProofResult] =
    useState<ZkValidityProofResponse | null>(null);
  const [verifyResult, setVerifyResult] =
    useState<ZkValidityVerifyResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingAction, setLoadingAction] = useState<"prove" | "verify" | null>(
    null
  );

  const voteVectorPreview = useMemo(() => {
    try {
      return parseVoteVectorInput(voteVectorText);
    } catch {
      return null;
    }
  }, [voteVectorText]);

  function applyPreset(voteVector: number[]) {
    setCandidateCount(String(voteVector.length));
    setVoteVectorText(`[${voteVector.join(",")}]`);
    setProofResult(null);
    setVerifyResult(null);
    setNotice(null);
  }

  async function handleProve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setProofResult(null);
    setVerifyResult(null);

    const trimmedElectionId = electionId.trim();
    const parsedCandidateCount = Number(candidateCount);

    if (!trimmedElectionId) {
      setNotice({ type: "error", text: "请输入 electionId" });
      return;
    }

    if (!Number.isInteger(parsedCandidateCount) || parsedCandidateCount <= 0) {
      setNotice({ type: "error", text: "candidateCount 必须是正整数" });
      return;
    }

    try {
      setLoadingAction("prove");
      const body: ZkProofModeRequest = {
        electionId: trimmedElectionId,
        voteVector: parseVoteVectorInput(voteVectorText),
        candidateCount: parsedCandidateCount,
        proofMode
      };
      const data = await apiRequest<ZkValidityProofResponse>(
        "/zk/prove-vote-validity",
        {
          method: "POST",
          body
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
      setLoadingAction(null);
    }
  }

  async function handleVerify() {
    setNotice(null);
    setVerifyResult(null);

    if (!proofResult) {
      setNotice({ type: "error", text: "请先生成 ZK 合法性证明" });
      return;
    }

    try {
      setLoadingAction("verify");
      const body: ZkValidityVerifyRequest = {
        proof: proofResult.proof,
        publicSignals: proofResult.publicSignals,
        proofMode: proofResult.proofMode
      };
      const data = await apiRequest<ZkValidityVerifyResponse>(
        "/zk/verify-vote-validity",
        {
          method: "POST",
          body
        }
      );

      setVerifyResult(data);
      setNotice({
        type: data.verified ? "success" : "error",
        text: data.message
      });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">ZK Validity</p>
          <h1>ZK 验证</h1>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel attack-warning">
        <strong>one-hot 合法性证明 demo</strong>
        <p>
          当前 ZK 模块用于证明 voteVector 是合法 one-hot 向量，即只选择一名候选人。后续可扩展为真实
          Circom/snarkjs proof，并接入完整计票正确性证明。
        </p>
      </div>

      <form className="panel form" onSubmit={handleProve}>
        <label>
          proofMode
          <select
            value={proofMode}
            onChange={(event) => {
              setProofMode(event.target.value as ZkProofMode);
              setProofResult(null);
              setVerifyResult(null);
              setNotice(null);
            }}
          >
            <option value="mock">Mock ZK Validity Proof</option>
            <option value="real">Real Groth16 ZK Proof</option>
          </select>
        </label>

        <div className="two-column">
          <label>
            electionId
            <input
              value={electionId}
              onChange={(event) => setElectionId(event.target.value)}
              placeholder="election_1"
            />
          </label>
          <label>
            candidateCount
            <input
              type="number"
              min="1"
              step="1"
              value={candidateCount}
              onChange={(event) => setCandidateCount(event.target.value)}
            />
          </label>
        </div>

        <label>
          voteVector
          <textarea
            value={voteVectorText}
            onChange={(event) => {
              setVoteVectorText(event.target.value);
              setProofResult(null);
              setVerifyResult(null);
            }}
            rows={3}
            placeholder="[1,0,0,0]"
          />
        </label>

        <div className="button-row">
          {zkVotePresets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="secondary"
              onClick={() => applyPreset(preset.voteVector)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="hash-list">
          <div>
            <span>proofMode</span>
            <code className="hash-value">{getZkProofModeLabel(proofMode)}</code>
          </div>
          <div>
            <span>当前 voteVector</span>
            <code className="hash-value">
              {voteVectorPreview ? `[${voteVectorPreview.join(", ")}]` : "格式无效"}
            </code>
          </div>
        </div>

        <div className="button-row">
          <button type="submit" disabled={loadingAction !== null}>
            {loadingAction === "prove" ? "生成中..." : "生成 ZK 合法性证明"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleVerify()}
            disabled={!proofResult || loadingAction !== null}
          >
            {loadingAction === "verify" ? "验证中..." : "验证证明"}
          </button>
        </div>
      </form>

      {proofResult ? (
        <div className="panel receipt-panel">
          <div className="verification-heading">
            <h2>proof result</h2>
            <span className={proofResult.valid ? "status-pill ok" : "status-pill bad"}>
              valid = {proofResult.valid ? "true" : "false"}
            </span>
          </div>

          <div className="hash-list">
            <div>
              <span>proofId</span>
              <code className="hash-value">{proofResult.proofId}</code>
            </div>
            <div>
              <span>proofMode</span>
              <code className="hash-value">
                {getZkProofModeLabel(proofResult.proofMode)}
              </code>
            </div>
            <div>
              <span>message</span>
              <code className="hash-value">{proofResult.message}</code>
            </div>
          </div>

          <div className="two-column">
            <div>
              <h2>publicSignals</h2>
              <pre>{formatJson(proofResult.publicSignals)}</pre>
            </div>
            <div>
              <h2>proof</h2>
              <pre>{formatJson(proofResult.proof)}</pre>
            </div>
          </div>
        </div>
      ) : null}

      {verifyResult ? (
        <div className="panel receipt-panel">
          <div className="verification-heading">
            <h2>verify result</h2>
            <span className={verifyResult.verified ? "status-pill ok" : "status-pill bad"}>
              verified = {verifyResult.verified ? "true" : "false"}
            </span>
          </div>
          <div className="hash-list">
            <div>
              <span>proofMode</span>
              <code className="hash-value">
                {getZkProofModeLabel(verifyResult.proofMode)}
              </code>
            </div>
            <div>
              <span>verify message</span>
              <code className="hash-value">{verifyResult.message}</code>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
