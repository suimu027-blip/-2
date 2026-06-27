# Paper Mapping

## Aggios / Aggregator-Based Voting Using Proof Of Partition

VeriVote A-track implements an Aggios-inspired partition audit surface, not a full EPA implementation.

Implemented engineering surface:

- `AggregatorReport v2` exposes `partitionAudit`.
- Each candidate bucket contains `voteIds`, `tokenHashes`, `tokenRoot`, `commitmentRoot`, `receiptRoot`, and `bucketAuditHash`.
- Top-level `validVoteIds` and `invalidVoteIds` make the valid/invalid partition explicitly auditable, not only count-based.
- The report checks `coverComplete`, `disjoint`, `noDuplicateValidTokenHashes`, and `allValidVotesBucketed`.
- `invalidVoteDiagnostics` gives per-vote evidence for duplicate token, invalid candidate, non-one-hot vector, commitment opening failure, and receipt-chain breaks.
- `partitionHash` and `diagnosticsHash` are included in `auditHash` and `publicInputHints`.
- `integrityCheck` recomputes report hashes, bucket hashes, bucket token roots, diagnostics evidence hashes, vote-id accounting, duplicate-token diagnostics, receipt-chain status, and public input hints from the exported JSON.

Boundary:

- This is not a complete Aggios EPA circuit.
- It does not claim production-grade partition proof privacy.
- It is a contest prototype audit layer designed to make partition evidence independently reproducible through JSON artifacts and API responses.

## Zeeperio

VeriVote uses the Zeeperio idea as a local Hardhat/off-chain prover plus on-chain verifier demo. Real Groth16 proof samples and calldata are exported under `docs/contracts`.

Boundary:

- `mock` and `local-mock` verifier modes are demo modes.
- Only `real-hardhat` samples should be described as real Groth16 verifier demos.

## Haechi / Pedersen

VeriVote uses Pedersen-style commitments and cast-or-challenge flows as a Haechi-inspired module.

Boundary:

- Current code is a demonstrator, not a production in-person voting deployment.
- Server-side demo state may contain witness material and should not be described as production anonymity.
