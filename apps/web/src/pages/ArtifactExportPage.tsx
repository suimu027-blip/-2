import { useEffect, useMemo, useState } from "react";
import type { Election, ApiErrorResponse, ElectionExportBundle } from "@verivote/shared";
import {
  API_BASE_URL,
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  formatJson,
  type Notice
} from "../common";
import { demoExportBundleV2Sample } from "../data/demo-fixtures";

const exportArtifactDescriptors: Array<{
  file: string;
  label: string;
  path: (electionId: string) => string;
}> = [
  {
    file: "bulletin_board.json",
    label: "Bulletin board and Merkle leaves",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/bulletin_board.json`
  },
  {
    file: "aggregator_report.json",
    label: "Aggregator report and diagnostics",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/aggregator_report.json`
  },
  {
    file: "zk_summary.json",
    label: "ZK summary",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/zk_summary.json`
  },
  {
    file: "chain_audit.json",
    label: "Chain audit summary",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/chain_audit.json`
  },
  {
    file: "public_inputs.json",
    label: "Public inputs",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/public_inputs.json`
  }
];

function downloadJson(filename: string, value: unknown) {
  const text = JSON.stringify(value, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return text;
}

function getChecklist(bundle: ElectionExportBundle | null) {
  return [
    {
      label: "receipt included",
      status: bundle?.bulletinBoard?.receiptChainVerified === true
    },
    {
      label: "partition OK",
      status: bundle?.aggregatorReport?.partitionAudit?.coverComplete === true
    },
    {
      label: "Pedersen OK",
      status: bundle?.aggregatorReport?.pedersenAggregateAudit?.verified === true
    },
    {
      label: "ZK verified",
      status: bundle?.chainAudit.zkVerified === true || bundle?.tallyProofSummary?.valid === true
    },
    {
      label: "chain matched",
      status: bundle?.chainAudit.status === "submitted" || bundle?.chainAudit.hasAudit === true
    }
  ];
}

export function ArtifactExportPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ElectionExportBundle | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [sampleMode, setSampleMode] = useState(false);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  const checklist = useMemo(() => getChecklist(bundle), [bundle]);

  async function downloadArtifact(path: string, filename: string) {
    setNotice(null);
    setSampleMode(false);

    try {
      const response = await fetch(`${API_BASE_URL}${path}`);
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | ApiErrorResponse
          | null;
        throw new Error(errorPayload?.error ?? `Request failed (${response.status})`);
      }
      const text = await response.text();
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPreviewTitle(filename);
      try {
        setPreview(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setPreview(text);
      }
      setNotice({ type: "success", text: `${filename} downloaded.` });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  async function downloadBundle() {
    if (!electionId) {
      setNotice({ type: "error", text: "Select an election first." });
      return;
    }
    setLoadingBundle(true);
    setNotice(null);
    setSampleMode(false);

    try {
      const data = await apiRequest<{ bundle: ElectionExportBundle }>(
        `/elections/${encodeURIComponent(electionId)}/export-bundle`
      );
      const filename = `verivote_bundle_${electionId}.json`;
      const text = downloadJson(filename, data.bundle);
      setBundle(data.bundle);
      setPreviewTitle(filename);
      setPreview(text);
      setNotice({ type: "success", text: `${filename} downloaded.` });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingBundle(false);
    }
  }

  function loadSampleBundle() {
    const sample = demoExportBundleV2Sample as ElectionExportBundle;
    setBundle(sample);
    setPreviewTitle("export_bundle_v2.sample.json");
    setPreview(formatJson(sample));
    setSampleMode(true);
    setNotice({ type: "success", text: "Loaded export bundle v2 sample." });
  }

  function downloadSampleBundle() {
    const filename = "export_bundle_v2.sample.json";
    const text = downloadJson(filename, demoExportBundleV2Sample);
    setBundle(demoExportBundleV2Sample as ElectionExportBundle);
    setPreviewTitle(filename);
    setPreview(text);
    setSampleMode(true);
    setNotice({ type: "success", text: `${filename} downloaded.` });
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Artifact</p>
          <h1>Export Bundle</h1>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={loadSampleBundle}>
            Preview v2 sample
          </button>
          <button type="button" className="secondary" onClick={downloadSampleBundle}>
            Download sample
          </button>
        </div>
      </div>
      <p className="page-lead">
        ExportBundle v2 is the handoff artifact for reports, screenshots, and offline checks.
        Missing A/B/C fields are rendered as null or pending instead of blocking the demo.
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
              setBundle(null);
              setPreview(null);
              setSampleMode(false);
            }}
          />
        </label>
        <div className="inline-list">
          {exportArtifactDescriptors.map((descriptor) => (
            <button
              key={descriptor.file}
              type="button"
              className="secondary"
              disabled={!electionId}
              onClick={() =>
                void downloadArtifact(
                  descriptor.path(electionId),
                  `${electionId}_${descriptor.file}`
                )
              }
            >
              {descriptor.file}
            </button>
          ))}
          <button
            type="button"
            disabled={!electionId || loadingBundle}
            onClick={() => void downloadBundle()}
          >
            {loadingBundle ? "Bundling..." : "Download bundle v2"}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="verification-heading">
          <h2>Security checklist</h2>
          <span className={checklist.every((item) => item.status) ? "status-pill ok" : "status-pill bad"}>
            {sampleMode ? "sample" : "current"}
          </span>
        </div>
        <div className="checklist-grid">
          {checklist.map((item) => (
            <span key={item.label}>
              {item.status ? "ok" : "pending"} {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>bundle envelope</h2>
        <div className="hash-list">
          <div>
            <span>schemaVersion</span>
            <code className="hash-value">
              {bundle?.envelope.schemaVersion ?? "verivote.artifact.v2"}
            </code>
          </div>
          <div>
            <span>bundleHash</span>
            <code className="hash-value">{bundle?.envelope.bundleHash ?? "pending"}</code>
          </div>
          <div>
            <span>partitionHash</span>
            <code className="hash-value">
              {bundle?.publicInputs.partitionHash ?? "pending"}
            </code>
          </div>
          <div>
            <span>verifierMode</span>
            <code className="hash-value">
              {bundle?.chainAudit.verifierMode ?? bundle?.zkSummary.verifierMode ?? "pending"}
            </code>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>file map</h2>
        <ul className="compact-list">
          {exportArtifactDescriptors.map((descriptor) => (
            <li key={descriptor.file}>
              <code>{descriptor.file}</code> - {descriptor.label}
            </li>
          ))}
          <li>
            <code>export_bundle_v2.sample.json</code> - full D handoff fixture under docs/contracts.
          </li>
        </ul>
      </div>

      {preview ? (
        <div className="panel">
          <div className="verification-heading">
            <h2>preview: {previewTitle}</h2>
          </div>
          <pre className="preview-block">{preview}</pre>
        </div>
      ) : null}
    </section>
  );
}
