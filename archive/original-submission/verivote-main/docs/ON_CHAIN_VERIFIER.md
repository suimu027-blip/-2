# 链上 ZK Verifier（Solidity）挂接指南

> 本文档解释 VeriVote 怎么把 `tally_correctness.circom` 生成的 Groth16 证明
> **在以太坊智能合约里真正被验证**，把原来「链上只存 hash、审计员自己跑 zk verify」
> 的 Zeeperio-style 闭环推到「链上合约替所有验证者自动检查」。

## 1. 总览

```
circom circuit                 snarkjs zkey         Solidity TallyVerifier.sol
  (tally_correctness.circom) ───▶ final.zkey ───▶     (auto-generated)
                                                             │
                                                             ▼
                                                   VeriVoteAudit
                                                   └─ submitAuditWithTallyProof(..., a, b, c, input)
                                                        │ 委托调用
                                                        ▼
                                                   ITallyVerifier.verifyProof(a, b, c, input)
```

三个关键组件：

- `contracts/VeriVoteAudit.sol`：保留原 `submitAudit`，另加 `submitAuditWithTallyProof`。构造器接收 verifier 地址，管理员可通过 `setTallyVerifier` 轮换。
- `contracts/ITallyVerifier.sol`：和 snarkjs Solidity 模板一致的 `verifyProof` 接口，把 `VeriVoteAudit` 与真实 / Mock verifier 解耦。
- `contracts/TallyVerifier.sol`（**gitignored**）：由 `pnpm zk:setup` 自动生成，内容就是 snarkjs 对 `tally_correctness_final.zkey` 的 solidityverifier 导出。我们会自动把默认的 `Groth16Verifier` 改名为 `TallyVerifier` 以避免命名冲突。
- `contracts/MockTallyVerifier.sol`：测试用，`shouldVerify` 可手动切换，便于 Hardhat 测试覆盖 accept / reject / 轮换 verifier 等路径。

## 2. 本地一键跑通

```bash
# 1) 安装依赖
pnpm install

# 2) 生成电路 + zkey + verification_key + 自动写入 contracts/TallyVerifier.sol
pnpm zk:setup

# 3) 编译并测试合约（包括新增的 tally-proof 路径）
pnpm contract:compile
pnpm contract:test

# 4) 起本地 hardhat 节点
pnpm contract:node        # 终端 A

# 5) 部署 VeriVoteAudit（默认同时部署一个 MockTallyVerifier；
#    如果你想直接使用真实 TallyVerifier，请先单独部署它再设置
#    VERIVOTE_TALLY_VERIFIER_ADDRESS 环境变量）
pnpm contract:deploy      # 终端 B

# 输出示例：
#   MockTallyVerifier deployed to: 0x...
#   VeriVoteAudit deployed to: 0x...
#   BLOCKCHAIN_AUDIT_MODE=hardhat
#   AUDIT_CONTRACT_ADDRESS=0x...
#   VERIVOTE_TALLY_VERIFIER_ADDRESS=0x...

# 6) 起 API
BLOCKCHAIN_AUDIT_MODE=hardhat \
AUDIT_CONTRACT_ADDRESS=0x... \
pnpm dev:api

# 7) 在前端 admin portal 打开「Tally ZK」页：
#    - 生成 tally proof
#    - 点击「提交到链上 (submitAuditWithTallyProof)」
#    - 查看 audit 记录 zkVerified=true
```

## 3. 端到端数据流

1. API 收到 `POST /blockchain/elections/:id/submit-audit-with-tally-proof`，请求体含前一步 `/zk/prove-tally-correctness` 的响应。
2. `encodeTallySolidityCalldata(proof)` 把 snarkjs `pi_a / pi_b / pi_c` 转换成 Solidity 需要的 `uint256[2] a, uint256[2][2] b, uint256[2] c`；注意 `pi_b` 每个内层 pair 要反转，与 snarkjs 生成的 verifier 一致。
3. API 组装 `electionIdHash / merkleRoot / commitmentRoot / receiptRoot / auditHash / tallyHash` 六个 `bytes32`，连同 `(a, b, c, input)` 一起发 `submitAuditWithTallyProof(...)`。
4. 合约调用 `ITallyVerifier(tallyVerifier).verifyProof(...)`：
   - 真 verifier 会在链上执行 Groth16 两个 pairing check；失败直接 revert `TallyProofRejected`。
   - `MockTallyVerifier` 只读 `shouldVerify` 字段。
5. 通过后写入 `AuditRecord{ ..., zkVerified: true }` 并触发 `AuditSubmitted(..., zkVerified = true)` 事件。

## 4. 对外 API

### `POST /blockchain/elections/:id/submit-audit-with-tally-proof`

请求：

```json
{
  "tallyProofResponse": {
    "proofId": "zkp_tally_...",
    "publicSignals": { "tally": [2,2,2,2], "batchSize": 8, ... },
    "proof": { "protocol": "verivote-tally-correctness-groth16-v1", ... },
    "valid": true,
    "message": "..."
  }
}
```

响应：

```json
{
  "election": { ... },
  "audit": {
    "transactionHash": "0x...",
    "zkVerified": true,
    "auditMode": "hardhat",
    "status": "submitted",
    ...
  },
  "submittedFields": { ... },
  "duplicatePolicy": "reject",
  "zkVerified": true,
  "message": "Hardhat Audit 已提交审计摘要，并通过链上 Groth16 Tally Verifier 验证。"
}
```

当 `BLOCKCHAIN_AUDIT_MODE=local-mock` 时，该接口只写内存并标记 `zkVerified=true`（不真的上链），用于离线演示；评委演示 **必须切到 hardhat 模式** 才能证明链上合约真的做了 Groth16 验证。

## 5. 为什么 verifier 合约不进仓库

`contracts/TallyVerifier.sol` 被加入 `.gitignore`：

- 每次 trusted setup 都会产生一个**新的** zkey，对应的 verifier 里的曲线常数会变。代码入库反而会让 verifier 与现场 zkey 不一致。
- 真正的部署 ceremony 会把 zkey 固定，然后单独提交一份 audit-quality verifier 到合约仓库。这是生产流程，和 demo 流程区分开。
- 作为兜底，如果开发者从未跑 `pnpm zk:setup` 就直接 `pnpm contract:deploy`，`deploy-audit.ts` 会自动部署 `MockTallyVerifier` 保持 demo 可跑。

## 6. 安全清单

- `VeriVoteAudit.admin` 只在构造时设置；`setTallyVerifier` 仅 admin 可调。生产部署请把 admin 放在多签地址。
- `ITallyVerifier` 的 5 个 public inputs 对应 `[tally[0..3], batchSize]`。如果以后扩充电路（更多候选人 / 不同 batch size），接口的 `uint[5]` 也要同步更新，否则会产生 calldata 错位。
- 合约不会自己校验 `electionId`/`auditHash` 与 public signals 之间的对应关系。API 侧会绑定，但链上层面仍可被恶意 submitter 塞一个与 proof 无关的 `electionId`。未来迭代应把 `electionIdHash` 也塞进电路 publicSignals 强绑定。
- `AlreadySubmitted` 是 per-`electionId` 一次写入。重提交需要新选举 ID。
- 提交交易若回退（verifier 拒绝 / 已提交过），API 会返回 500 + 错误信息，前端提示评委调试。

## 7. 仍待办

- 把 `electionIdHash` 作为 circuit public input 绑定，杜绝 `electionId` 与 proof 解耦的威胁。
- 把 `valid_vote` 电路也导出 Solidity verifier（`ValidVoteVerifier.sol`），提供 `submitAuditWithBallotProof` 单票路径。
- 接入 Pedersen 聚合：链上合约额外保存 `aggregatedCommitment` 并在 verifier 之外做同态校验。
- gas benchmark：`contract:test` 加 `REPORT_GAS=true` 走 `hardhat-gas-reporter`，把链上 verify 耗费的 gas 列进 `docs/BENCHMARK.md`。
