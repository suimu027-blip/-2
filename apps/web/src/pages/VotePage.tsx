import { type FormEvent, useEffect, useMemo, useState } from "react";
import type {
  Election,
  ElectionDetail,
  Candidate,
  CastVoteRequest,
  CastVoteResponse,
  GetElectionResponse
} from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  type Notice
} from "../common";

interface VotePageProps {
  elections: Election[];
}

export function VotePage({ elections }: VotePageProps) {
  const [electionId, setElectionId] = useState("");
  const [detail, setDetail] = useState<ElectionDetail | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [userId, setUserId] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [receipt, setReceipt] = useState<CastVoteResponse | null>(null);

  const candidates = useMemo<Candidate[]>(
    () => detail?.candidates ?? [],
    [detail]
  );

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  useEffect(() => {
    let ignore = false;

    async function loadElection() {
      if (!electionId) {
        setDetail(null);
        return;
      }

      try {
        const data = await apiRequest<GetElectionResponse>(
          `/elections/${electionId}`
        );

        if (!ignore) {
          setDetail(data.election);
        }
      } catch (error) {
        if (!ignore) {
          setNotice({ type: "error", text: getErrorMessage(error) });
          setDetail(null);
        }
      }
    }

    void loadElection();

    return () => {
      ignore = true;
    };
  }, [electionId]);

  useEffect(() => {
    if (!candidates.some((candidate) => candidate.id === candidateId)) {
      setCandidateId(candidates[0]?.id ?? "");
    }
  }, [candidateId, candidates]);

  async function handleVote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setReceipt(null);

    if (!electionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      const body: CastVoteRequest = { userId, candidateId };
      const data = await apiRequest<CastVoteResponse>(
        `/elections/${electionId}/vote`,
        {
          method: "POST",
          body
        }
      );

      setReceipt(data);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Vote</p>
          <h1>投票</h1>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <form className="panel form narrow" onSubmit={handleVote}>
        <label>
          投票
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={setElectionId}
          />
        </label>
        <label>
          userId
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="例如：user_1"
          />
        </label>
        <label>
          候选人
          <select
            value={candidateId}
            onChange={(event) => setCandidateId(event.target.value)}
          >
            <option value="">请选择候选人</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!electionId || !candidateId}>
          提交投票
        </button>
      </form>

      {receipt ? (
        <div className="panel receipt-panel">
          <h2>投票成功</h2>
          <div className="hash-list">
            <div>
              <span>voteId</span>
              <code className="hash-value">{receipt.voteId}</code>
            </div>
            <div>
              <span>receiptCode</span>
              <code className="hash-value">{receipt.receiptCode}</code>
            </div>
            <div>
              <span>commitment</span>
              <code className="hash-value">{receipt.commitment}</code>
            </div>
            <div>
              <span>receiptChainIndex</span>
              <code className="hash-value">{receipt.receiptChainIndex}</code>
            </div>
            <div>
              <span>previousReceiptCodeHash</span>
              <code className="hash-value">
                {receipt.previousReceiptCodeHash ?? "null"}
              </code>
            </div>
            <div>
              <span>receiptChainHash</span>
              <code className="hash-value">{receipt.receiptChainHash}</code>
            </div>
            <div>
              <span>voteVector</span>
              <code className="hash-value">
                [{receipt.voteVector.join(", ")}]
              </code>
            </div>
          </div>
          <p className="receipt-note">
            回执码只能证明选票已被记录，不能证明你投给了谁。
          </p>
        </div>
      ) : null}
    </section>
  );
}
