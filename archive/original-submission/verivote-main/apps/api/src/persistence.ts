

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  AggregatorReport,
  AttackLog,
  BlockchainAuditRecord,
  BulletinBoard,
  Candidate,
  ChallengeRecord,
  Election,
  PendingBallot,
  User,
  Vote
} from "@verivote/shared";

export type PersistenceMode = "memory" | "sqlite";

export interface PersistenceAdapter {
  readonly mode: PersistenceMode;
  
  load(state: PersistenceState): void;
  saveUser(user: User): void;
  saveElection(election: Election): void;
  saveCandidate(candidate: Candidate): void;
  saveVote(vote: Vote): void;
  deleteVote(voteId: string): void;
  savePendingBallot(pending: PendingBallot): void;
  saveChallengeRecord(record: ChallengeRecord): void;
  saveBulletinBoard(board: BulletinBoard): void;
  saveAggregatorReport(report: AggregatorReport): void;
  saveAttackLog(log: AttackLog): void;
  saveBlockchainAuditRecord(record: BlockchainAuditRecord): void;
  
  saveCounters(counters: Record<string, number>): void;
  close(): void;
}

export interface PersistenceState {
  users: User[];
  elections: Election[];
  candidates: Candidate[];
  votes: Vote[];
  pendingBallots: PendingBallot[];
  challengeRecords: ChallengeRecord[];
  bulletinBoards: BulletinBoard[];
  aggregatorReports: AggregatorReport[];
  attackLogs: AttackLog[];
  blockchainAuditRecords: Map<string, BlockchainAuditRecord>;
  counters: Record<string, number>;
}

function getRequestedMode(): "auto" | PersistenceMode {
  const raw = (process.env.VERIVOTE_PERSISTENCE ?? "auto").toLowerCase();
  if (raw === "memory" || raw === "sqlite") return raw;
  return "auto";
}

function getSqlitePath(): string {
  return resolve(
    process.env.VERIVOTE_SQLITE_PATH ?? "./data/verivote.db"
  );
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

class MemoryAdapter implements PersistenceAdapter {
  readonly mode: PersistenceMode = "memory";
  load(_state: PersistenceState): void {
    /* nothing to load */
  }
  saveUser(_user: User): void {}
  saveElection(_election: Election): void {}
  saveCandidate(_candidate: Candidate): void {}
  saveVote(_vote: Vote): void {}
  deleteVote(_voteId: string): void {}
  savePendingBallot(_pending: PendingBallot): void {}
  saveChallengeRecord(_record: ChallengeRecord): void {}
  saveBulletinBoard(_board: BulletinBoard): void {}
  saveAggregatorReport(_report: AggregatorReport): void {}
  saveAttackLog(_log: AttackLog): void {}
  saveBlockchainAuditRecord(_record: BlockchainAuditRecord): void {}
  saveCounters(_counters: Record<string, number>): void {}
  close(): void {}
}

interface BetterSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): BetterSqliteStatement;
  close(): void;
}

interface BetterSqliteStatement {
  run(...params: unknown[]): { changes: number };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

type BetterSqliteFactory = new (path: string) => BetterSqliteDatabase;

const TABLES: Array<{ name: string; keyColumn: string }> = [
  { name: "users", keyColumn: "id" },
  { name: "elections", keyColumn: "id" },
  { name: "candidates", keyColumn: "id" },
  { name: "votes", keyColumn: "id" },
  { name: "pending_ballots", keyColumn: "id" },
  { name: "challenge_records", keyColumn: "id" },
  { name: "bulletin_boards", keyColumn: "election_id" },
  { name: "aggregator_reports", keyColumn: "election_id" },
  { name: "attack_logs", keyColumn: "id" },
  { name: "blockchain_audit_records", keyColumn: "election_id" },
  { name: "kv_counters", keyColumn: "name" }
];

class SqliteAdapter implements PersistenceAdapter {
  readonly mode: PersistenceMode = "sqlite";
  private readonly db: BetterSqliteDatabase;

  constructor(databasePath: string, Ctor: BetterSqliteFactory) {
    ensureParentDir(databasePath);
    this.db = new Ctor(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    for (const table of TABLES) {
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${table.name} (` +
          `${table.keyColumn} TEXT PRIMARY KEY, ` +
          `payload TEXT NOT NULL` +
          `)`
      );
    }
  }

  private upsert(table: string, key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO ${table} (${TABLES.find((t) => t.name === table)!.keyColumn}, payload) ` +
          `VALUES (?, ?) ` +
          `ON CONFLICT(${TABLES.find((t) => t.name === table)!.keyColumn}) ` +
          `DO UPDATE SET payload = excluded.payload`
      )
      .run(key, JSON.stringify(value));
  }

  private selectAll<T>(table: string): T[] {
    const rows = this.db.prepare(`SELECT payload FROM ${table}`).all() as Array<{
      payload: string;
    }>;
    return rows.map((row) => JSON.parse(row.payload) as T);
  }

  load(state: PersistenceState): void {
    state.users.push(...this.selectAll<User>("users"));
    state.elections.push(...this.selectAll<Election>("elections"));
    state.candidates.push(...this.selectAll<Candidate>("candidates"));
    state.votes.push(...this.selectAll<Vote>("votes"));
    state.pendingBallots.push(
      ...this.selectAll<PendingBallot>("pending_ballots")
    );
    state.challengeRecords.push(
      ...this.selectAll<ChallengeRecord>("challenge_records")
    );
    state.bulletinBoards.push(
      ...this.selectAll<BulletinBoard>("bulletin_boards")
    );
    state.aggregatorReports.push(
      ...this.selectAll<AggregatorReport>("aggregator_reports")
    );
    state.attackLogs.push(...this.selectAll<AttackLog>("attack_logs"));
    for (const record of this.selectAll<BlockchainAuditRecord>(
      "blockchain_audit_records"
    )) {
      state.blockchainAuditRecords.set(record.electionId, record);
    }
    const counters = this.db
      .prepare("SELECT name, payload FROM kv_counters")
      .all() as Array<{ name: string; payload: string }>;
    for (const row of counters) {
      state.counters[row.name] = JSON.parse(row.payload) as number;
    }
  }

  saveUser(user: User): void {
    this.upsert("users", user.id, user);
  }
  saveElection(election: Election): void {
    this.upsert("elections", election.id, election);
  }
  saveCandidate(candidate: Candidate): void {
    this.upsert("candidates", candidate.id, candidate);
  }
  saveVote(vote: Vote): void {
    this.upsert("votes", vote.id, vote);
  }
  deleteVote(voteId: string): void {
    this.db.prepare("DELETE FROM votes WHERE id = ?").run(voteId);
  }
  savePendingBallot(pending: PendingBallot): void {
    this.upsert("pending_ballots", pending.id, pending);
  }
  saveChallengeRecord(record: ChallengeRecord): void {
    this.upsert("challenge_records", record.id, record);
  }
  saveBulletinBoard(board: BulletinBoard): void {
    this.upsert("bulletin_boards", board.electionId, board);
  }
  saveAggregatorReport(report: AggregatorReport): void {
    this.upsert("aggregator_reports", report.electionId, report);
  }
  saveAttackLog(log: AttackLog): void {
    this.upsert("attack_logs", log.id, log);
  }
  saveBlockchainAuditRecord(record: BlockchainAuditRecord): void {
    this.upsert("blockchain_audit_records", record.electionId, record);
  }
  saveCounters(counters: Record<string, number>): void {
    const stmt = this.db.prepare(
      "INSERT INTO kv_counters (name, payload) VALUES (?, ?) " +
        "ON CONFLICT(name) DO UPDATE SET payload = excluded.payload"
    );
    for (const [name, value] of Object.entries(counters)) {
      stmt.run(name, JSON.stringify(value));
    }
  }
  close(): void {
    this.db.close();
  }
}

async function tryLoadBetterSqlite(): Promise<BetterSqliteFactory | null> {
  try {
    // Dynamic import so the module is optional.
    const mod = (await import("better-sqlite3")) as { default: BetterSqliteFactory };
    return mod.default;
  } catch {
    return null;
  }
}

export async function createPersistenceAdapter(): Promise<PersistenceAdapter> {
  const requested = getRequestedMode();

  if (requested === "memory") {
    console.log("[persistence] memory-only mode (VERIVOTE_PERSISTENCE=memory)");
    return new MemoryAdapter();
  }

  const Ctor = await tryLoadBetterSqlite();

  if (!Ctor) {
    if (requested === "sqlite") {
      throw new Error(
        "VERIVOTE_PERSISTENCE=sqlite but better-sqlite3 is not installed. " +
          "Run `pnpm add -F @verivote/api better-sqlite3` first."
      );
    }
    console.log(
      "[persistence] better-sqlite3 not installed; falling back to memory mode. " +
        "Install better-sqlite3 to enable persistence."
    );
    return new MemoryAdapter();
  }

  const dbPath = getSqlitePath();
  console.log(`[persistence] sqlite mode at ${dbPath}`);
  return new SqliteAdapter(dbPath, Ctor);
}
