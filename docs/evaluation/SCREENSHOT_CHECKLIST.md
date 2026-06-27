# Screenshot Checklist

Store screenshots under `docs/assets/demo-materials/` with the filename shown here.

| File | Page | Action | Security property |
| --- | --- | --- | --- |
| `normal-flow/01-platform-home.png` | Home | Open Web console | Voter/Admin split entry |
| `normal-flow/02-bulletin-board.png` | Bulletin Board | Finalize election | Public commitments, receipts, Merkle root |
| `normal-flow/03-aggregator-v2.png` | Aggregator | Run aggregator or load v2 sample | Valid/invalid/duplicate count and partition audit |
| `normal-flow/04-audit-report.png` | Audit Report | Query report | tallyConsistent and diagnostics |
| `zk-chain/01-tally-zk-proof.png` | Tally ZK | Generate proof or load sample proof | proofMode, verifierMode, public signals |
| `zk-chain/02-chain-audit.png` | Chain Audit | Query/submit audit or load sample | tx hash, contract address, zkVerified, gasUsed |
| `export-bundle/01-export-bundle-v2.png` | Artifact Export | Preview bundle v2 | schemaVersion, bundleHash, checklist |
| `attack-matrix/01-attack-matrix.png` | Attack Lab | Show matrix | Attack to artifact mapping |
| `attack-matrix/02-duplicate-detected.png` | Aggregator | After duplicate injection | duplicateVotes > 0 |
| `attack-matrix/03-tally-tamper-detected.png` | Audit Report | After tally tamper | tallyConsistent=false |
| `normal-flow/05-challenge-success.png` | Challenge Audit | prepare -> challenge | Opening public, not counted in tally |
| `normal-flow/06-cast-state-locked.png` | Challenge Audit | prepare -> cast | Cast ballot cannot be challenged later |
| `normal-flow/07-pedersen-aggregate.png` | Pedersen Experiment | aggregate verify or load sample | Pedersen aggregate status/hash |
| `benchmark/01-performance-page.png` | Performance | Open benchmark page | Local benchmark overview |

For real verifier screenshots, include terminal captures for:

- `corepack pnpm contract:node`
- `corepack pnpm contract:deploy`
- `BLOCKCHAIN_AUDIT_MODE=hardhat`
- transaction hash and gas output
