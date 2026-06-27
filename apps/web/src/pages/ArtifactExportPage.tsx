import { useEffect, useState } from "react";
import type { Election, ApiErrorResponse } from "@verivote/shared";
import {
  API_BASE_URL,
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  type Notice
} from "../common";

const exportArtifactDescriptors: Array<{
  file: string;
  label: string;
  path: (electionId: string) => string;
}> = [
  {
    file: "bulletin_board.json",
    label: "公告板 / Merkle leaves",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/bulletin_board.json`
  },
  {
    file: "aggregator_report.json",
    label: "聚合器审计报告",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/aggregator_report.json`
  },
  {
    file: "zk_summary.json",
    label: "ZK 摘要",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/zk_summary.json`
  },
  {
    file: "chain_audit.json",
    label: "链上审计摘要",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/chain_audit.json`
  },
  {
    file: "public_inputs.json",
    label: "公共输入",
    path: (id) => `/elections/${encodeURIComponent(id)}/export/public_inputs.json`
  }
];

export function ArtifactExportPage({ elections }: { elections: Election[] }) {
  const [electionId, setElectionId] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingBundle, setLoadingBundle] = useState(false);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  async function downloadArtifact(path: string, filename: string) {
    setNotice(null);
    try {
      const response = await fetch(`${API_BASE_URL}${path}`);
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | ApiErrorResponse
          | null;
        throw new Error(errorPayload?.error ?? `请求失败 (${response.status})`);
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
      setNotice({ type: "success", text: `${filename} 已下载并预览。` });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  async function downloadBundle() {
    if (!electionId) {
      setNotice({ type: "error", text: "请先选择 election" });
      return;
    }
    setLoadingBundle(true);
    setNotice(null);
    try {
      const data = await apiRequest<{ bundle: unknown }>(
        `/elections/${encodeURIComponent(electionId)}/export-bundle`
      );
      const text = JSON.stringify(data.bundle, null, 2);
      const filename = `verivote_bundle_${electionId}.json`;
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
      setPreview(text);
      setNotice({ type: "success", text: `${filename} 已下载并预览。` });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingBundle(false);
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Artifact</p>
          <h1>审计材料导出</h1>
        </div>
      </div>
      <p className="page-lead">
        Zeeperio 风格的 artifact export。按文件独立下载，也可以一次性下载合并 bundle。
        所有文件都包含当前选举的公开审计信息，可交给外部验证器复查。
      </p>

      <NoticeMessage notice={notice} />

      <div className="panel form">
        <label>
          选择选举
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={setElectionId}
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
              下载 {descriptor.file}
            </button>
          ))}
          <button
            type="button"
            disabled={!electionId || loadingBundle}
            onClick={() => void downloadBundle()}
          >
            {loadingBundle ? "打包中..." : "下载合并 bundle.json"}
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>文件说明</h2>
        <ul>
          {exportArtifactDescriptors.map((descriptor) => (
            <li key={descriptor.file}>
              <code>{descriptor.file}</code> — {descriptor.label}
            </li>
          ))}
        </ul>
      </div>

      {preview ? (
        <div className="panel">
          <div className="verification-heading">
            <h2>预览：{previewTitle}</h2>
          </div>
          <pre
            className="hash-value"
            style={{ whiteSpace: "pre-wrap", maxHeight: "32rem", overflow: "auto" }}
          >
            {preview}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
