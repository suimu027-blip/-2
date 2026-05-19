# VeriVote Circuits

This directory contains the first real ZK proof demo circuit for VeriVote.

## `valid_vote.circom`

`valid_vote.circom` proves that a fixed-length `voteVector` with four entries is a legal one-hot vote:

1. Every element is a bit: `vi * (vi - 1) = 0`.
2. The sum is exactly one: `v0 + v1 + v2 + v3 = 1`.

The current demo marks `voteVector` as a public input so the command-line verifier proves that this specific vector is legal. A later privacy-preserving integration should make the vote private and expose a commitment instead.

Run the demo from the repository root:

```bash
pnpm zk:demo
```

The demo requires:

1. `snarkjs`, installed through the workspace dev dependencies.
2. A Circom 2 compiler available as `circom` on `PATH`.
