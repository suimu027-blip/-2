# On-chain Tally Verifier

The chain path has three explicit modes.

## Mock

`MockTallyVerifier` is a test contract with a configurable boolean. It is used
by unit tests and quick demos. It is not a real ZK verifier.

## Local Mock

`BLOCKCHAIN_AUDIT_MODE=local-mock`

The API stores an audit record in memory and marks `zkVerified=true` only after
real Groth16 TallyProof v2 binding checks and local verification pass. No
Solidity verifier is called.

## Real Hardhat

`BLOCKCHAIN_AUDIT_MODE=hardhat`

The API requires:

- `proofMode=real`
- `verifierMode=real-hardhat`
- `verifyTallyCorrectnessProof(...)` passing locally
- `verifyTallyProofAgainstReport(...)` passing against the current report

Then it encodes `a, b, c, input` and calls:

```solidity
submitAuditWithTallyProof(
  electionId,
  merkleRoot,
  commitmentRoot,
  receiptRoot,
  auditHash,
  tallyHash,
  a,
  b,
  c,
  input
)
```

The configured `ITallyVerifier` must accept `uint256[5] input` with this layout:

```text
[tally[0], tally[1], tally[2], tally[3], batchSize]
```

## Commands

Generate circuits, zkeys, verification keys, and `contracts/TallyVerifier.sol`:

```bash
pnpm zk:setup
```

Deploy the real verifier and a `VeriVoteAudit` wired to that verifier:

```bash
pnpm contract:node
pnpm contract:deploy:tally-verifier
```

The script prints both addresses and the API env vars:

```text
BLOCKCHAIN_AUDIT_MODE=hardhat
VERIVOTE_TALLY_VERIFIER_ADDRESS=0x...
AUDIT_CONTRACT_ADDRESS=0x...
```

Run contract tests:

```bash
pnpm contract:test
```

Run the report/proof binding red-team checks:

```bash
pnpm zk:audit
```

`pnpm contract:test` defaults to `docs/contracts/calldata.sample.json` for the
real-verifier tests. Set `VERIVOTE_REAL_TALLY_CALLDATA_JSON` only when you want
to test a different calldata fixture.

The real tests cover valid calldata, tampered public input, tampered proof, and
all-zero proof rejection.

## Security Boundary

The Solidity verifier currently checks only the Groth16 public signals
`[tally[0..3], batchSize]`. Report binding is enforced by the API with
`proofHash`, `electionIdHash`, `tallyHash`, `commitmentRoot`, and
`partitionHash`.

Do not describe local-mock or `MockTallyVerifier` runs as real on-chain ZK
verification. Only the Hardhat path with generated `TallyVerifier.sol` exercises
the Groth16 verifier on-chain.

`proofMode=mock` is allowed only for local fixture/UI checks. It is rejected by
`submit-audit-with-tally-proof` and must not produce a `zkVerified=true` audit.
