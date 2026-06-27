# VeriVote Real ZK Demo

## Goal

This demo connects the real Circom/snarkjs proof path to VeriVote while keeping
mock adapters available for local UI and fallback testing.

The real paths now cover:

- `circuits/valid_vote.circom`: fixed four-candidate single-ballot one-hot proof
- `circuits/tally_correctness.circom`: fixed 8x4 tally correctness proof
- `contracts/TallyVerifier.sol`: generated Groth16 verifier for the tally circuit
- `VeriVoteAudit.submitAuditWithTallyProof`: Hardhat chain submission with verifier call

## Commands

```bash
pnpm zk:setup
pnpm zk:samples
pnpm zk:demo
pnpm zk:audit
pnpm contract:test
```

`pnpm zk:setup` compiles both circuits, runs the local trusted setup, writes
`zk-artifacts/`, and exports `contracts/TallyVerifier.sol`.

`pnpm zk:samples` regenerates the contract-facing fixtures in `docs/contracts`:

- `valid_vote_records_8x4.sample.json`
- `aggregator_report_v2.sample.json`
- `tally_proof_v2.valid.sample.json`
- `tally_proof_v2.invalid-tally.sample.json`
- `calldata.sample.json`

`pnpm --filter @verivote/contracts run sample:chain-audit` writes
`docs/contracts/chain_audit.real.sample.json`.

## Valid Vote Circuit

`valid_vote.circom` proves:

```text
voteVector length = 4
vi * (vi - 1) = 0
v0 + v1 + v2 + v3 = 1
```

Current boundary: `voteVector` is public in this teaching/demo circuit. The
private version should expose a commitment as public signal instead.

## Tally Circuit

`tally_correctness.circom` proves:

```text
N = 8 padded rows
C = 4 candidates
public signals = [tally[0], tally[1], tally[2], tally[3], batchSize]
```

Short batches are padded with ghost rows and `realRows=0`. More than eight
effective votes must be split into batches before proving.

## Chain Verifier

The generated `TallyVerifier.sol` is a real Groth16 verifier for the tally
circuit. It implements the `ITallyVerifier` shape:

```solidity
verifyProof(uint256[2], uint256[2][2], uint256[2], uint256[5])
```

Hardhat tests cover:

- valid real calldata accepted
- tampered public input rejected
- tampered proof rejected
- all-zero proof rejected
- duplicate tally-proof submission rejected

## Report Binding

The circuit's Solidity public inputs stay at five values. The API binds the
proof to the current AggregatorReport before any chain submission:

- `proofHash`
- `electionIdHash`
- `tally`
- `batchSize`
- `tallyHash`
- `commitmentRoot`
- `partitionHash`
- `verifierMode`

`MockTallyVerifier` and `local-mock` are demo/fallback paths only. They must not
be described as real on-chain ZK verification.

## Remaining Boundaries

1. The single-ballot valid-vote circuit is not privacy-preserving yet.
2. The tally circuit is fixed to 8 rows and 4 candidates.
3. The local trusted setup is for demo evidence, not a production ceremony.
4. Moving report metadata into Solidity public signals requires a new circuit
   and a new verifier ABI beyond `uint256[5]`.
