# VeriVote v2 Contract Fixtures

These files are stable demo contracts for parallel work. Frontend and export pages can render them before the A/B/C implementations are fully wired.

| File | Producer | Used by | Notes |
| --- | --- | --- | --- |
| `demo_seed_fixture.json` | D | A/B/C/D | 4 candidates, 8 users, 8 cast votes, 2 challenge ballots. |
| `aggregator_report_v2.sample.json` | A sample | B/D | Includes partition audit, diagnostics hash, public input hints, and Pedersen aggregate status. |
| `public_inputs_v2.sample.json` | A sample | B/D | Flattened public inputs for ZK/report binding. |
| `tally_proof_v2.sample.json` | B sample | D | Mock/local-mock tally proof shape with verifier mode and proof hash. |
| `pedersen_aggregate_audit.sample.json` | C sample | A/D | Default valid Pedersen aggregate audit used by D's demo fixture loader. |
| `pedersen_aggregate_audit.valid.sample.json` | C sample | A/D | Valid Pedersen aggregate audit with `verified=true`. |
| `pedersen_aggregate_audit.tampered.sample.json` | C sample | A/D | Tampered aggregate audit with `verified=false`. |
| `chain_audit.real.sample.json` | B/D sample | D | Hardhat-style audit record, tx hash, contract address, gas. |
| `export_bundle_v2.sample.json` | D | Report owner | Full export bundle envelope for screenshots and report material. |

When real APIs are available, keep these filenames stable and replace only the payload content. UI code must handle `null`, `pending`, `ok`, and `failed` states for optional A/B/C outputs.

---

## Task B ZK contract samples

# Contract and Proof Samples

This directory contains B-track fixtures for the VeriVote ZK and chain demo.

## Files

- `valid_vote_records_8x4.sample.json`: fixed 8-ballot, 4-candidate witness fixture.
- `task_b_aggregator_report_8x4.sample.json`: report metadata fixture for proof/report binding.
- `tally_proof_v2.valid.sample.json`: real Groth16 TallyProof v2 generated after `pnpm zk:setup`.
- `tally_proof_v2.invalid-tally.sample.json`: invalid request fixture where tally does not match the witness.
- `calldata.sample.json`: real Solidity calldata `{ a, b, c, input }` derived from the valid proof.
- `task_b_chain_audit.real.sample.json`: local Hardhat transaction sample using the generated `TallyVerifier`.

The D-facing files `aggregator_report_v2.sample.json` and
`chain_audit.real.sample.json` are kept stable for the teammate frontend demo.
Task B regeneration scripts write the `task_b_*` files above so they do not
overwrite D fixtures.

## Real/Mock Boundary

The valid proof and calldata files in this directory are real Groth16 artifacts
for the current local `zk-artifacts` and `contracts/TallyVerifier.sol`.

If `pnpm zk:setup` is run again, the zkey and verifier constants change; refresh
these samples before using them in tests or demos. The Hardhat real-verifier
test defaults to `docs/contracts/calldata.sample.json`; override it with
`VERIVOTE_REAL_TALLY_CALLDATA_JSON` only when testing another fixture.

## Reproduce

```bash
pnpm zk:setup
pnpm zk:samples
pnpm zk:audit
pnpm contract:test
pnpm --filter @verivote/contracts run sample:chain-audit
```
