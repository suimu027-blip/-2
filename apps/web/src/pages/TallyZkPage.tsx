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
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  formatJson,
  type Notice
} from "../common";
import { demoTallyProofV2Sample } from "../data/demo-fixtures";

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
    for (let j = 0; j < TALLY_CANDS; j += 1) {
      sums[j] += row[j];
    }
  }
  return sums;
}

export function TallyZkPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [matrixText, setMatrixText] = useState(
    JSON.stringify(createBalancedBatch(), null, 2)
  );
  const [tallyText, setTallyText] = useState(
    JSON.stringify(columnSums(createBalancedBatch()))
  );
  const [proofResult, setProofResult] = useState<TallyProofResponseShared | null>(null);
  const [verifyResult, setVerifyResult] = useState<TallyVerifyResponseShared | null>(null);
  const [audit, setAudit] = useState<BlockchainAuditRecord | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingProof, setLoadingProof] = useState(false);
  const [loadingElectionProof, setLoadingElectionProof] = useState(false);
  const [loadingVerify, setLoadingVerify] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [sampleMode, setSampleMode] = useState(false);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  function loadSamplePreset(preset: "valid" | "invalid-tally") {
    const batch = createBalancedBatch();
    const sums = columnSums(batch);
    if (preset === "invalid-tally") {
      sums[0] += 1;
      sums[1] -= 1;
    }
    setMatrixText(JSON.stringify(batch, null, 2));
    setTallyText(JSON.stringify(sums));
    setProofResult(null);
    setVerifyResult(null);
    setAudit(null);
    setSampleMode(false);
    setNotice(null);
  }

  function loadSampleProof() {
    setProofResult(demoTallyProofV2Sample as TallyProofResponseShared);
    setVerifyResult(null);
    setAudit(null);
    setSampleMode(true);
    setNotice({ type: "success", text: "Loaded TallyProof v2 sample." });
  }

  async function handleGenerateFromElection() {
    setNotice(null);
    setProofResult(null);
    setVerifyResult(null);
    setAudit(null);
    setSampleMode(false);

    if (!electionId) {
      setNotice({ type: "error", text: "Select an election first." });
      return;
    }

    setLoadingElectionProof(true);
    try {
      const data = await apiRequest<TallyProofResponseShared>(
        `/zk/elections/${encodeURIComponent(electionId)}/prove-tally-correctness`,
        {
          method: "POST",
          body: { proofMode: "real" }
        }
      );
      setProofResult(data);
      setNotice({ type: data.valid ? "success" : "error", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingElectionProof(false);
    }
  }

  async function handleGenerate() {
    setNotice(null);
    setProofResult(null);
    setVerifyResult(null);
    setAudit(null);
    setSampleMode(false);

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
      setNotice({ type: "error", text: "voteVectors and tally must be JSON arrays." });
      return;
    }

    setLoadingProof(true);
    try {
      const data = await apiRequest<TallyProofResponseShared>(
        "/zk/prove-tally-correctness",
        {
          method: "POST",
          body: { electionId, voteVectors, tally, proofMode: "real" }
        }
      );
      setProofResult(data);
      setNotice({ type: data.valid ? "success" : "error", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingProof(false);
    }
  }

  async function handleVerifyProof() {
    if (!proofResult) {
      setNotice({ type: "error", text: "Generate or load a tally proof first." });
      return;
    }

    setNotice(null);
    setVerifyResult(null);
    setLoadingVerify(true);
    try {
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
      setNotice({ type: data.verified ? "success" : "error", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingVerify(false);
    }
  }

  async function handleSubmitWithProof() {
    if (!electionId || !proofResult) {
      setNotice({ type: "error", text: "Generate or load a tally proof first." });
      return;
    }

    setAudit(null);
    setLoadingSubmit(true);
    try {
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
      setLoadingSubmit(false);
    }
  }

  const canSubmit =
    Boolean(proofResult?.valid) &&
    !sampleMode &&
    Boolean(proofResult?.proofHash) &&
    Boolean(proofResult?.verifierMode) &&
    !loadingSubmit;

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Tally ZK</p>
          <h1>Tally Correctness</h1>
        </div>
      </div>
      <p className="page-lead">
        This page renders the B-line TallyProof v2 contract. Use the election-bound
        path for the full ZK + report binding + chain verifier flow, or load samples
        for D-side display checks.
      </p>

      <NoticeMessage notice={notice} />

      <div className="panel form">
        <div className="two-column">
          <label>
            Election
            <ElectionSelect
              elections={elections}
              value={electionId}
              onChange={setElectionId}
            />
          </label>
          <div className="inline-list align-end">
            <button
              type="button"
              className="secondary"
              onClick={() => loadSamplePreset("valid")}
            >
              Valid 8x4 batch
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => loadSamplePreset("invalid-tally")}
            >
              Tampered tally
            </button>
            <button type="button" className="secondary" onClick={loadSampleProof}>
              Load v2 sample proof
            </button>
          </div>
        </div>

        <div className="inline-list">
          <button
            type="button"
            onClick={() => void handleGenerateFromElection()}
            disabled={!electionId || loadingElectionProof}
          >
            {loadingElectionProof ? "Generating..." : "Generate proof from election/report"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleVerifyProof()}
            disabled={!proofResult || loadingVerify}
          >
            {loadingVerify ? "Verifying..." : "Local verify proof"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleSubmitWithProof()}
            disabled={!canSubmit}
          >
            {loadingSubmit ? "Submitting..." : "Submit with report-bound proof"}
          </button>
        </div>

        <p className="receipt-note">
          The buttons below are fixture helpers. They are useful for sample rendering and invalid-proof checks,
          but only the election/report-generated proof is accepted as complete Task B evidence.
        </p>

        <label>
          voteVectors JSON
          <textarea
            rows={8}
            value={matrixText}
            onChange={(event) => setMatrixText(event.target.value)}
          />
        </label>

        <label>
          tally JSON
          <input value={tallyText} onChange={(event) => setTallyText(event.target.value)} />
        </label>

        <div className="inline-list">
          <button type="button" onClick={() => void handleGenerate()} disabled={loadingProof}>
            {loadingProof ? "Generating..." : "Generate fixture proof"}
          </button>
        </div>
      </div>

      {proofResult ? (
        <div className="panel">
          <div className="verification-heading">
            <h2>proof overview</h2>
            <span className={proofResult.valid ? "status-pill ok" : "status-pill bad"}>
              {proofResult.valid ? "valid" : "invalid"}
            </span>
          </div>
          {sampleMode ? (
            <p className="receipt-note">
              Fixture mode: the submit button is disabled to avoid sending sample calldata as real chain evidence.
            </p>
          ) : null}
          <div className="hash-list">
            <div>
              <span>proofId</span>
              <code className="hash-value">{proofResult.proofId}</code>
            </div>
            <div>
              <span>proofMode</span>
              <code className="hash-value">{proofResult.proofMode ?? "mock"}</code>
            </div>
            <div>
              <span>verifierMode</span>
              <code className="hash-value">{proofResult.verifierMode ?? "pending"}</code>
            </div>
            <div>
              <span>circuitId</span>
              <code className="hash-value">
                {proofResult.circuitId ?? proofResult.publicSignals.circuitId}
              </code>
            </div>
            <div>
              <span>proofHash</span>
              <code className="hash-value">{proofResult.proofHash ?? "pending"}</code>
            </div>
            <div>
              <span>tally</span>
              <code className="hash-value">
                [{proofResult.publicSignals.tally.join(", ")}]
              </code>
            </div>
            <div>
              <span>batchSize</span>
              <code className="hash-value">{proofResult.publicSignals.batchSize}</code>
            </div>
            <div>
              <span>validVoteCount</span>
              <code className="hash-value">
                {proofResult.publicSignals.validVoteCount ?? "pending"}
              </code>
            </div>
            <div>
              <span>tallyHash</span>
              <code className="hash-value">
                {proofResult.publicSignals.tallyHash ?? "pending"}
              </code>
            </div>
            <div>
              <span>commitmentRoot</span>
              <code className="hash-value">
                {proofResult.publicSignals.commitmentRoot ?? "pending"}
              </code>
            </div>
            <div>
              <span>partitionHash</span>
              <code className="hash-value">
                {proofResult.publicSignals.partitionHash ?? "pending"}
              </code>
            </div>
          </div>
          <pre>{formatJson(proofResult.publicSignals)}</pre>
        </div>
      ) : null}

      {verifyResult ? (
        <div className="panel">
          <div className="verification-heading">
            <h2>local Groth16 verification</h2>
            <span className={verifyResult.verified ? "status-pill ok" : "status-pill bad"}>
              {String(verifyResult.verified)}
            </span>
          </div>
          <p>{verifyResult.message}</p>
        </div>
      ) : null}

      {audit ? (
        <div className="panel receipt-panel">
          <h2>chain submit result</h2>
          <div className="hash-list">
            <div>
              <span>zkVerified</span>
              <code className="hash-value">{String(Boolean(audit.zkVerified))}</code>
            </div>
            <div>
              <span>auditMode</span>
              <code className="hash-value">{audit.auditMode}</code>
            </div>
            <div>
              <span>verifierMode</span>
              <code className="hash-value">{audit.verifierMode ?? "pending"}</code>
            </div>
            <div>
              <span>gasUsed</span>
              <code className="hash-value">{audit.gasUsed ?? "pending"}</code>
            </div>
            <div>
              <span>transactionHash</span>
              <code className="hash-value">{audit.transactionHash}</code>
            </div>
            <div>
              <span>contractAddress</span>
              <code className="hash-value">{audit.contractAddress}</code>
            </div>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <h2>status model</h2>
        <div className="checklist-grid">
          <span>{proofResult ? "ok" : "pending"} proof generated</span>
          <span>{proofResult?.proofHash ? "ok" : "pending"} proofHash</span>
          <span>{proofResult?.verifierMode ?? "pending"} verifierMode</span>
          <span>{audit ? "ok" : "pending"} chain matched</span>
        </div>
      </div>
    </section>
  );
}
