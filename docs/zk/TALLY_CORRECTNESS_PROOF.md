# Tally Correctness Proof

This module proves a bounded batch tally for the demo circuit:

```text
N = 8 padded rows
C = 4 candidates
public signals = [tally[0], tally[1], tally[2], tally[3], batchSize]
```

The circuit now supports short batches with private `realRows[N]`.

- `voteVector[i]` is always one-hot.
- `realRows[i] = 1` means the row is a real ballot.
- `realRows[i] = 0` means the row is padding and does not contribute to tally.
- `batchSize == sum(realRows) == sum(tally)`.

The Solidity verifier signature remains compatible with `ITallyVerifier`:

```solidity
verifyProof(uint256[2], uint256[2][2], uint256[2], uint256[5])
```

## Modes

| Mode | Meaning | Real chain verification |
| --- | --- | --- |
| `proofMode=mock` | Local metadata/proofHash fixture path; cannot be submitted as `zkVerified` audit | No |
| `proofMode=real` + `verifierMode=local-mock` | Real Groth16 proof, local audit record without a Solidity call | No |
| `proofMode=real` + `verifierMode=real-hardhat` | Real Groth16 proof submitted to generated `TallyVerifier` | Yes |

Never describe `MockTallyVerifier` or `local-mock` as real on-chain ZK
verification.

## API Binding

The circuit proves arithmetic correctness of the public tally vector. The API
binds the proof to the current AggregatorReport before chain submission:

- `proofHash`
- `electionIdHash`
- `tally`
- `batchSize` / valid vote count
- `tallyHash`
- `commitmentRoot`
- `partitionHash`
- `verifierMode`

`validVotes`, `commitmentRoot`, and `partitionHash` must exist in the report
truth source. They cannot be silently replaced by `publicInputHints` or the
sentinel value `unavailable`; hints are checked only for consistency.

`partitionHash` is checked at the API binding layer from the AggregatorReport
truth source. It is not part of the five Solidity public inputs, so the current
circuit and verifier ABI remain `uint256[5]`.

## Endpoints

Manual proof:

```bash
POST /zk/prove-tally-correctness
```

Current election proof:

```bash
POST /zk/elections/:id/prove-tally-correctness
```

The election endpoint:

- requires 4 candidates
- accepts 0 to 8 effective valid votes
- rejects counted votes whose `voteVector` is not one-hot or does not match the
  vote's `candidateId` in the current candidate order
- rejects AggregatorReport tally rows whose candidate order or vote counts are
  malformed
- pads short batches with `realRows=0`
- rejects more than 8 votes and asks the caller to split into batches
- uses AggregatorReport metadata for API-layer proof/report binding

Verification:

```bash
POST /zk/verify-tally-correctness
```

Calldata export uses `encodeTallySolidityCalldata(validProof)`. The encoder is
not a blind formatter: it rejects stale `proofHash`, mismatched public signals,
and Groth16 proofs that fail local verification before returning `{a,b,c,input}`.

## Samples

Real samples generated after `pnpm zk:setup` live in `docs/contracts`:

- `valid_vote_records_8x4.sample.json`
- `aggregator_report_v2.sample.json`
- `tally_proof_v2.valid.sample.json`
- `tally_proof_v2.invalid-tally.sample.json`
- `calldata.sample.json`
- `chain_audit.real.sample.json`

The valid sample is a real Groth16 proof. The invalid sample deliberately uses a
tally that does not match the witness, so no proof is produced and `valid=false`.

## Reproduce

```bash
pnpm zk:setup
pnpm zk:samples
pnpm zk:demo
pnpm zk:audit
pnpm contract:compile
pnpm contract:test
```

## Boundary

`electionIdHash`, `tallyHash`, `commitmentRoot`, and `partitionHash` are not
arithmetic public signals in the current circuit. They are checked in the API
before any Hardhat submission. Moving those fields into the circuit later
requires changing the circuit public signal list and regenerating
`TallyVerifier.sol`.
