import { type FormEvent, useEffect, useMemo, useState } from "react";
import type {
  Election,
  ElectionDetail,
  Candidate,
  PendingBallot,
  ChallengeRecord,
  PrepareBallotRequest,
  PrepareBallotResponse,
  CastPreparedBallotResponse,
  ChallengePreparedBallotResponse,
  GetChallengeRecordsResponse,
  GetElectionResponse
} from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  formatTime,
  type Notice
} from "../common";

interface ChallengeAuditPageProps {
  elections: Election[];
}

export function ChallengeAuditPage({ elections }: ChallengeAuditPageProps) {
  const [electionId, setElectionId] = useState("");
  const [detail, setDetail] = useState<ElectionDetail | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [userId, setUserId] = useState("");
  const [pendingBallot, setPendingBallot] = useState<PendingBallot | null>(null);
  const [castResult, setCastResult] =
    useState<CastPreparedBallotResponse | null>(null);
  const [challengeResult, setChallengeResult] =
    useState<ChallengePreparedBallotResponse | null>(null);
  const [records, setRecords] = useState<GetChallengeRecordsResponse | null>(
    null
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingAction, setLoadingAction] = useState<
    "prepare" | "cast" | "challenge" | null
  >(null);

  const candidates = useMemo<Candidate[]>(
    () => detail?.candidates ?? [],
    [detail]
  );
  const challengeBallots = useMemo<PendingBallot[]>(
    () => records?.pendingBallots ?? [],
    [records]
  );
  const challengeRecords = useMemo<ChallengeRecord[]>(
    () => records?.challengeRecords ?? [],
    [records]
  );

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  useEffect(() => {
    let ignore = false;

    async function loadChallengeContext() {
      if (!electionId) {
        setDetail(null);
        setRecords(null);
        return;
      }

      try {
        const [electionData, recordData] = await Promise.all([
          apiRequest<GetElectionResponse>(`/elections/${electionId}`),
          apiRequest<GetChallengeRecordsResponse>(
            `/challenge/elections/${electionId}/records`
          )
        ]);

        if (!ignore) {
          setDetail(electionData.election);
          setRecords(recordData);
        }
      } catch (error) {
        if (!ignore) {
          setNotice({ type: "error", text: getErrorMessage(error) });
          setDetail(null);
          setRecords(null);
        }
      }
    }

    void loadChallengeContext();

    return () => {
      ignore = true;
    };
  }, [electionId]);

  useEffect(() => {
    if (!candidates.some((candidate) => candidate.id === candidateId)) {
      setCandidateId(candidates[0]?.id ?? "");
    }
  }, [candidateId, candidates]);

  async function refreshChallengeRecords(selectedElectionId = electionId) {
    if (!selectedElectionId) {
      setRecords(null);
      return;
    }

    const data = await apiRequest<GetChallengeRecordsResponse>(
      `/challenge/elections/${selectedElectionId}/records`
    );
    setRecords(data);
  }

  function resetActionState() {
    setPendingBallot(null);
    setCastResult(null);
    setChallengeResult(null);
    setNotice(null);
  }

  async function handlePrepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setCastResult(null);
    setChallengeResult(null);

    if (!electionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      setLoadingAction("prepare");
      const body: PrepareBallotRequest = { userId, candidateId };
      const data = await apiRequest<PrepareBallotResponse>(
        `/challenge/elections/${electionId}/prepare`,
        {
          method: "POST",
          body
        }
      );

      setPendingBallot(data.pendingBallot);
      await refreshChallengeRecords(electionId);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleCast() {
    if (!pendingBallot) {
      setNotice({ type: "error", text: "请先准备待确认选票" });
      return;
    }

    try {
      setLoadingAction("cast");
      const data = await apiRequest<CastPreparedBallotResponse>(
        `/challenge/ballots/${encodeURIComponent(pendingBallot.id)}/cast`,
        {
          method: "POST"
        }
      );

      setCastResult(data);
      setChallengeResult(null);
      setPendingBallot({ ...pendingBallot, status: "cast" });
      await refreshChallengeRecords(pendingBallot.electionId);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleChallenge() {
    if (!pendingBallot) {
      setNotice({ type: "error", text: "请先准备待确认选票" });
      return;
    }

    try {
      setLoadingAction("challenge");
      const data = await apiRequest<ChallengePreparedBallotResponse>(
        `/challenge/ballots/${encodeURIComponent(pendingBallot.id)}/challenge`,
        {
          method: "POST"
        }
      );

      setChallengeResult(data);
      setCastResult(null);
      setPendingBallot({ ...pendingBallot, status: "challenged" });
      await refreshChallengeRecords(pendingBallot.electionId);
      setNotice({ type: "success", text: data.message });
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
          <p className="eyebrow">Cast or Challenge</p>
          <h1>挑战审计</h1>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => void refreshChallengeRecords()}
          disabled={!electionId || loadingAction !== null}
        >
          刷新记录
        </button>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel attack-warning">
        <strong>挑战审计用于验证系统是否按用户选择正确生成 commitment。</strong>
        <p>
          被 challenge 的选票会公开 opening，因此不计入正式投票；只有 Cast 的 prepared ballot
          会进入正式 votes、结果、公告板和聚合器。
        </p>
      </div>

      <form className="panel form" onSubmit={handlePrepare}>
        <div className="two-column">
          <label>
            投票
            <ElectionSelect
              elections={elections}
              value={electionId}
              onChange={(value) => {
                setElectionId(value);
                resetActionState();
              }}
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
        </div>

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

        <button
          type="submit"
          disabled={
            !electionId ||
            !candidateId ||
            !userId.trim() ||
            loadingAction !== null
          }
        >
          {loadingAction === "prepare" ? "准备中..." : "准备待确认选票"}
        </button>
      </form>

      {pendingBallot ? (
        <div className="panel receipt-panel">
          <div className="verification-heading">
            <h2>pending ballot</h2>
            <span
              className={
                pendingBallot.status === "pending"
                  ? "status-pill ok"
                  : "status-pill bad"
              }
            >
              {pendingBallot.status}
            </span>
          </div>

          <div className="hash-list">
            <div>
              <span>pendingBallotId</span>
              <code className="hash-value">{pendingBallot.id}</code>
            </div>
            <div>
              <span>voteVector</span>
              <code className="hash-value">
                [{pendingBallot.voteVector.join(", ")}]
              </code>
            </div>
            <div>
              <span>randomness</span>
              <code className="hash-value">{pendingBallot.randomness}</code>
            </div>
            <div>
              <span>commitment</span>
              <code className="hash-value">{pendingBallot.commitment}</code>
            </div>
            <div>
              <span>receiptCode</span>
              <code className="hash-value">{pendingBallot.receiptCode}</code>
            </div>
            <div>
              <span>status</span>
              <code className="hash-value">{pendingBallot.status}</code>
            </div>
          </div>

          <div className="button-row">
            <button
              type="button"
              onClick={() => void handleCast()}
              disabled={
                pendingBallot.status !== "pending" || loadingAction !== null
              }
            >
              {loadingAction === "cast" ? "Cast 中..." : "Cast：正式投出"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void handleChallenge()}
              disabled={
                pendingBallot.status !== "pending" || loadingAction !== null
              }
            >
              {loadingAction === "challenge"
                ? "Challenge 中..."
                : "Challenge：公开开封审计"}
            </button>
          </div>
        </div>
      ) : null}

      {castResult ? (
        <div className="panel receipt-panel">
          <h2>该 prepared ballot 已正式计入投票</h2>
          <div className="hash-list">
            <div>
              <span>voteId</span>
              <code className="hash-value">{castResult.voteId}</code>
            </div>
            <div>
              <span>receiptCode</span>
              <code className="hash-value">{castResult.receiptCode}</code>
            </div>
            <div>
              <span>commitment</span>
              <code className="hash-value">{castResult.commitment}</code>
            </div>
            <div>
              <span>receiptChainIndex</span>
              <code className="hash-value">{castResult.receiptChainIndex}</code>
            </div>
            <div>
              <span>previousReceiptCodeHash</span>
              <code className="hash-value">
                {castResult.previousReceiptCodeHash ?? "null"}
              </code>
            </div>
            <div>
              <span>receiptChainHash</span>
              <code className="hash-value">{castResult.receiptChainHash}</code>
            </div>
          </div>
          <p className="receipt-note">
            可在回执查询、公告板、聚合器中继续验证这张正式选票。
          </p>
        </div>
      ) : null}

      {challengeResult ? (
        <div className="panel receipt-panel">
          <div className="verification-heading">
            <h2>challenge opening</h2>
            <span
              className={
                challengeResult.openingVerified
                  ? "status-pill ok"
                  : "status-pill bad"
              }
            >
              openingVerified = {challengeResult.openingVerified ? "true" : "false"}
            </span>
          </div>
          <div className="hash-list">
            <div>
              <span>voteVector</span>
              <code className="hash-value">
                [{challengeResult.record.voteVector.join(", ")}]
              </code>
            </div>
            <div>
              <span>randomness</span>
              <code className="hash-value">
                {challengeResult.record.randomness}
              </code>
            </div>
            <div>
              <span>commitment</span>
              <code className="hash-value">
                {challengeResult.record.commitment}
              </code>
            </div>
          </div>
          <p className="receipt-note">
            challenge 票只用于审计，不计入 tally。
          </p>
        </div>
      ) : null}

      <div className="panel">
        <div className="result-heading">
          <div>
            <h2>challenge records</h2>
            <p>该 election 下所有 prepared ballot 状态和公开 opening 记录。</p>
          </div>
          <strong>{challengeRecords.length}</strong>
        </div>

        {challengeBallots.length === 0 ? (
          <p className="empty">暂无 prepared ballot</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>pendingBallotId</th>
                <th>userId</th>
                <th>candidateId</th>
                <th>status</th>
                <th>receiptCode</th>
              </tr>
            </thead>
            <tbody>
              {challengeBallots.map((ballot) => (
                <tr key={ballot.id}>
                  <td>
                    <code>{ballot.id}</code>
                  </td>
                  <td>{ballot.userId}</td>
                  <td>{ballot.candidateId}</td>
                  <td>{ballot.status}</td>
                  <td>
                    <code className="hash-value">{ballot.receiptCode}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>公开 opening 审计记录</h2>
        {challengeRecords.length === 0 ? (
          <p className="empty">暂无 challenge record</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>recordId</th>
                <th>pendingBallotId</th>
                <th>openingVerified</th>
                <th>createdAt</th>
                <th>commitment</th>
              </tr>
            </thead>
            <tbody>
              {challengeRecords.map((record) => (
                <tr key={record.id}>
                  <td>
                    <code>{record.id}</code>
                  </td>
                  <td>
                    <code>{record.pendingBallotId}</code>
                  </td>
                  <td>{record.openingVerified ? "true" : "false"}</td>
                  <td>{formatTime(record.createdAt)}</td>
                  <td>
                    <code className="hash-value">{record.commitment}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
