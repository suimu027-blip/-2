from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any, Protocol


TABLES: list[tuple[str, str]] = [
    ("users", "id"),
    ("elections", "id"),
    ("candidates", "id"),
    ("votes", "id"),
    ("pending_ballots", "id"),
    ("challenge_records", "id"),
    ("bulletin_boards", "election_id"),
    ("aggregator_reports", "election_id"),
    ("attack_logs", "id"),
    ("blockchain_audit_records", "election_id"),
    ("kv_counters", "name"),
]


class PersistenceAdapter(Protocol):
    mode: str

    def load(self, state: dict[str, Any]) -> None: ...
    def save_user(self, user: dict[str, Any]) -> None: ...
    def save_election(self, election: dict[str, Any]) -> None: ...
    def save_candidate(self, candidate: dict[str, Any]) -> None: ...
    def save_vote(self, vote: dict[str, Any]) -> None: ...
    def delete_vote(self, vote_id: str) -> None: ...
    def save_pending_ballot(self, pending: dict[str, Any]) -> None: ...
    def save_challenge_record(self, record: dict[str, Any]) -> None: ...
    def save_bulletin_board(self, board: dict[str, Any]) -> None: ...
    def save_aggregator_report(self, report: dict[str, Any]) -> None: ...
    def save_attack_log(self, log: dict[str, Any]) -> None: ...
    def save_blockchain_audit_record(self, record: dict[str, Any]) -> None: ...
    def save_counters(self, counters: dict[str, int]) -> None: ...
    def close(self) -> None: ...


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _requested_mode() -> str:
    raw = os.environ.get("VERIVOTE_PERSISTENCE", "auto").lower()
    return raw if raw in {"auto", "memory", "sqlite"} else "auto"


def _sqlite_path() -> Path:
    return Path(os.environ.get("VERIVOTE_SQLITE_PATH", "./data/verivote.db")).resolve()


class MemoryAdapter:
    mode = "memory"

    def load(self, state: dict[str, Any]) -> None:
        return None

    def save_user(self, user: dict[str, Any]) -> None:
        return None

    def save_election(self, election: dict[str, Any]) -> None:
        return None

    def save_candidate(self, candidate: dict[str, Any]) -> None:
        return None

    def save_vote(self, vote: dict[str, Any]) -> None:
        return None

    def delete_vote(self, vote_id: str) -> None:
        return None

    def save_pending_ballot(self, pending: dict[str, Any]) -> None:
        return None

    def save_challenge_record(self, record: dict[str, Any]) -> None:
        return None

    def save_bulletin_board(self, board: dict[str, Any]) -> None:
        return None

    def save_aggregator_report(self, report: dict[str, Any]) -> None:
        return None

    def save_attack_log(self, log: dict[str, Any]) -> None:
        return None

    def save_blockchain_audit_record(self, record: dict[str, Any]) -> None:
        return None

    def save_counters(self, counters: dict[str, int]) -> None:
        return None

    def close(self) -> None:
        return None


class SqliteAdapter:
    mode = "sqlite"

    def __init__(self, database_path: Path):
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(database_path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._db.execute("PRAGMA journal_mode = WAL")
            self._db.execute("PRAGMA foreign_keys = ON")
            for table_name, key_column in TABLES:
                self._db.execute(
                    f"CREATE TABLE IF NOT EXISTS {table_name} ({key_column} TEXT PRIMARY KEY, payload TEXT NOT NULL)"
                )
            self._db.commit()

    def _key_column(self, table_name: str) -> str:
        for current_table, key_column in TABLES:
            if current_table == table_name:
                return key_column
        raise KeyError(table_name)

    def _upsert(self, table_name: str, key: str, value: Any) -> None:
        key_column = self._key_column(table_name)
        with self._lock:
            self._db.execute(
                f"INSERT INTO {table_name} ({key_column}, payload) VALUES (?, ?) "
                f"ON CONFLICT({key_column}) DO UPDATE SET payload = excluded.payload",
                (key, _json_dumps(value)),
            )
            self._db.commit()

    def _select_all(self, table_name: str) -> list[Any]:
        with self._lock:
            rows = self._db.execute(f"SELECT payload FROM {table_name}").fetchall()
        return [json.loads(row[0]) for row in rows]

    def load(self, state: dict[str, Any]) -> None:
        state["users"].extend(self._select_all("users"))
        state["elections"].extend(self._select_all("elections"))
        state["candidates"].extend(self._select_all("candidates"))
        state["votes"].extend(self._select_all("votes"))
        state["pending_ballots"].extend(self._select_all("pending_ballots"))
        state["challenge_records"].extend(self._select_all("challenge_records"))
        state["bulletin_boards"].extend(self._select_all("bulletin_boards"))
        state["aggregator_reports"].extend(self._select_all("aggregator_reports"))
        state["attack_logs"].extend(self._select_all("attack_logs"))
        for record in self._select_all("blockchain_audit_records"):
            state["blockchain_audit_records"][record["electionId"]] = record
        with self._lock:
            rows = self._db.execute("SELECT name, payload FROM kv_counters").fetchall()
        for name, payload in rows:
            state["counters"][name] = json.loads(payload)

    def save_user(self, user: dict[str, Any]) -> None:
        self._upsert("users", user["id"], user)

    def save_election(self, election: dict[str, Any]) -> None:
        self._upsert("elections", election["id"], election)

    def save_candidate(self, candidate: dict[str, Any]) -> None:
        self._upsert("candidates", candidate["id"], candidate)

    def save_vote(self, vote: dict[str, Any]) -> None:
        self._upsert("votes", vote["id"], vote)

    def delete_vote(self, vote_id: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM votes WHERE id = ?", (vote_id,))
            self._db.commit()

    def save_pending_ballot(self, pending: dict[str, Any]) -> None:
        self._upsert("pending_ballots", pending["id"], pending)

    def save_challenge_record(self, record: dict[str, Any]) -> None:
        self._upsert("challenge_records", record["id"], record)

    def save_bulletin_board(self, board: dict[str, Any]) -> None:
        self._upsert("bulletin_boards", board["electionId"], board)

    def save_aggregator_report(self, report: dict[str, Any]) -> None:
        self._upsert("aggregator_reports", report["electionId"], report)

    def save_attack_log(self, log: dict[str, Any]) -> None:
        self._upsert("attack_logs", log["id"], log)

    def save_blockchain_audit_record(self, record: dict[str, Any]) -> None:
        self._upsert("blockchain_audit_records", record["electionId"], record)

    def save_counters(self, counters: dict[str, int]) -> None:
        with self._lock:
            for name, value in counters.items():
                self._db.execute(
                    "INSERT INTO kv_counters (name, payload) VALUES (?, ?) "
                    "ON CONFLICT(name) DO UPDATE SET payload = excluded.payload",
                    (name, _json_dumps(value)),
                )
            self._db.commit()

    def close(self) -> None:
        with self._lock:
            self._db.close()


def create_persistence_adapter() -> PersistenceAdapter:
    requested = _requested_mode()
    if requested == "memory":
        print("[persistence] memory-only mode (VERIVOTE_PERSISTENCE=memory)")
        return MemoryAdapter()

    database_path = _sqlite_path()
    print(f"[persistence] sqlite mode at {database_path}")
    return SqliteAdapter(database_path)
