# VeriVote Parallel Interface Contract

This file freezes the JSON/API contract used by the independent A/B/C/D tracks.
Samples live in `docs/contracts`; generated acceptance evidence lives in
`docs/evaluation`.

## A: AggregatorReport V2

Producer: A-track backend aggregator.

Stable samples:

- `docs/contracts/aggregator_report_v2.sample.json`
- `docs/contracts/aggregator_report.sample.json`
- `docs/contracts/aggregator_report_pedersen_null.sample.json`
- `docs/contracts/export_bundle_v2.sample.json`
- `docs/contracts/public_inputs_v2.sample.json`
- `docs/contracts/valid_vote_records_8x4.sample.json`
- `docs/contracts/demo_seed_fixture.json`
- `docs/evaluation/aggregator_reports/*.json`

Required report fields:

| Field | Contract |
| --- | --- |
| `partitionAudit.buckets[]` | Candidate buckets with `candidateId`, `candidateName`, `voteCount`, `voteIds`, `tokenHashes`, `tokenRoot`, `commitmentRoot`, `receiptRoot`, `bucketAuditHash` |
| `validVoteIds` | Exact exported set of votes accepted into tally and buckets |
| `invalidVoteIds` | Exact exported set of rejected votes, equal to diagnostic vote ids |
| `invalidVoteDiagnostics[]` | Per-vote evidence with `voteId`, optional `userIdHash`, `tokenHash`, `reason`, `detail`, `evidenceHash` |
| `partitionHash` | Hash binding all bucket audit hashes and partition flags |
| `diagnosticsHash` | Hash binding the stable diagnostic array |
| `publicInputHints` | `electionIdHash`, `candidateCount`, `validVotes`, `tallyHash`, `commitmentRoot`, `receiptRoot`, `partitionHash`, `diagnosticsHash`, optional `pedersenAggregateHash` |
| `proofStatus` | A exports `not-generated` until B-track supplies a tally correctness proof |
| `tallyProofSummary` | Reserved B-track proof summary object; in A-only exports this has `proofStatus=not-generated`, `proofId=null`, and `publicSignals=null` |
| `integrityCheck` | Machine-readable recomputation result returned by run/report/export endpoints |

Allowed invalid diagnostic reasons:

- `duplicate-token`
- `invalid-candidate`
- `invalid-one-hot`
- `candidate-vector-mismatch`
- `commitment-opening-failed`
- `receipt-chain-break`

Backend API endpoints:

- `POST /aggregator/elections/:id/run`
- `GET /aggregator/elections/:id/report`
- `GET /elections/:id/export-bundle`
- `GET /elections/:id/export/aggregator_report.json`
- `GET /elections/:id/export/public_inputs.json`
- `POST /attack/elections/:id/inject-duplicate-vote`
- `POST /attack/elections/:id/inject-invalid-vote`
- `POST /attack/elections/:id/inject-non-one-hot-vote`
- `POST /attack/elections/:id/inject-candidate-vector-mismatch`
- `POST /attack/elections/:id/tamper-commitment`
- `POST /attack/elections/:id/delete-vote`

Acceptance commands:

```bash
pnpm aggregator:audit-cases
pnpm aggregator:verify
pnpm aggregator:api-smoke
pnpm aggregator:complete
```

The evidence generator also writes `docs/evaluation/aggregator_reports/aggregator_report.attack-*.json`
compatibility files for the A.5 attack-output naming convention.

## B: TallyProof V2 Binding Inputs

A provides `publicInputHints` and `public_inputs_v2.sample.json` so B can bind
tally proof metadata to the report without waiting for the live API.
A does not wait for proof generation: `AggregatorReport.proofStatus` and
`tallyProofSummary.proofStatus` remain `not-generated` in A-track samples and
API exports until B replaces them with generated proof metadata.

Required A-provided fields for B:

- `electionIdHash`
- `candidateCount`
- `validVotes`
- `tallyHash`
- `commitmentRoot`
- `receiptRoot`
- `partitionHash`
- `diagnosticsHash`
- `pedersenAggregateHash` or `null`

## C: Pedersen Aggregate Handoff

A accepts `pedersenAggregateAudit` as `null` or a complete audit object and binds
`pedersenAggregateStatus` plus `pedersenAggregateHash` into `auditHash`. Valid
vote selection is the diagnostics-free set exported as `validVoteIds`.
`docs/contracts/aggregator_report_pedersen_null.sample.json` is the explicit
C-track-not-ready sample proving the `pending`/null state is still hash-bound.

## D: UI/Export Handoff

D can render the aggregator and audit pages from either the API or these samples:

- `docs/contracts/export_bundle_v2.sample.json`
- Normal and attack reports under `docs/evaluation/aggregator_reports`
- `docs/evaluation/aggregator_reports/summary.json`
- `docs/evaluation/aggregator_reports/offline_verification.json`
- `docs/evaluation/aggregator_reports/api_smoke.json`
- `docs/evaluation/AGGREGATOR_AUDIT_HANDOFF.md`

`ExportBundleV2` contains `envelope`, `election`, `publicInputs`,
`bulletinBoard`, `aggregatorReport`, `zkSummary`, `tallyProofSummary`,
`chainAudit`, `challengeRecords`, and `demoMetadata`.

Boundary wording:

Use "Aggios-inspired partition audit surface." Do not claim complete EPA or
production privacy proof.
