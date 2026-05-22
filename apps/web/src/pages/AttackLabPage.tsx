import { useEffect, useState } from "react";
import type { Election, AttackLog, GetAttackLogsResponse, AttackResponse } from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  formatTime,
  formatJson,
  type Notice
} from "../common";

const attackActions = [
  {
    label: "演示攻击：篡改 commitment",
    path: "tamper-commitment",
    tip: "验证：重新运行聚合器或查看审计报告，receipt chain 应能发现 chain hash 不匹配。"
  },
  {
    label: "演示攻击：删除选票",
    path: "delete-vote",
    tip: "验证：重新运行聚合器或查看审计报告，删除或重排正式票会导致 receipt chain 验证失败。"
  },
  {
    label: "演示攻击：注入重复投票",
    path: "inject-duplicate-vote",
    tip: "验证：重新运行聚合器，然后查看 duplicateVotes。"
  },
  {
    label: "演示攻击：注入非法投票",
    path: "inject-invalid-vote",
    tip: "验证：重新运行聚合器，然后查看 invalidVotes。"
  },
  {
    label: "演示攻击：篡改 tallyResult",
    path: "tamper-tally",
    tip: "验证：去审计报告页面查看 tallyConsistent 是否为 false。"
  }
] as const;

interface AttackLogCardProps {
  log: AttackLog;
}

function AttackLogCard({ log }: AttackLogCardProps) {
  return (
    <article className="attack-log">
      <div className="result-heading">
        <div>
          <h2>{log.type}</h2>
          <p>{log.description}</p>
        </div>
        <code>{formatTime(log.createdAt)}</code>
      </div>
      <div className="log-grid">
        <div>
          <span>before</span>
          <pre>{formatJson(log.before)}</pre>
        </div>
        <div>
          <span>after</span>
          <pre>{formatJson(log.after)}</pre>
        </div>
      </div>
    </article>
  );
}

interface AttackLabPageProps {
  elections: Election[];
}

export function AttackLabPage({ elections }: AttackLabPageProps) {
  const [electionId, setElectionId] = useState("");
  const [logs, setLogs] = useState<AttackLog[]>([]);
  const [latestLog, setLatestLog] = useState<AttackLog | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [runningPath, setRunningPath] = useState<string | null>(null);

  useEffect(() => {
    if (!electionId && elections.length > 0) {
      setElectionId(elections[0].id);
    }
  }, [electionId, elections]);

  useEffect(() => {
    let ignore = false;

    async function loadLogs() {
      if (!electionId) {
        setLogs([]);
        return;
      }

      try {
        const data = await apiRequest<GetAttackLogsResponse>(
          `/attack/elections/${electionId}/logs`
        );

        if (!ignore) {
          setLogs(data.logs);
          setNotice(null);
        }
      } catch (error) {
        if (!ignore) {
          setLogs([]);
          setNotice({ type: "error", text: getErrorMessage(error) });
        }
      }
    }

    void loadLogs();

    return () => {
      ignore = true;
    };
  }, [electionId]);

  async function handleAttack(path: string) {
    setNotice(null);
    setLatestLog(null);

    if (!electionId) {
      setNotice({ type: "error", text: "请先选择投票" });
      return;
    }

    try {
      setRunningPath(path);
      const data = await apiRequest<AttackResponse>(
        `/attack/elections/${electionId}/${path}`,
        {
          method: "POST"
        }
      );

      setLatestLog(data.log);
      setLogs((currentLogs) => [
        ...currentLogs.filter((log) => log.id !== data.log.id),
        data.log
      ]);
      setNotice({ type: "success", text: data.message });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    } finally {
      setRunningPath(null);
    }
  }

  const orderedLogs = [...logs].reverse();

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Attack Lab</p>
          <h1>攻击演示</h1>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel attack-warning">
        <strong>Demo only</strong>
        <p>
          本页所有按钮都是“演示攻击”，会直接修改当前 API 进程中的内存数据。
          删除或重排正式票会导致 receipt chain 验证失败。
        </p>
      </div>

      <div className="panel form">
        <label>
          投票
          <ElectionSelect
            elections={elections}
            value={electionId}
            onChange={(value) => {
              setElectionId(value);
              setLatestLog(null);
            }}
          />
        </label>
      </div>

      <div className="attack-grid">
        {attackActions.map((action) => (
          <article key={action.path} className="panel attack-card">
            <button
              type="button"
              onClick={() => void handleAttack(action.path)}
              disabled={!electionId || runningPath !== null}
            >
              {runningPath === action.path ? "执行中..." : action.label}
            </button>
            <p>{action.tip}</p>
          </article>
        ))}
      </div>

      {latestLog ? (
        <div className="panel">
          <h2>最新攻击结果</h2>
          <AttackLogCard log={latestLog} />
        </div>
      ) : null}

      <div className="panel">
        <h2>AttackLog 列表</h2>
        {orderedLogs.length === 0 ? (
          <p className="empty">暂无攻击日志</p>
        ) : (
          <div className="attack-log-list">
            {orderedLogs.map((log) => (
              <AttackLogCard key={log.id} log={log} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
