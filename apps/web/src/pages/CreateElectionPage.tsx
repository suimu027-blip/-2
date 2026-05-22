import { type FormEvent, useEffect, useState } from "react";
import type {
  Election,
  ElectionDetail,
  CreateElectionRequest,
  CreateElectionResponse,
  CreateCandidateRequest,
  CreateCandidateResponse,
  GetElectionResponse
} from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  type Notice
} from "../common";

interface CreateElectionPageProps {
  elections: Election[];
  onRefreshElections: () => Promise<void>;
}

export function CreateElectionPage({
  elections,
  onRefreshElections
}: CreateElectionPageProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [candidateElectionId, setCandidateElectionId] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [candidateDetail, setCandidateDetail] = useState<ElectionDetail | null>(
    null
  );
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!candidateElectionId && elections.length > 0) {
      setCandidateElectionId(elections[0].id);
    }
  }, [candidateElectionId, elections]);

  useEffect(() => {
    let ignore = false;

    async function loadCandidates() {
      if (!candidateElectionId) {
        setCandidateDetail(null);
        return;
      }

      try {
        const data = await apiRequest<GetElectionResponse>(
          `/elections/${candidateElectionId}`
        );

        if (!ignore) {
          setCandidateDetail(data.election);
        }
      } catch (error) {
        if (!ignore) {
          setNotice({ type: "error", text: getErrorMessage(error) });
          setCandidateDetail(null);
        }
      }
    }

    void loadCandidates();

    return () => {
      ignore = true;
    };
  }, [candidateElectionId]);

  async function handleCreateElection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    try {
      const body: CreateElectionRequest = { title, description };
      const data = await apiRequest<CreateElectionResponse>("/elections", {
        method: "POST",
        body
      });

      setTitle("");
      setDescription("");
      setCandidateElectionId(data.election.id);
      await onRefreshElections();
      setNotice({
        type: "success",
        text: `已创建投票 ${data.election.id}`
      });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  async function handleAddCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    if (!candidateElectionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      const body: CreateCandidateRequest = { name: candidateName };
      const data = await apiRequest<CreateCandidateResponse>(
        `/elections/${candidateElectionId}/candidates`,
        {
          method: "POST",
          body
        }
      );
      const detail = await apiRequest<GetElectionResponse>(
        `/elections/${candidateElectionId}`
      );

      setCandidateName("");
      setCandidateDetail(detail.election);
      setNotice({
        type: "success",
        text: `已添加候选人 ${data.candidate.id}`
      });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Election</p>
          <h1>创建投票</h1>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <div className="two-column">
        <form className="panel form" onSubmit={handleCreateElection}>
          <h2>新投票</h2>
          <label>
            标题
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：最佳项目提案"
            />
          </label>
          <label>
            描述
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="补充投票背景"
              rows={4}
            />
          </label>
          <button type="submit">创建</button>
        </form>

        <form className="panel form" onSubmit={handleAddCandidate}>
          <h2>候选人管理</h2>
          <label>
            投票
            <ElectionSelect
              elections={elections}
              value={candidateElectionId}
              onChange={setCandidateElectionId}
            />
          </label>
          <label>
            候选人名称
            <input
              value={candidateName}
              onChange={(event) => setCandidateName(event.target.value)}
              placeholder="例如：方案 A"
            />
          </label>
          <button type="submit" disabled={!candidateElectionId}>
            添加候选人
          </button>

          <div className="inline-list">
            {(candidateDetail?.candidates ?? []).map((candidate) => (
              <span key={candidate.id}>
                {candidate.name} <code>{candidate.id}</code>
              </span>
            ))}
          </div>
        </form>
      </div>
    </section>
  );
}
