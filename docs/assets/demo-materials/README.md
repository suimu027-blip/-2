# Demo Materials Directory

Use this directory for competition handoff assets. Keep generated artifacts grouped by flow.

| Directory | Contents |
| --- | --- |
| `normal-flow/` | Main demo screenshots and short clips |
| `attack-matrix/` | Attack run screenshots and before/after JSON |
| `zk-chain/` | Tally proof, calldata, verifier, transaction screenshots |
| `export-bundle/` | Downloaded bundle JSON and bundle preview screenshots |
| `benchmark/` | Raw benchmark terminal captures and CSV/JSON copies |

Recommended commands:

```bash
corepack pnpm demo:seed
corepack pnpm benchmark
corepack pnpm zk:demo
corepack pnpm contract:test
```

Do not commit private keys or `.env` files. If screenshots contain secrets, crop or regenerate them.
