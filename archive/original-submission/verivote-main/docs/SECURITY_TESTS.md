# VeriVote 安全测试矩阵

> 本文档把三篇论文的安全目标、朋友项目已验证过的威胁路径和 VeriVote 当前工程实现统一成一张**可被评委逐行核对**的矩阵。每一行给出：攻击动作、期望检测模块、预期结果、验证方式、当前状态。
>
> 覆盖的八个核心威胁：
> 1. 重复投票
> 2. 非法票
> 3. 承诺篡改
> 4. 回执链断裂
> 5. Merkle 篡改
> 6. ZK 证明失败
> 7. 链上审计不一致
> 8. 挑战开口篡改
>
> 另外补上 Pedersen 聚合核查、tally 篡改等相关项。

## 0. 状态标记与缩写

- ✅ **covered**：工程实现 + 手动演示均可复现。
- 🟡 **implemented, needs auto test**：代码已实现检测路径，但尚无 vitest / playwright 自动测试。
- ⬜ **planned**：仅有文档和接口占位。
- API 路径省略 `http://localhost:3001` 前缀。

## 1. 威胁矩阵

### T1. 重复投票 (double voting)

| 字段 | 内容 |
| --- | --- |
| 攻击描述 | 同一 `userId` 在同一 `electionId` 内重复 `cast`；或 aggregator 环节注入 `voteTokenHash` 重复的票。 |
| 对应论文 | Aggios (545) no-double-voting / Haechi (613) one-ballot-per-voter |
| 检测模块 | (a) `POST /elections/:id/vote` 早期拒绝；(b) Aggregator `duplicateVotes` / `duplicateTokenHashes` |
| 预期结果 | 主流程：409 `该用户已经在本次选举中投过票`；聚合器：`duplicateVotes > 0`、`duplicateTokenHashes` 非空。 |
| 手动复现 | 对同一 `userId` 连续调用 `POST /elections/:id/vote` 两次；或 `POST /attack/elections/:id/inject-duplicate-vote` 再 `POST /aggregator/elections/:id/run`。 |
| 自动测试建议 | vitest 里对 Aggregator 函数 `createAggregatorReport` 传入两张相同 token 的票，断言 `duplicateVotes === 1`。 |
| 当前状态 | 🟡 |
| 残余风险 | `/users/register` 无身份限制，攻击者可注册大量 `userId` 绕过 tokenHash。见 `docs/ROADMAP.md` 「选民白名单 / 签名」。 |

### T2. 非法票 (invalid / overvote)

| 字段 | 内容 |
| --- | --- |
| 攻击描述 | `candidateId` 不存在、不属于当前 election；或 voteVector 不是合法 one-hot。 |
| 对应论文 | Haechi ballot well-formedness、Aggios partition validity |
| 检测模块 | (a) `POST /elections/:id/vote` 校验候选人归属；(b) Aggregator `invalidVotes`；(c) ZK 合法性证明电路 `v_i*(v_i-1)=0, Σv_i=1`。 |
| 预期结果 | 主流程 404 / 409；聚合器 `invalidVotes > 0`；ZK witness 生成失败或 verify=false。 |
| 手动复现 | `POST /attack/elections/:id/inject-invalid-vote` 再 `POST /aggregator/.../run`；或在 `/zk/prove-vote-validity` 提交 `[1,1,0,0]`。 |
| 自动测试建议 | 对 `circuits/valid_vote.circom` 生成 `[1,1,0,0]` 的 witness，断言失败；mock adapter 对应分支 `valid=false`。 |
| 当前状态 | 🟡 |
| 残余风险 | 当前 Real Groth16 固定 N=4。N≠4 的票只能走 mock 路径。 |

### T3. 承诺篡改 (commitment tamper)

| 字段 | 内容 |
| --- | --- |
| 攻击描述 | 发布/存储后有人直接把 `vote.commitment` 改成其他 hash。 |
| 对应论文 | Haechi commitment binding |
| 检测模块 | (a) Merkle proof 失败；(b) `receiptChainHash` 重算失败（chain hash 绑定了 commitment）；(c) 链上 `commitmentRoot` 对不上；(d) Aggregator `auditHash` 重算失败。 |
| 预期结果 | Bulletin `receiptChainVerified=false`、`verifyMerkleProof=false`、`tallyConsistent=false`。 |
| 手动复现 | `POST /attack/elections/:id/tamper-commitment` 再 `GET /elections/:id/bulletin`、`GET /receipts/:code/proof`、`GET /aggregator/.../report`。 |
| 自动测试建议 | crypto 层：手动改 `vote.commitment`，断言 `verifyReceiptChain` 返回 `verified=false`、断言 Merkle proof 不成立。 |
| 当前状态 | 🟡 |

### T4. 回执链断裂 (receipt chain break)

| 字段 | 内容 |
| --- | --- |
| 攻击描述 | 删除中间一张票 / 重排 votes / 改 `previousReceiptCodeHash` / 改 `receiptChainHash`。 |
| 对应论文 | Haechi confirmation code chain |
| 检测模块 | `packages/crypto` 的 `verifyReceiptChain()`；`BulletinBoard.receiptChainVerified` 和 `AggregatorReport.receiptChainVerified` 字段。 |
| 预期结果 | `verified=false` 且 `breaks[]` 给出 `reason`（如 `previousReceiptCodeHash does not match`、`duplicate receiptChainIndex`、`receiptChainHash does not match recomputed chain hash`）。 |
| 手动复现 | `POST /attack/elections/:id/delete-vote` 再 `GET /elections/:id/bulletin`、`POST /aggregator/.../run`。 |
| 自动测试建议 | crypto unit test：手工构造四种断裂（缺字段、重复 index、错 prev hash、错 chain hash），每种单独断言对应 `reason`。 |
| 当前状态 | 🟡 |

### T5. Merkle 篡改 (leaf / root tamper)

| 字段 | 内容 |
| --- | --- |
| 攻击描述 | 修改 bulletin 的 leaf、替换整个 `merkleRoot`、或在链上提交伪造的 Root。 |
| 对应论文 | Zeeperio public audit / Scantegrity-style receipt |
| 检测模块 | (a) `GET /receipts/:code/proof` 返回 `verifyResult=false`；(b) 链上 `merkleRoot` 与本地 bulletin root 不一致。 |
| 预期结果 | `verifyResult=false`；`chain_audit.merkleRoot !== bulletin.merkleRoot`。 |
| 手动复现 | 先 `POST /attack/elections/:id/tamper-commitment` 让 bulletin 重新计算；或手动篡改内存数组后刷新 bulletin。 |
| 自动测试建议 | crypto unit test：拿合法 `getMerkleProof()`，把 `proof[0].sibling` 改一位，断言 `verifyMerkleProof` 返回 false。 |
| 当前状态 | 🟡 |

### T6. ZK 证明失败 (proof malleation / wrong public signals)

| 字段 | 内容 |
| --- | --- |
| 攻击描述 | (a) 把合法 proof 的 `publicSignals.electionIdHash` 改成另一选举；(b) 把 `proof.voteVector` 改成非 one-hot；(c) 替换 snarkjsProof 的 curve point；(d) 丢失 artifacts。 |
| 对应论文 | Zeeperio / Groth16 soundness |
| 检测模块 | `verifyZkValidityProof()`（mock）/ `verifyRealZkValidityProof()`（real，snarkjs groth16 verify）。 |
| 预期结果 | `verified=false` + 具体 `message`（invalid proof shape / commitments do not match / proof was not generated / artifacts not found）。 |
| 手动复现 | 生成一个合法 proof，然后把 `publicSignals.voteVectorCommitment` 改一位再 POST `/zk/verify-vote-validity`。 |
| 自动测试建议 | zk unit test：三条路径各一个 case（mock 合法、mock 篡改、real missing-artifact 返回明确 message）。 |
| 当前状态 | 🟡 |
| 残余风险 | 当前电路只把 `voteVector` 作为 public；`electionIdHash` / `voteVectorCommitment` 仅靠后端校验。后续需要把它们绑进电路 publicSignals。 |

### T7. 链上审计不一致 (chain vs local mismatch)

| 字段 | 内容 |
| --- | --- |
| 攻击描述 | 本地 bulletin / aggregator 的 root / tally 在提交链上后被修改；或有人重放链上记录。 |
| 对应论文 | Zeeperio automatic verification |
| 检测模块 | (a) Hardhat 合约 `hasAudit` + `getAudit` 返回固定不变；(b) `/blockchain/elections/:id/audit` 与 `/elections/:id/bulletin`、`/aggregator/.../report` 三方对齐。 |
| 预期结果 | 若 `merkleRoot / commitmentRoot / receiptRoot / auditHash / tallyHash` 任一不一致，审计页 UI 给出红色 warning，`export/public_inputs.json` 与 `export/chain_audit.json` 字段不匹配。 |
| 手动复现 | 先 `submit-audit`；再 `POST /attack/.../tamper-tally`；再导出 `public_inputs.json` 和 `chain_audit.json` 对比。 |
| 自动测试建议 | API 集成测试：提交 → 篡改 tally → 导出两个 artifact → 断言字段差异。 |
| 当前状态 | 🟡 |

### T8. 挑战开口篡改 (challenge opening tamper)

| 字段 | 内容 |
| --- | --- |
| 攻击描述 | 选民选 challenge 后，设备或 aggregator 篡改公开的 `voteVector` 或 `randomness`。 |
| 对应论文 | Haechi cast-or-challenge |
| 检测模块 | `verifyCommitmentOpening(electionId, voteVector, randomness, commitment)`，即：`SHA256(electionId || voteVector || r) === commitment`。 |
| 预期结果 | `ChallengeRecord.openingVerified=false`。当前 API 返回记录中永远会附带 `openingVerified`，若为 false 说明 commitment 不是由声明的 (v, r) 产生。 |
| 手动复现 | 生成 pendingBallot；challenge 后手动改 `voteVector[0]`；`verifyCommitmentOpening(...)` 直接返回 false。 |
| 自动测试建议 | crypto unit test：一次合法 opening、一次篡改 `voteVector`、一次篡改 `randomness`，分别断言 true / false / false。 |
| 当前状态 | 🟡 |

## 2. 相关横向项

### T9. Pedersen 聚合承诺核查 (实验模块)

| 字段 | 内容 |
| --- | --- |
| 攻击描述 | 实验环境：聚合器声称 `C_total = Π C_i`，但提交的 `(v_total, r_total)` 不匹配。 |
| 对应论文 | Haechi homomorphic tally verification |
| 检测模块 | `POST /crypto/pedersen/aggregate-verify`；`verifyAggregateOpening()`。 |
| 预期结果 | `verified=false` 且 `aggregatedCommitment !== expectedCommitment`。 |
| 手动复现 | 生成 3 张 `POST /crypto/pedersen/commit`；在 `aggregate-verify` 的 batch 中把一张 `randomness` 改一位。 |
| 当前状态 | 🟡 (experimental) |

### T10. Tally 篡改 (聚合结果伪造)

| 字段 | 内容 |
| --- | --- |
| 攻击描述 | 管理员修改 `AggregatorReport.tallyResult` 而不改 votes。 |
| 对应论文 | Aggios correctness of aggregation |
| 检测模块 | `getTallyConsistency()`：重新聚合一次并比较；`GET /aggregator/.../report` 返回 `tallyConsistent=false`。 |
| 预期结果 | `tallyConsistent=false` + `consistencyMessage` 明确。 |
| 手动复现 | `POST /attack/elections/:id/tamper-tally` 然后 `GET /aggregator/.../report`。 |
| 当前状态 | ✅ |

### T11. 投票阶段越界

| 字段 | 内容 |
| --- | --- |
| 攻击描述 | 在 `status=finalized` 之后继续提交投票或添加候选人。 |
| 检测模块 | API 状态机检查。 |
| 预期结果 | 409 错误。 |
| 当前状态 | ✅ |

### T12. 挑战生命周期滥用

| 字段 | 内容 |
| --- | --- |
| 攻击描述 | 同一 `pendingBallotId` 先 cast 再 challenge，或反之。 |
| 检测模块 | `pendingBallot.status` 状态机。 |
| 预期结果 | 409 `该待确认选票已被处理`。 |
| 当前状态 | ✅ |

## 3. 每个模块对应的自动化测试骨架

本节列出推荐的 vitest / jest 测试文件位置（当前仓库还没创建，建议按阶段补齐）。

```
packages/crypto/src/__tests__/
  commitment.test.ts         # T3, T8
  receipt-chain.test.ts      # T4
  merkle.test.ts             # T5
  pedersen.test.ts           # T9

packages/zk/src/__tests__/
  mock-adapter.test.ts       # T2, T6
  real-adapter.test.ts       # T6 (需要 zk-artifacts 存在)

apps/api/__tests__/
  double-voting.test.ts      # T1
  challenge-lifecycle.test.ts # T12
  tally-tamper.test.ts       # T10
  export-bundle.test.ts      # T7 + artifact hash 稳定性
```

统一执行命令（建议在 root 加 `test` 脚本）：

```bash
pnpm -r test
```

## 4. 演示用的「一分钟红队」脚本

建议评委现场体验时，按下列顺序点击一次：

1. 创建选举 → 添加 4 个候选人 → 注册 5 个用户 → 每人投一票。
2. `GET /elections/:id/bulletin` 显示 `receiptChainVerified=true`，`Merkle Root=…`。
3. 在投票端用第一个 `receiptCode` 调 `/receipts/.../proof`，看到 `verifyResult=true`。
4. 触发 `POST /attack/.../tamper-commitment`。
5. 重新刷新 bulletin，`receiptChainVerified=false`，同一 `receiptCode` 的 proof 返回 `verifyResult=false`。
6. 触发 `POST /attack/.../tamper-tally`。`GET /aggregator/.../report` 返回 `tallyConsistent=false`。
7. 提交链上审计 → 导出 `public_inputs.json` 和 `chain_audit.json`，比对 `merkleRoot`，观察攻击后字段不一致。
8. 在 ZK 验证页把合法 proof 的 `voteVectorCommitment` 改一位，`verified=false`。
9. 在挑战审计页做一次 cast 和一次 challenge，`openingVerified=true`；然后手动改 challenge record 的 `voteVector`，验证 `verifyCommitmentOpening` 返回 false。
10. 在 Pedersen 实验页做 3 张 commit，aggregate-verify 展示 `verified=true`；故意把某张 randomness 改一位，`verified=false`。

## 5. 与三篇论文映射

| 威胁 | Haechi 613 | Zeeperio 565 | Aggios 545 |
| --- | --- | --- | --- |
| T1 重复投票 | one-ballot-per-voter | — | no-double-voting |
| T2 非法票 | ballot well-formedness | — | partition validity |
| T3 承诺篡改 | commitment binding | public audit | — |
| T4 链断裂 | confirmation code chain | — | — |
| T5 Merkle 篡改 | — | public audit automatic verification | inclusion proof |
| T6 ZK 失败 | — | SNARK soundness | aggregation proof soundness |
| T7 链上不一致 | — | on-chain verifier | — |
| T8 挑战篡改 | cast-or-challenge | — | — |
| T9 Pedersen 聚合核查 | homomorphic tally | — | — |
| T10 Tally 篡改 | — | — | correctness of aggregation |

## 6. 遗留项

- 完整 Aggios EPA 证明的作弊路径（例如 partition overlap / missing partition）尚未覆盖，需要等真实 EPA 证明系统接入后补进 T13。
- Real Groth16 的 trusted setup ceremony 作弊（toxic waste 未销毁）不在工程可检测范围内，文档化即可。
- 选民身份伪造（批量注册后多次投票）目前只在 token 层检测，白名单 / 签名机制落地后再补对应自动化测试。
