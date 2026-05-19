# VeriVote ZK Validity Proof

## 1. Module Goal

This module proves that a single `voteVector` is a legal one-hot vote: exactly one candidate is selected.

The current VeriVote ZK page and API support two proof modes:

1. `mock`: the original lightweight adapter, useful when Circom artifacts are not available.
2. `real`: a Groth16 proof generated from `circuits/valid_vote.circom` through snarkjs.

This stage still does not prove full tally correctness, does not implement a Zeeperio-style full election verifier, and does not replace the normal voting flow.

## 2. One-Hot Constraints

For the general mock adapter:

1. Each entry must be `0` or `1`.
2. The sum of all entries must be `1`.
3. `voteVector.length` must equal `candidateCount`.

For the first real Groth16 circuit:

```text
voteVector length = 4
vi * (vi - 1) = 0
v0 + v1 + v2 + v3 = 1
```

Expected behavior:

```text
[1,0,0,0] -> valid / verified true
[0,1,0,0] -> valid / verified true
[1,1,0,0] -> valid / verified false
[0,0,0,0] -> valid / verified false
[2,0,0,0] -> valid / verified false
```

## 3. proofMode

### Mock ZK Validity Proof

`proofMode = "mock"` keeps the original behavior. It recomputes the one-hot constraints in TypeScript and verifies that the mock proof, public signals, and proof hash match. It is not a real zero-knowledge proof, but it does not simply return true.

### Real Groth16 ZK Proof

`proofMode = "real"` uses:

```text
circuits/valid_vote.circom
zk-artifacts/valid-vote/valid_vote_js/valid_vote.wasm
zk-artifacts/valid-vote/valid_vote_js/generate_witness.js
zk-artifacts/valid-vote/valid_vote_final.zkey
zk-artifacts/valid-vote/verification_key.json
```

Run setup before starting the API in real mode:

```bash
pnpm zk:setup
```

API requests do not run trusted setup. They only generate a witness/proof from existing artifacts and verify it with the existing verification key.

If artifacts are missing, the API returns a clear invalid result or error message telling the operator to run `pnpm zk:setup`; the service should not crash.

## 4. API

### POST `/zk/prove-vote-validity`

Request:

```json
{
  "electionId": "election_1",
  "voteVector": [1, 0, 0, 0],
  "candidateCount": 4,
  "proofMode": "real"
}
```

`proofMode` is optional and defaults to `mock`.

Response includes:

```json
{
  "proofId": "zkp_...",
  "proofMode": "real",
  "publicSignals": {
    "electionIdHash": "...",
    "candidateCount": 4,
    "voteVectorCommitment": "..."
  },
  "proof": {
    "protocol": "verivote-one-hot-validity-groth16-v1",
    "snarkjsProof": {},
    "snarkjsPublicSignals": []
  },
  "valid": true,
  "message": "Real Groth16 ZK proof generated and verified"
}
```

For an invalid vector in real mode, witness generation fails and the response returns `valid=false` with a proof wrapper that can still be sent to the verify endpoint, which returns `verified=false`.

### POST `/zk/verify-vote-validity`

Request:

```json
{
  "proof": {},
  "publicSignals": {
    "electionIdHash": "...",
    "candidateCount": 4,
    "voteVectorCommitment": "..."
  }
}
```

The verifier chooses mock or real verification from `proof.proofMode`.

## 5. Frontend Flow

The `ZK 验证` page now has a `proofMode` selector:

1. Select `Mock ZK Validity Proof` or `Real Groth16 ZK Proof`.
2. Enter `electionId`, `candidateCount`, and `voteVector`.
3. Click `生成 ZK 合法性证明`.
4. Inspect `proofId`, `proofMode`, `publicSignals`, `proof`, `valid`, and `message`.
5. Click `验证证明`.
6. Inspect `verified` and the verify message.

For real mode, run `pnpm zk:setup` before starting the backend and frontend.

## 6. Relationship To The Paper Ideas

This implements a first ballot well-formedness proof: the system can prove that a vote is structurally legal before counting it. This is a small building block toward Zeeperio-style publicly verifiable election proofs, but it is not yet a full proof of tally correctness or a chain verifier.

## 7. Current Boundaries

1. The real circuit supports exactly four candidates.
2. `voteVector` is currently public in the circuit, so this is a correctness demo rather than a privacy-preserving final design.
3. The real adapter proves one ballot, not a full election tally.
4. Trusted setup is local demo setup and not production ceremony material.
5. No Solidity verifier is generated or deployed in this stage.
6. The mock adapter remains available and unchanged as a fallback/demo mode.

## 8. Next Steps

1. Make `voteVector` private and expose a public commitment.
2. Version the wasm/zkey/vkey artifacts deliberately.
3. Add configurable proof mode at deployment time.
4. Extend from single-ballot validity to batch validity.
5. Add tally correctness proofs.
6. Generate and test a Solidity verifier.
7. Explore aggregation and proof compression.
