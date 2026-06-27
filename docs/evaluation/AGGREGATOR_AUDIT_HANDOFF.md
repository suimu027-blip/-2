# Aggregator Audit Handoff

This is the A-track handoff for D and the final report owner. It summarizes
what to show, which evidence file proves it, and the wording boundary.

## Evidence Files

| File | Use |
| --- | --- |
| `docs/contracts/VERIVOTE_PARALLEL_INTERFACE_CONTRACT.md` | Frozen A/B/C/D field contract |
| `docs/contracts/demo_seed_fixture.json` | Minimal 4-candidate/8-vote seed plan for independent demos |
| `docs/contracts/aggregator_report_v2.sample.json` | Stable normal AggregatorReport v2 sample |
| `docs/contracts/aggregator_report.sample.json` | Compatibility alias for the day-0 sample filename |
| `docs/contracts/aggregator_report_pedersen_null.sample.json` | C-track-not-ready sample with `pedersenAggregateStatus=pending`, Pedersen aggregate fields null, and integrity verified |
| `docs/contracts/export_bundle_v2.sample.json` | Full ExportBundleV2 with proof placeholder, chain audit, and demo metadata |
| `docs/contracts/public_inputs_v2.sample.json` | Public input sample bound to the report |
| `docs/evaluation/aggregator_reports/summary.json` | Normal/attack case summary |
| `docs/evaluation/aggregator_reports/offline_verification.json` | Offline recomputation, constructed tamper rejection, and saved API tamper-report rejection |
| `docs/evaluation/aggregator_reports/api_smoke.json` | HTTP run/report/export/attack and SQLite restart evidence |
| `docs/evaluation/aggregator_reports/api_export_aggregator_report.json` | Raw HTTP AggregatorReport export |
| `docs/evaluation/aggregator_reports/api_export_public_inputs.json` | Raw HTTP public inputs export |
| `docs/evaluation/aggregator_reports/api_export_bundle.json` | Raw HTTP ExportBundleV2 export |
| `docs/evaluation/aggregator_reports/api_aggregator_report.attack-tamper-tally.json` | Saved-report tally tamper negative case, rechecked by `pnpm aggregator:verify` |
| `docs/evaluation/aggregator_reports/local_standalone/manifest.json` | No-server local export manifest |
| `docs/evaluation/aggregator_reports/local_standalone/aggregator_report.local-normal.json` | No-server AggregatorReport v2 export |
| `docs/evaluation/aggregator_reports/local_standalone/public_inputs.local-normal.json` | No-server public inputs export |
| `docs/evaluation/aggregator_reports/local_standalone/export_bundle.local-normal.json` | No-server ExportBundleV2 export |
| `docs/evaluation/aggregator_reports/powershell_api/manifest.json` | PowerShell API smoke manifest |
| `docs/evaluation/aggregator_reports/powershell_api/aggregator_report.normal.json` | PowerShell-saved normal AggregatorReport v2 |
| `docs/evaluation/aggregator_reports/powershell_api/aggregator_report.attack-*.json` | PowerShell-saved attack AggregatorReport v2 files |
| `docs/evaluation/aggregator_reports/powershell_api/public_inputs.normal.json` | PowerShell-saved public inputs |
| `docs/evaluation/aggregator_reports/powershell_api/export_bundle.normal.json` | PowerShell-saved ExportBundleV2 |
| `docs/evaluation/aggregator_reports/python_api_smoke.json` | Python/FastAPI parity smoke for A-track v2 outputs |
| `docs/evaluation/aggregator_reports/python_api_aggregator_report.json` | Raw Python API AggregatorReport v2 response |
| `docs/evaluation/aggregator_reports/python_api_public_inputs.json` | Raw Python API public inputs v2 response |
| `docs/evaluation/aggregator_reports/python_api_export_bundle.json` | Raw Python API ExportBundleV2 response |
| `docs/evaluation/aggregator_reports/api_schema_parity.json` | TypeScript/Python API schema parity for report/public inputs/bundle |
| `docs/evaluation/aggregator_reports/task_a_traceability.json` | A-01 to A-20 source/evidence/command/API traceability |
| `docs/evaluation/aggregator_reports/completeness_matrix.json` | A-track gate including frontend v2 evidence-surface checks |
| `docs/evaluation/AGGREGATOR_AUDIT_CASES.md` | A-track acceptance record |

Attack reports are available under both `aggregator_report.<case>.json` and
`aggregator_report.attack-<case>.json` so A.5 consumers can use the documented
attack-output naming convention directly.

## Failure Reason Copy

| Reason | Short UI text | What it proves |
| --- | --- | --- |
| `duplicate-token` | Duplicate voter token rejected | Double voting is detected before tallying |
| `invalid-candidate` | Candidate is not registered for this election | Votes cannot target unknown candidates |
| `invalid-one-hot` | Vote vector is not exactly one selected candidate | Malformed multi-select or empty-select ballots are rejected |
| `candidate-vector-mismatch` | Candidate id and vote vector disagree | A valid-looking candidate id cannot mask a different vector choice |
| `commitment-opening-failed` | Commitment opening does not match stored commitment | Tampered commitment data is excluded from tally |
| `receipt-chain-break` | Receipt chain continuity failed | Deleted or modified receipt-chain entries are surfaced |

## Screenshot Checklist

| Screenshot | Page or command | Expected signal |
| --- | --- | --- |
| `a01-aggregator-normal.png` | Aggregator run/report for normal case | `integrityCheck.verified=true`, `validVotes=8`, `invalidVotes=0` |
| `a02-partition-buckets.png` | Aggregator partition bucket table | Candidate buckets show vote counts, roots, `partitionHash` |
| `a03-duplicate-diagnostic.png` | Attack duplicate vote then run aggregator | `duplicate-token`, `duplicateVotes>0`, invalid vote absent from buckets |
| `a04-invalid-candidate.png` | Attack invalid candidate then run aggregator | `invalid-candidate`, invalid vote absent from buckets |
| `a05-non-one-hot.png` | Attack non-one-hot then run aggregator | `invalid-one-hot` diagnostic |
| `a06-vector-mismatch.png` | Attack candidate-vector mismatch then run aggregator | `candidate-vector-mismatch` diagnostic |
| `a07-commitment-tamper.png` | Tamper commitment then run aggregator | `commitment-opening-failed` and receipt-chain evidence |
| `a08-receipt-delete.png` | Delete first vote then run aggregator | `receiptChainVerified=false`, `receipt-chain-break` |
| `a08b-tally-tamper.png` | `tamper-tally` after generating a report | `auditHashMatches=true` but `integrityCheck.verified=false`, `bucketTallyMatches=false`, `tallyConsistent=false` |
| `a09-api-smoke.png` | `pnpm aggregator:api-smoke` output | HTTP and SQLite persistence gates pass |
| `a10-export-public-inputs.png` | Export `public_inputs.json` | `partitionHash`, `diagnosticsHash`, `auditHash` bind the report |
| `a11-export-bundle.png` | Export `/elections/:id/export-bundle` | `tallyProofSummary.proofStatus=not-generated`, `demoMetadata` present |
| `a12-proof-pedersen-panel.png` | Aggregator or audit report page | `proofStatus`, `tallyProofSummary`, `pedersenAggregateStatus`, and Pedersen audit/null state are visible |
| `a13-voteid-publicinputs-panel.png` | Aggregator or audit report page | `validVoteIds`, `invalidVoteIds`, `tokenHashes`, and `publicInputHints.*` are visible |
| `a14-local-export.png` | `pnpm aggregator:local-export` output | Local no-server export writes report/public inputs/bundle and manifest |
| `a15-powershell-api-smoke.png` | `pnpm aggregator:ps-smoke` output with API running | PowerShell Invoke-RestMethod path writes normal/attack reports, public inputs, bundle, and manifest |

## Report Wording

Safe wording:

"The A track implements an Aggios-inspired partition audit surface. The
AggregatorReport v2 separates valid and invalid votes, exports per-candidate
partition buckets, binds diagnostics and partition evidence into hashes, and
provides offline and HTTP smoke evidence for normal and attack cases, including
offline re-verification of the saved API tally-tamper report. It also
exports `proofStatus=not-generated` and a full ExportBundleV2 so B/D can work
without blocking on proof generation. The same A-track report can be generated
through `pnpm aggregator:local-export` without starting the API server."

Do not say:

- "Complete Aggios EPA implementation"
- "Production privacy proof"
- "All election verification is on-chain"
- "Mock/local evidence is a real chain verifier"
