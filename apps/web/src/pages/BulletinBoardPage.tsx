import { useEffect, useState } from "react";
import type {
  Election,
  BulletinBoard,
  GetBulletinBoardResponse,
  FinalizeElectionResponse
} from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  formatTime,
  NoticeMessage,
  ElectionSelect,
  receiptChainExplanation,
  type Notice
} from "../common";
import {
  HashSequence,
  ReceiptChainBreakList,
  ReceiptChainTable,
  BulletinTallyTable
} from "../components/AuditComponents";

interface BulletinBoardPageProps {
  elections: Election[];
  onRefreshElections: () => Promise<void>;
}

export function BulletinBoardPage({
  elections,
  onRefreshElections
}: BulletinBoardPageProps) {
  const [electionId, setElectionId] = useState("");
  const [bulletin, setBulletin] = useState<BulletinBoard | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  useEffect(() => {
    let ignore = false;

    async function loadBulletin() {
      if (!electionId) {
        setBulletin(null);
        return;
      }

      try {
        const data = await apiRequest<GetBulletinBoardResponse>(
          `/elections/${electionId}/bulletin`
        );

        if (!ignore) {
          setBulletin(data.bulletin);
          setNotice(null);
        }
      } catch {
        if (!ignore) {
          setBulletin(null);
          setNotice(null);
        }
      }
    }

    void loadBulletin();

    return () => {
      ignore = true;
    };
  }, [electionId]);

  async function handleFinalize() {
    setNotice(null);

    if (!electionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      const data = await apiRequest<FinalizeElectionResponse>(
        `/elections/${electionId}/finalize`,
        {
          method: "POST"
        }
      );
      setBulletin(data.bulletin);
      await onRefreshElections();
      setNotice({ type: "success", text: "公告板已生成" });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Bulletin Board</p>
          <h1>公告板</h1>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => void handleFinalize()}
          disabled={!electionId}
        >
          生成公告板
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

      {bulletin ? (
        <>
          <div className="panel receipt-panel">
            <div className="result-heading">
              <div>
                <h2>公开公告板</h2>
                <p>创建时间：{formatTime(bulletin.createdAt)}</p>
              </div>
              <strong>{bulletin.totalVotes} 票</strong>
            </div>
            <div className="hash-list">
              <div>
                <span>electionId</span>
                <code className="hash-value">{bulletin.electionId}</code>
              </div>
              <div>
                <span>totalVotes</span>
                <code className="hash-value">{bulletin.totalVotes}</code>
              </div>
              <div>
                <span>merkleRoot</span>
                <code className="hash-value">{bulletin.merkleRoot}</code>
              </div>
              <div>
                <span>receiptChainVerified</span>
                <code className="hash-value">
                  {bulletin.receiptChainVerified ? "true" : "false"}
                </code>
              </div>
            </div>
          </div>

          <div className="panel receipt-panel">
            <div className="verification-heading">
              <h2>receiptChainVerified</h2>
              <span
                className={
                  bulletin.receiptChainVerified
                    ? "status-pill ok"
                    : "status-pill bad"
                }
              >
                {bulletin.receiptChainVerified ? "true" : "false"}
              </span>
            </div>
            <p className="receipt-note">{receiptChainExplanation}</p>
            <ReceiptChainBreakList breaks={bulletin.receiptChainBreaks} />
          </div>

          <div className="two-column">
            <div className="panel">
              <HashSequence
                title="commitments"
                values={bulletin.commitments}
                emptyText="暂无 commitment"
              />
            </div>
            <div className="panel">
              <HashSequence
                title="receiptCodeHashes"
                values={bulletin.receiptCodeHashes}
                emptyText="暂无 receiptCode hash"
              />
            </div>
          </div>

          <div className="panel">
            <h2>receipt chain</h2>
            <ReceiptChainTable records={bulletin.receiptChain} />
          </div>

          <div className="panel">
            <HashSequence
              title="Merkle leaves"
              values={bulletin.leaves}
              emptyText="暂无 Merkle leaf"
            />
          </div>

          <div className="panel">
            <h2>tallyResult</h2>
            <BulletinTallyTable bulletin={bulletin} />
          </div>
        </>
      ) : (
        <div className="panel">
          <p className="empty">该投票尚未生成公告板。</p>
        </div>
      )}
    </section>
  );
}
