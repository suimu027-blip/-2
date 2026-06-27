# VeriVote v2 Contract Fixtures

These files are stable demo contracts for parallel work. Frontend and export pages can render them before the A/B/C implementations are fully wired.

| File | Producer | Used by | Notes |
| --- | --- | --- | --- |
| `demo_seed_fixture.json` | D | A/B/C/D | 4 candidates, 8 users, 8 cast votes, 2 challenge ballots. |
| `aggregator_report_v2.sample.json` | A sample | B/D | Includes partition audit, diagnostics hash, public input hints, and Pedersen aggregate status. |
| `public_inputs_v2.sample.json` | A sample | B/D | Flattened public inputs for ZK/report binding. |
| `tally_proof_v2.sample.json` | B sample | D | Mock/local-mock tally proof shape with verifier mode and proof hash. |
| `pedersen_aggregate_audit.sample.json` | C sample | A/D | Pedersen aggregate status with verified hash. |
| `chain_audit.real.sample.json` | B/D sample | D | Hardhat-style audit record, tx hash, contract address, gas. |
| `export_bundle_v2.sample.json` | D | Report owner | Full export bundle envelope for screenshots and report material. |

When real APIs are available, keep these filenames stable and replace only the payload content. UI code must handle `null`, `pending`, `ok`, and `failed` states for optional A/B/C outputs.
