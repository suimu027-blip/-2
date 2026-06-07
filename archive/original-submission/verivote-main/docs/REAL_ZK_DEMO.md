# VeriVote Real ZK Proof Demo

## 1. Goal

This demo connects the real Circom/snarkjs proof path to the existing VeriVote ZK validity module. It keeps the mock adapter, and adds a real Groth16 path for the fixed four-candidate `valid_vote.circom` circuit.

The real flow is available in:

1. `pnpm zk:setup`: compile circuit and generate persistent artifacts.
2. `pnpm zk:demo`: run CLI proof/verify tests using those artifacts.
3. `POST /zk/prove-vote-validity` with `proofMode = "real"`.
4. The frontend `ZK 验证` page with `Real Groth16 ZK Proof` selected.

## 2. Circom Constraints

Circuit:

```text
circuits/valid_vote.circom
```

Input:

```text
voteVector[4]
```

Constraints:

```text
vi * (vi - 1) = 0
v0 + v1 + v2 + v3 = 1
```

The current circuit marks `voteVector` as public input. This makes the demo easy to inspect, but it is not the final privacy-preserving design. A later circuit should keep the vote private and expose a commitment.

## 3. Setup

Install dependencies:

```bash
pnpm install
```

Install Circom 2 and make sure it is on `PATH`:

```bash
circom --version
```

Windows/Codex users can build Circom from the official repository with Rust:

```bash
git clone https://github.com/iden3/circom.git
cd circom
cargo build --release
```

Then add `target/release` to `PATH`.

Prepare persistent artifacts:

```bash
pnpm zk:setup
```

The setup script writes:

```text
zk-artifacts/valid-vote/valid_vote.r1cs
zk-artifacts/valid-vote/valid_vote_js/valid_vote.wasm
zk-artifacts/valid-vote/valid_vote_js/generate_witness.js
zk-artifacts/valid-vote/valid_vote_final.zkey
zk-artifacts/valid-vote/verification_key.json
```

`zk-artifacts/` is ignored by git because it contains generated proof artifacts.

## 4. CLI Demo

After setup:

```bash
pnpm zk:demo
```

Expected legal cases:

```text
[1,0,0,0] -> verified = true
[0,1,0,0] -> verified = true
```

Expected illegal cases:

```text
[1,1,0,0] -> verified = false
[0,0,0,0] -> verified = false
[2,0,0,0] -> verified = false
```

If artifacts are missing, `pnpm zk:demo` prints a clear message asking you to run `pnpm zk:setup`.

## 5. API And Frontend Demo

Start the stack after running setup:

```bash
pnpm dev:api
pnpm dev:web
```

Open the `ZK 验证` page and choose:

```text
Real Groth16 ZK Proof
```

The prove endpoint accepts:

```json
{
  "electionId": "election_1",
  "voteVector": [1, 0, 0, 0],
  "candidateCount": 4,
  "proofMode": "real"
}
```

The verify endpoint automatically detects real mode from:

```json
{
  "proofMode": "real"
}
```

inside the proof object.

## 6. Missing Artifact Behavior

The API does not run trusted setup per request. If `zk-artifacts/valid-vote/` is missing or incomplete, real mode returns a clear message:

```text
Real ZK artifacts are missing. Run pnpm zk:setup first.
```

The backend should keep running; mock mode remains available.

## 7. Current Boundaries

1. The real circuit is fixed to four candidates.
2. `voteVector` is public in this minimal demo.
3. Trusted setup is local and for demonstration only.
4. This proves ballot validity only, not tally correctness.
5. It does not generate a Solidity verifier.
6. It does not replace the mock adapter or normal voting flow.

## 8. Next Integration Steps

1. Add a private-witness circuit that exposes only `voteVectorCommitment`.
2. Store and version production-grade artifacts.
3. Add deployment configuration for selecting mock or real mode.
4. Extend to batch proof generation.
5. Prove tally correctness.
6. Generate a Solidity verifier and connect the chain audit path.
