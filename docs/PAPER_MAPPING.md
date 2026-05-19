# VeriVote 论文映射说明

## 1. 文档目的

本项目基于三篇可验证投票与隐私保护投票相关论文进行工程化融合，分别吸收：

- Haechi：commitment-based keyless in-person verifiable elections
- Zeeperio：verifying governmental elections with Ethereum
- Aggios：aggregator-based voting using proof of partition

需要明确的是，VeriVote 并不是对三篇论文的完整复现，而是面向信安赛项目进行工程化设计。项目优先目标是构建一个可运行、可演示、可验证、可攻击检测的隐私保护可信投票审计平台。

因此，本项目采用“论文思想工程化落地”的路线：

1. 先实现普通投票闭环。
2. 再引入 commitment 和回执码。
3. 再加入公告板、Merkle Root 和验证端。
4. 再实现聚合器、重复投票检测和聚合计票。
5. 再实现链上摘要审计。
6. 最后增强 ZK 合法性证明与更接近论文的密码学实现。

---

## 2. Haechi 到本项目的映射

### 2.1 论文核心思想

Haechi 的核心思想是：在线下设备收集选票的场景中，可以使用 cryptographic commitment 替代传统加密选票，从而减少密钥管理复杂度。

Haechi 中，投票设备不会把明文选票直接作为公开记录，而是发布 ballot commitment。投票设备维护累计票数和累计随机数，投票结束后公开聚合结果，使验证者能够检查最终 tally 是否与公开的 commitments 一致。

Haechi 还包含 confirmation code 机制，使投票者可以确认自己的票被记录到 election record 中，同时不泄露自己的投票选择。

### 2.2 本项目采用的工程化实现

VeriVote 从 Haechi 中吸收以下思想：

| Haechi 机制 | VeriVote 工程模块 |
|---|---|
| ballot commitment | voteVector + commitment |
| confirmation code | receiptCode |
| election record | bulletin board |
| homomorphic tally verification | tally consistency verification |
| ballot well-formedness proof | 后续 ZK 合法性证明 |
| keyless verifiable election | 不依赖投票解密密钥的审计流程 |

### 2.3 当前阶段简化实现

当前阶段中，VeriVote 的 commitment 先采用 SHA-256 模拟：

```text
commitment = sha256(electionId + voteVector + randomness)
```

这只是第一阶段工程化模拟，不等价于 Haechi 中的 Pedersen vector commitment。

当前 receiptCode 采用：

```text
receiptCode = sha256(electionId + commitment + userId + createdAt)
```

这可以用于回执查询，但还不等价于 Haechi 中完整的 confirmation-code hash chain。

### 2.4 后续增强方向

后续可以逐步增强为：

1. 将 SHA-256 commitment 替换为 Pedersen commitment。
2. 将单候选人选择扩展为 Pedersen vector commitment。
3. 实现 tally consistency verification。
4. 实现 voteVector 合法性证明，例如证明每个位置为 0/1 且总和为 1。
5. 增加 confirmation code hash chain，检测删除选票等攻击。

---

## 3. Zeeperio 到本项目的映射

### 3.1 论文核心思想

Zeeperio 的核心思想是：已有端到端可验证投票系统虽然可以公开验证，但验证成本较高，依赖人工下载和检查证明。Zeeperio 使用 zk-SNARK 和智能合约，把选举证明压缩为链上可以自动验证的形式。

Zeeperio 的重点不是把所有投票过程完全搬到链上，而是让区块链承担特定的审计与验证目标，例如验证选举证明、记录审计摘要、提高公开可验证性。

### 3.2 本项目采用的工程化实现

VeriVote 从 Zeeperio 中吸收以下思想：

| Zeeperio 机制 | VeriVote 工程模块 |
|---|---|
| public election proof | proofHash |
| smart contract verification | smart contract audit |
| on-chain automatic verification | on-chain verification |
| election table / public audit data | bulletin board |
| proof of correct tally | tallyHash + verification status |

### 3.3 当前阶段简化实现

当前阶段中，VeriVote 暂不实现完整 zk-SNARK verifier。

项目会先实现：

```text
Merkle Root
commitmentRoot
tallyHash
proofHash
verificationStatus
```

并将这些摘要提交到智能合约中，用于链上留痕和审计。

这只是摘要上链审计，不等价于完整 Zeeperio zk-SNARK verifier。

### 3.4 后续增强方向

后续可以逐步增强为：

1. 实现 Solidity 审计合约。
2. 将 Merkle Root、tallyHash、proofHash 提交到链上。
3. 实现链上和本地数据一致性验证。
4. 使用 Circom/snarkjs 生成简化 ZK proof。
5. 后续尝试让合约验证部分 ZK proof。

---

## 4. Aggios 到本项目的映射

### 4.1 论文核心思想

Aggios 的核心思想是：在大规模、高频投票场景中，如果每个投票者都单独把投票记录提交到公共账本，会造成较高通信成本和链上成本。

Aggios 引入 aggregator。投票者把投票 token 提交给聚合器，聚合器批量收集选票，并发布每个候选人的聚合结果和证明。验证者可以检查是否存在重复投票、漏计、错误计票等问题。

Aggios 中的核心密码学工具是 Extended Partition Argument，用于证明一个 committed vector 可以被划分为多个互不重叠的子向量，每个子向量对应某个候选人的票。

### 4.2 本项目采用的工程化实现

VeriVote 从 Aggios 中吸收以下思想：

| Aggios 机制 | VeriVote 工程模块 |
|---|---|
| aggregator | aggregator service |
| voter token | voteTokenHash |
| no double voting | duplicate detection |
| batch tally | batch tally module |
| proof of correct aggregation | aggregateProof / proofHash |
| public audit | audit report |

### 4.3 当前阶段简化实现

当前阶段中，VeriVote 的 aggregator 是工程化聚合器，主要完成：

1. 收集选票。
2. 检查 voteTokenHash 是否重复。
3. 检查 candidateId 是否属于当前 election。
4. 统计候选人票数。
5. 输出 audit report。

这不等价于 Aggios 中完整的 Extended Partition Argument。

### 4.4 后续增强方向

后续可以逐步增强为：

1. 为每个投票用户生成 voteTokenHash。
2. 聚合器只接受合法 token。
3. 使用 Merkle Tree 证明某张票被纳入聚合。
4. 输出 aggregateProof。
5. 尝试用 ZK 证明聚合结果与选票集合一致。
6. 在报告中说明工程化 aggregator 与完整 EPA 的区别。

---

## 5. 项目整体融合路线

VeriVote 的核心融合关系如下：

```text
用户投票
  ↓
生成 voteVector
  ↓
生成 commitment 和 receiptCode
  ↓
聚合器收集选票并检查重复投票
  ↓
公告板公开 commitments、Merkle Root、聚合结果
  ↓
验证端验证回执、未篡改、未重复、总票数一致
  ↓
链上保存 Root / tallyHash / proofHash
  ↓
攻击演示端模拟篡改、删票、重复投票、非法投票、伪造结果
```

三篇论文的融合关系：

| 系统层级 | 论文来源 | 项目实现 |
|---|---|---|
| 选票隐私层 | Haechi | voteVector + commitment |
| 个人验证层 | Haechi | receiptCode |
| 公告板层 | Haechi / Zeeperio | bulletin board |
| 聚合计票层 | Aggios | aggregator + batch tally |
| 公开审计层 | Zeeperio | proofHash + smart contract audit |
| 攻击检测层 | 三篇融合 | 篡改检测、重复投票检测、非法票检测、伪造 tally 检测 |

---

## 6. 当前阶段与论文原版的差异

| 模块 | 当前实现 | 论文原版 | 差异说明 |
|---|---|---|---|
| commitment | SHA-256 模拟 | Pedersen / vector commitment | 当前只是工程模拟 |
| receiptCode | 哈希回执 | confirmation-code chain | 当前只支持回执查询 |
| aggregator | 内存聚合器 | EPA-based aggregator | 当前不证明分区正确性 |
| bulletin board | Web 公告板 | public election record | 当前规模较小 |
| smart contract | 摘要上链 | zk-SNARK verifier | 当前不验证完整证明 |
| ZK proof | 后续实现 | 压缩 ZK / SNARK | 当前未完整实现 |

---

## 7. 面向信安赛的实现策略

本项目采用分阶段实现策略：

### 第一阶段：MVP 投票系统

完成：

- 用户注册
- 创建投票
- 添加候选人
- 提交投票
- 查看结果
- 重复投票拦截

目标是先跑通完整业务闭环。

### 第二阶段：commitment 与回执码

完成：

- voteVector
- randomness
- commitment
- receiptCode
- 回执查询

目标是让系统具备隐私投票雏形。

### 第三阶段：公告板与 Merkle Root

完成：

- commitment 公示
- Merkle Root
- Merkle proof
- 回执包含性验证
- 篡改检测

目标是实现公开可验证。

### 第四阶段：聚合器与审计报告

完成：

- voteTokenHash
- duplicate detection
- batch tally
- audit report
- tally consistency verification

目标是体现 Aggios 的聚合思想。

### 第五阶段：链上审计

完成：

- Solidity 合约
- Root 上链
- tallyHash 上链
- proofHash 上链
- 链上/本地一致性验证

目标是体现 Zeeperio 的自动审计思想。

### 第六阶段：ZK 增强

完成：

- 单选合法性证明
- 非法投票检测
- ZK proof 生成与验证
- 后续可扩展到更复杂投票规则

目标是提高密码学深度。

---

## 8. 答辩说明

如果评委问：

> 你们是不是完整复现了 Haechi、Zeeperio、Aggios？

建议回答：

我们不是完整复现三篇论文，而是基于三篇论文的核心思想进行工程化融合。Haechi 启发了我们的 commitment、voteVector、receiptCode 和 tally consistency verification；Zeeperio 启发了我们的 bulletin board、proofHash、smart contract audit 和 on-chain verification；Aggios 启发了我们的 aggregator、voteTokenHash、duplicate detection、batch tally 和 audit report。

完整复现三篇论文中的 Pedersen vector commitment、compressed Sigma protocol、custom zk-SNARK verifier 和 Extended Partition Argument 工作量很大，不适合作为本科信安赛项目的第一阶段目标。因此我们采用分阶段实现路线：先实现可运行系统和安全审计闭环，再逐步把 SHA-256 模拟 commitment 升级为 Pedersen commitment，把工程化聚合器升级为可证明聚合器，把摘要上链升级为 ZK proof 链上验证。

本项目的创新点不在于机械复现某一篇论文，而在于把三篇论文中的关键机制融合到一个适合校园治理、社团选举和组织决策场景的可运行系统中，并提供正常投票、回执查询、篡改检测、重复投票检测、非法投票检测和链上审计等完整演示闭环。
