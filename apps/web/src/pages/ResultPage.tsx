import { useEffect, useState } from "react";
import type { Election, GetElectionResultResponse } from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  type Notice
} from "../common";

interface ResultPageProps {
  elections: Election[];
}

export function ResultPage({ elections }: ResultPageProps) {
  const [electionId, setElectionId] = useState("");
  const [result, setResult] = useState<GetElectionResultResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  useEffect(() => {
    let ignore = false;

    async function loadResult() {
      if (!electionId) {
        setResult(null);
        return;
      }

      try {
        const data = await apiRequest<GetElectionResultResponse>(
          `/elections/${electionId}/result`
        );

        if (!ignore) {
          setResult(data);
          setNotice(null);
        }
      } catch (error) {
        if (!ignore) {
          setNotice({ type: "error", text: getErrorMessage(error) });
          setResult(null);
        }
      }
    }

    void loadResult();

    return () => {
      ignore = true;
    };
  }, [electionId]);

  async function handleRefresh() {
    if (!electionId) {
      return;
    }

    try {
      const data = await apiRequest<GetElectionResultResponse>(
        `/elections/${electionId}/result`
      );
      setResult(data);
      setNotice({ type: "success", text: "结果已刷新" });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Result</p>
          <h1>查看结果</h1>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => void handleRefresh()}
          disabled={!electionId}
        >
          刷新结果
        </button>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel form">
        <label>
          投票
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={setElectionId}
          />
        </label>
      </div>

      {result ? (
        <div className="panel">
          <div className="result-heading">
            <div>
              <h2>{result.election.title}</h2>
              <p>{result.election.description || "无描述"}</p>
            </div>
            <strong>{result.result.totalVotes} 票</strong>
          </div>
          <table>
            <thead>
              <tr>
                <th>候选人</th>
                <th>candidateId</th>
                <th>票数</th>
              </tr>
            </thead>
            <tbody>
              {result.result.results.map((item) => (
                <tr key={item.candidateId}>
                  <td>{item.candidateName}</td>
                  <td>
                    <code>{item.candidateId}</code>
                  </td>
                  <td>{item.voteCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
