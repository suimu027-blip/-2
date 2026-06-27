# VeriVote Demo Script

## 10-minute main flow

1. Start API and Web.
   ```bash
   corepack pnpm install
   corepack pnpm dev
   ```
2. Optional one-command seed after API is ready.
   ```bash
   corepack pnpm demo:seed
   ```
3. Open the Web console and enter Admin & Audit Console.
4. Use Create Election if not using the seed. Create 4 candidates and register 8 users.
5. Cast 8 votes or use `pnpm demo:seed`.
6. Open Bulletin Board, finalize the election, and show Merkle root plus receipt chain.
7. Open Aggregator, run the aggregator, and show validVotes, duplicateVotes, partition pending/sample state, and auditHash.
8. Open Audit Report, show tallyConsistent and diagnostics.
9. Open Tally ZK, generate a valid 8x4 proof or load the v2 sample proof.
10. Open Chain Audit, submit/query chain summary or load the real-hardhat sample.
11. Open Artifact Export, download bundle v2 and show the security checklist.

## 3-minute attack flow

1. Open Attack Lab and choose the current election.
2. Run `Inject duplicate vote`.
3. Return to Aggregator and run aggregator again. Expected: duplicateVotes is non-zero.
4. Run `Tamper tally`.
5. Return to Audit Report. Expected: tallyConsistent is false.
6. Run `Delete vote`.
7. Return to Bulletin Board or Audit Report. Expected: receipt chain verification fails.

## Backup path

If API state is not ready, use these fixture buttons:

- Aggregator: Load v2 sample.
- Audit Report: Load v2 sample.
- Tally ZK: Load v2 sample proof.
- Chain Audit: Load real-hardhat sample.
- Artifact Export: Preview or download `export_bundle_v2.sample.json`.

Do not claim local-mock as a real on-chain verifier. Say it is a demo chain or fixture path unless Hardhat mode was used.
