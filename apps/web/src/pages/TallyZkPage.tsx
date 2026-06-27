import { useEffect, useState } from "react";
import type {
  BlockchainAuditRecord,
  Election,
  SubmitBlockchainAuditWithTallyProofResponse,
  TallyProofResponseShared,
  TallyVerifyResponseShared
} from "@verivote/shared";
import {
  apiRequest,
  formatJson,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  type Notice
} from "../common";

const TALLY_BATCH = 8;
const TALLY_CANDS = 4;

type ProofSource = "election" | "fixture";

function createBalancedBatch(): number[][] {
  return Array.from({ length: TALLY_BATCH }, (_, i) =>
    Array.from({ length: TALLY_CANDS }, (_, j) => (i % TALLY_CANDS === j ? 1 : 0))
  );
}

function columnSums(matrix: number[][]): number[] {
  const sums = new Array(TALLY_CANDS).fill(0);
  for (const row of matrix) {
    for (let j = 0; j < TALLY_CANDS; j += 1) {
      sums[j] += row[j] ?? 0;
    }
  }
  return sums;
}

function AuditSummary({ audit }: { audit: BlockchainAuditRecord }) {
  const rows = [
    ["zkVerified", String(Boolean(audit.zkVerified))],
    ["auditMode", audit.auditMode],
    ["status", audit.status],
    ["transactionHash", audit.transactionHash],
    ["contractAddress", audit.contractAddress],
    ["tallyHash", audit.tallyHash],
    ["commitmentRoot", audit.commitmentRoot]
  ];

  return (
    <div className="hash-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <code className="hash-value">{value}</code>
        </div>
      ))}
    </div>
  );
}

export function TallyZkPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [proofSource, setProofSource] = useState<ProofSource>("election");
  const [matrixText, setMatrixText] = useState(JSON.stringify(createBalancedBatch()));
  const [tallyText, setTallyText] = useState(
    JSON.stringify(columnSums(createBalancedBatch()))
  );
  const [proofResult, setProofResult] = useState<TallyProofResponseShared | null>(null);
  const [verifyResult, setVerifyResult] = useState<TallyVerifyResponseShared | null>(null);
  const [audit, setAudit] = useState<BlockchainAuditRecord | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingAction, setLoadingAction] = useState<
    "election-proof" | "fixture-proof" | "verify" | "submit" | null
  >(null);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  function resetResults() {
    setProofResult(null);
    setVerifyResult(null);
    setAudit(null);
  }

  function loadSamplePreset(preset: "valid" | "invalid-tally") {
    const batch = createBalancedBatch();
    const sums = columnSums(batch);
    if (preset === "invalid-tally") {
      sums[0] += 1;
      sums[1] -= 1;
    }
    setMatrixText(JSON.stringify(batch));
    setTallyText(JSON.stringify(sums));
    setProofSource("fixture");
    resetResults();
    setNotice(null);
  }

  async function handleGenerateFromElection() {
    setNotice(null);
    resetResults();
    if (!electionId) {
      setNotice({ type: "error", text: "Select an election first." });
      return;
    }

    try {
      setLoadingAction("election-proof");
      const data = await apiRequest<TallyProofResponseShared>(
        `/zk/elections/${encodeURIComponent(electionId)}/prove-tally-correctness`,
        {
          method: "POST",
          body: { proofMode: "real" }
        }
      );
      setProofSource("election");
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

  async function handleGenerateFixtureProof() {
    setNotice(null);
    resetResults();
    if (!electionId) {
      setNotice({ type: "error", text: "Select an election first." });
      return;
    }

    let voteVectors: number[][];
    let tally: number[];
    try {
      voteVectors = JSON.parse(matrixText) as number[][];
      tally = JSON.parse(tallyText) as number[];
    } catch {
      setNotice({ type: "error", text: "voteVectors and tally must be valid JSON arrays." });
      return;
    }

    try {
      setLoadingAction("fixture-proof");
      const data = await apiRequest<TallyProofResponseShared>(
        "/zk/prove-tally-correctness",
        {
          method: "POST",
          body: {
            electionId,
            voteVectors,
            tally,
            proofMode: "real"
          }
        }
      );
      setProofSource("fixture");
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

  async function handleVerifyProof() {
    if (!proofResult) {
      setNotice({ type: "error", text: "Generate a tally proof first." });
      return;
    }

    setNotice(null);
    setVerifyResult(null);
    try {
      setLoadingAction("verify");
      const data = await apiRequest<TallyVerifyResponseShared>(
        "/zk/verify-tally-correctness",
        {
          method: "POST",
          body: {
            proof: proofResult.proof,
            publicSignals: proofResult.publicSignals
          }
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

  async function handleSubmitWithProof() {
    if (!electionId || !proofResult) {
      setNotice({ type: "error", text: "Generate a tally proof first." });
      return;
    }

    setNotice(null);
    setAudit(null);
    try {
      setLoadingAction("submit");
      const data = await apiRequest<SubmitBlockchainAuditWithTallyProofResponse>(
        `/blockchain/elections/${encodeURIComponent(electionId)}/submit-audit-with-tally-proof`,
        {
          method: "POST",
          body: { tallyProofResponse: proofResult }
        }
      );
      setAudit(data.audit);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingAction(null);
    }
  }

  const canSubmit =
    proofSource === "election" &&
    Boolean(proofResult?.valid) &&
    loadingAction === null;

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Task B web flow</p>
          <h1>Tally ZK + on-chain verifier</h1>
        </div>
      </div>

      <p className="page-lead">
        Use the selected election to generate a real Groth16 tally proof from the
        aggregator report, verify it locally, then submit it through
        submitAuditWithTallyProof. The fixed 8x4 fixture remains available only
        for B-05/B-06 proof behavior checks.
      </p>

      <NoticeMessage notice={notice} />

      <div className="panel form">
        <label>
          Election
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={(value) => {
              setElectionId(value);
              resetResults();
            }}
          />
        </label>

        <div className="button-row">
          <button
            type="button"
            onClick={() => void handleGenerateFromElection()}
            disabled={!electionId || loadingAction !== null}
          >
            {loadingAction === "election-proof"
              ? "Generating..."
              : "Generate proof from election"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleVerifyProof()}
            disabled={!proofResult || loadingAction !== null}
          >
            {loadingAction === "verify" ? "Verifying..." : "Local verify proof"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleSubmitWithProof()}
            disabled={!canSubmit}
            title={
              proofSource === "fixture"
                ? "Fixture proofs are not report-bound. Generate from election before submitting."
                : undefined
            }
          >
            {loadingAction === "submit"
              ? "Submitting..."
              : "Submit with tally proof"}
          </button>
        </div>
      </div>

      <div className="panel form">
        <div className="verification-heading">
          <h2>Fixed 8x4 fixture</h2>
          <span className="status-pill">proof sample only</span>
        </div>
        <p className="muted">
          This path is useful for valid/invalid fixture testing. It is disabled
          for chain submission because the complete B flow must bind the proof
          to the current aggregator report.
        </p>
        <div className="inline-list">
          <button
            type="button"
            className="secondary"
            onClick={() => loadSamplePreset("valid")}
            disabled={loadingAction !== null}
          >
            Load valid 8x4
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => loadSamplePreset("invalid-tally")}
            disabled={loadingAction !== null}
          >
            Load tampered tally
          </button>
        </div>
        <label>
          voteVectors JSON
          <textarea
            rows={6}
            value={matrixText}
            onChange={(event) => setMatrixText(event.target.value)}
          />
        </label>
        <label>
          tally JSON
          <input value={tallyText} onChange={(event) => setTallyText(event.target.value)} />
        </label>
        <button
          type="button"
          className="secondary"
          onClick={() => void handleGenerateFixtureProof()}
          disabled={!electionId || loadingAction !== null}
        >
          {loadingAction === "fixture-proof" ? "Generating..." : "Generate fixture proof"}
        </button>
      </div>

      {proofResult ? (
        <div className="panel">
          <div className="verification-heading">
            <h2>Proof result</h2>
            <span className={proofResult.valid ? "status-pill ok" : "status-pill bad"}>
              {proofResult.valid ? "valid" : "invalid"}
            </span>
          </div>
          <div className="hash-list">
            <div>
              <span>source</span>
              <code className="hash-value">{proofSource}</code>
            </div>
            <div>
              <span>proofMode / verifierMode</span>
              <code className="hash-value">
                {proofResult.proofMode} / {proofResult.verifierMode}
              </code>
            </div>
            <div>
              <span>proofHash</span>
              <code className="hash-value">{proofResult.proofHash}</code>
            </div>
            <div>
              <span>circuitId</span>
              <code className="hash-value">{proofResult.circuitId}</code>
            </div>
            <div>
              <span>tally</span>
              <code className="hash-value">
                [{proofResult.publicSignals.tally.join(", ")}]
              </code>
            </div>
            <div>
              <span>batchSize / validVoteCount</span>
              <code className="hash-value">
                {proofResult.publicSignals.batchSize} /{" "}
                {proofResult.publicSignals.validVoteCount}
              </code>
            </div>
            <div>
              <span>tallyHash</span>
              <code className="hash-value">{proofResult.publicSignals.tallyHash}</code>
            </div>
            <div>
              <span>commitmentRoot</span>
              <code className="hash-value">
                {proofResult.publicSignals.commitmentRoot}
              </code>
            </div>
            <div>
              <span>partitionHash</span>
              <code className="hash-value">
                {proofResult.publicSignals.partitionHash}
              </code>
            </div>
          </div>
        </div>
      ) : null}

      {verifyResult ? (
        <div className="panel">
          <div className="verification-heading">
            <h2>Local Groth16 verification</h2>
            <span className={verifyResult.verified ? "status-pill ok" : "status-pill bad"}>
              {String(verifyResult.verified)}
            </span>
          </div>
          <p>{verifyResult.message}</p>
        </div>
      ) : null}

      {audit ? (
        <div className="panel receipt-panel">
          <div className="verification-heading">
            <h2>Chain audit result</h2>
            <span className="status-pill ok">submitted</span>
          </div>
          <AuditSummary audit={audit} />
        </div>
      ) : null}

      {proofResult ? (
        <details className="panel">
          <summary>Raw proof response</summary>
          <pre>{formatJson(proofResult)}</pre>
        </details>
      ) : null}
    </section>
  );
}
