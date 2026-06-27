# Benchmark Summary Template

This file is the D-line summary page for final material collection. Keep raw outputs in `docs/assets/demo-materials/benchmark/`.

## Environment

| Item | Value |
| --- | --- |
| Date | 2026-06-18 sample; replace with run date |
| Machine | Local Windows demo box |
| Node | Run `node -v` |
| API mode | `VERIVOTE_PERSISTENCE=memory` or `sqlite` |
| Chain mode | `local-mock` or `hardhat` |

## Local core benchmark

Source: `docs/evaluation/BENCHMARK.md` and `benchmark-results.json`.

| Votes | Candidate count | Total avg ms | Notes |
| ---: | ---: | ---: | --- |
| 100 | 4 | 7.846 | local core flow |
| 1000 | 4 | 44.862 | local core flow |
| 5000 | 4 | 219.951 | local core flow |
| 10000 | 4 | 466.018 | local core flow |

## API smoke

| Command | Expected |
| --- | --- |
| `curl http://localhost:3001/health` | `{ "ok": true }` |
| `corepack pnpm demo:seed` | Prints `electionId` and bundle path |
| `GET /elections/:id/export-bundle` | `schemaVersion=verivote.artifact.v2` |

## ZK proof

| Mode | Command/page | Proof time | Verify time | Status |
| --- | --- | ---: | ---: | --- |
| mock | Tally ZK sample | pending | pending | demo fixture |
| real | `corepack pnpm zk:demo` | fill after B run | fill after B run | pending |

## Gas

| Operation | Mode | Gas used | Tx hash |
| --- | --- | ---: | --- |
| `submitAudit` | hardhat | fill after run | fill after run |
| `submitAuditWithTallyProof` | hardhat | fill after run | fill after run |
| `verifyProof` | hardhat | fill after run | fill after run |

## Notes

- Local-mock rows are valid for UI rehearsal only.
- Real-hardhat rows require a running local Hardhat node and deployed verifier.
- Do not compare local mock latency with real verifier gas as if they are the same class of measurement.
