import { useEffect, useMemo, useState } from "react";
import type { AttackLog, AttackResponse, Election, GetAttackLogsResponse } from "@verivote/shared";
import {
  apiRequest,
  getErrorMessage,
  NoticeMessage,
  ElectionSelect,
  formatTime,
  formatJson,
  type Notice
} from "../common";
import { demoAttackMatrix } from "../data/demo-fixtures";

const attackActions = [
  {
    label: "Tamper commitment",
    path: "tamper-commitment",
    tip: "Next: re-run Aggregator and check AuditReport hashes."
  },
  {
    label: "Delete vote",
    path: "delete-vote",
    tip: "Next: check BulletinBoard receipt chain and Merkle proof."
  },
  {
    label: "Inject duplicate vote",
    path: "inject-duplicate-vote",
    tip: "Next: re-run Aggregator and inspect duplicateVotes."
  },
  {
    label: "Inject invalid vote",
    path: "inject-invalid-vote",
    tip: "Next: re-run Aggregator and inspect invalidVotes."
  },
  {
    label: "Tamper tally",
    path: "tamper-tally",
    tip: "Next: open AuditReport and check tallyConsistent=false."
  }
] as const;

function AttackLogCard({ log }: { log: AttackLog }) {
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

export function AttackLabPage({ elections }: { elections: Election[] }) {
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

  const orderedLogs = useMemo(() => [...logs].reverse(), [logs]);

  async function handleAttack(path: string) {
    setNotice(null);
    setLatestLog(null);

    if (!electionId) {
      setNotice({ type: "error", text: "Select an election first." });
      return;
    }

    try {
      setRunningPath(path);
      const data = await apiRequest<AttackResponse>(
        `/attack/elections/${electionId}/${path}`,
        { method: "POST" }
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

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Attack Lab</p>
          <h1>Attack Matrix</h1>
        </div>
      </div>

      <NoticeMessage notice={notice} />

      <div className="panel attack-warning">
        <strong>Demo only</strong>
        <p>
          These actions mutate the current API process data. Disable /attack/* before production deployment.
        </p>
      </div>

      <div className="panel form">
        <label>
          Election
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

      <div className="panel">
        <h2>verification routes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>attack</th>
                <th>artifact</th>
                <th>expected failure</th>
                <th>next view</th>
              </tr>
            </thead>
            <tbody>
              {demoAttackMatrix.map((row) => (
                <tr key={row.action}>
                  <td>{row.label}</td>
                  <td>{row.artifact}</td>
                  <td>{row.expected}</td>
                  <td>{row.nextView}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="attack-grid">
        {attackActions.map((action) => (
          <article key={action.path} className="panel attack-card">
            <button
              type="button"
              onClick={() => void handleAttack(action.path)}
              disabled={!electionId || runningPath !== null}
            >
              {runningPath === action.path ? "Running..." : action.label}
            </button>
            <p>{action.tip}</p>
          </article>
        ))}
      </div>

      {latestLog ? (
        <div className="panel">
          <h2>latest attack result</h2>
          <AttackLogCard log={latestLog} />
        </div>
      ) : null}

      <div className="panel">
        <h2>attack logs</h2>
        {orderedLogs.length === 0 ? (
          <p className="empty">No attack logs.</p>
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
