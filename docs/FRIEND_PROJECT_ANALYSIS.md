# 朋友项目融合分析

## 1. 阅读范围与定位

本轮分析基于朋友项目的实际解压路径：

```text
reference/votingsystem-main/votingsystem-main/
```

用户给出的路径是 `reference/votingsystem-main/`，但本地解压后多了一层同名目录。本文只把该目录作为参考材料，不建议把 `reference/` 加入 Git，也不把其中 Python 代码复制到 VeriVote 主代码里。

朋友项目是一个 Python 原型，围绕 `2026-613 / Haechi` 建立主流程，同时为 `2026-565 / Zeeperio` 和 `2026-545 / Aggios` 预留扩展方向。它已经包含：

- Python 核心投票模型。
- `FastAPI + SQLite` 服务层。
- 一个挂载在 FastAPI 下的单页演示前端。
- Pedersen 风格向量承诺。
- `cast / challenge` 工作流。
- confirmation code chain。
- 公共选举记录和验证器。
- 第一阶段 NIZK 风格证明结构。
- Zeeperio-style artifact export。
- 安全路径和篡改检测测试。

它的价值不在于可以直接并入 VeriVote，而在于提供了更贴近 Haechi 论文主流程的工程参考。

## 2. 朋友项目做了什么

朋友项目把一场选举抽象成 `ElectionManifest`、`Contest`、`PendingBallot`、`PublishedBallotRecord`、`TallyReport` 和 `VerificationReport`。投票设备根据 manifest 把选民选择编码成向量，对整张票生成一个向量承诺，并生成确认码。之后选民可以选择：

- `cast`：把承诺写入公共选举记录，并计入运行中的 tally。
- `challenge`：公开该票的向量和随机数，证明设备确实按选民选择生成了承诺，但不计入 tally。

投票结束后，系统发布聚合承诺、聚合向量、聚合随机数和 tally proof。公开验证者可以重新检查：

- ballot identifier hash 是否正确。
- confirmation code chain 是否连续。
- 每张票的 well-formedness proof 是否有效。
- challenge 票开封是否匹配承诺。
- cast 票承诺乘积是否等于聚合承诺。
- tally 开封和 tally proof 是否有效。
- tally map 是否与聚合向量一致。

服务层把设备状态、公共记录、tally 和验证结果写入 SQLite，并提供 prepare、cast、challenge、tally、verify、audit logs、Zeeperio artifact 等 API。测试覆盖了篡改 proof、篡改确认码、篡改 challenge opening、篡改 tally proof、overvote、challenge 后再次 cast、服务重启持久化等路径。

## 3. 对应 613 / 565 / 545 的论文机制

| 论文 | 朋友项目中的体现 | 成熟度 |
| --- | --- | --- |
| `2026-613 / Haechi` | 整票向量承诺、cast-or-challenge、confirmation code chain、公共选举记录、聚合承诺开封、公开验证器 | 主体已原型化 |
| `2026-565 / Zeeperio` | 将 election record 转为 Zeeperio-style `election.json`、`public_inputs.json`、`audit_ballots.json`，为 succinct verification / external prover 预留接口 | artifact export 原型 |
| `2026-545 / Aggios` | 文档和扩展点中保留 aggregator、batch tally、partition proof、inclusion acknowledgement 的设计方向 | 概念预留，未真正实现 EPA |

### 3.1 613：Haechi 主流程

朋友项目最强的部分是 613。它把 Haechi 的线下设备投票模型转成了可运行代码：

- manifest 定义 contests、candidates、选择上下限。
- device 编码整张票并生成 commitment。
- voter 在 cast 和 challenge 间二选一。
- public election record 存储已投票和挑战票。
- tally 阶段公开聚合开封。
- verifier 独立重放所有公开检查。

### 3.2 565：Zeeperio 验证层升级

朋友项目没有实现完整 Zeeperio prover 或链上 verifier，但 `zeeperio_adapter.py` 已经把当前记录整理成适合后续 prover 使用的 artifact：

- 每个 contest 单独导出 election rows。
- challenged ballots 作为 audit ballots。
- 生成 public inputs，包括候选人数、audit ballot 数、tally 等字段。
- 可写出 `bundle.json`、`election.json`、`audit_ballots.json`、`public_inputs.json`。

这对 VeriVote 的价值是：后续可以增加“导出审计材料”能力，让评委看到系统不仅有 UI 和摘要上链，也能把公开记录转成外部证明系统可消费的格式。

### 3.3 545：Aggios 聚合层升级

朋友项目没有实现真正的 Aggios EPA 或多 aggregator 协议。它对 545 的贡献主要是分析路线：把 aggregator、batch tally、partition proof、inclusion acknowledgement、dispute handling 放在未来聚合层中。

VeriVote 当前已有工程化 aggregator，因此 545 的融合重点不应从朋友项目复制实现，而应吸收它的边界描述：当前 aggregator 是重复票、非法票和 tally consistency 检测，不等于 Aggios 的 Extended Partition Argument。

## 4. 核心模块分析

### 4.1 cast-or-challenge

`device.py` 中的 `VotingDevice` 是朋友项目的核心。

`prepare_ballot()` 做以下事情：

- 根据 manifest 把 selections 编码为 vote vector。
- 生成 Pedersen-style commitment 随机数。
- 对整票向量生成 commitment。
- 调用 well-formedness proof backend 生成证明。
- 生成 ballot id、identifier hash、sequence number。
- 基于上一条 confirmation code 生成新的 confirmation code。
- 把票放入 `pending_ballots`。

`cast_ballot()` 从 pending 中消费 ballot，发布 `status="cast"` 的记录，更新 confirmation code，累加 running tally 和 running randomness，并把 cast vector 留在 `private_cast_vectors` 中供 artifact export 使用。

`challenge_ballot()` 也从 pending 中消费 ballot，但发布 `status="challenged"`，公开 `vector`、`randomness` 和 `previous_confirmation_code`，不累加 tally。

这比 VeriVote 当前的直接 `/vote` 流程多了一层投票设备审计交互。融合时适合做成“挑战审计模式”，而不是替换当前主投票入口。

### 4.2 Pedersen 风格向量承诺

`crypto.py` 中的 `PedersenContext` 使用 RFC 3526 group 14 prime，并从 manifest fingerprint 派生：

- 主生成元 `g`。
- 每个 slot 的 generator。
- context hash。

承诺形式是：

```text
commit(vector, r) = g^r * product(h_i ^ vector_i) mod p
```

聚合承诺通过乘法聚合，聚合随机数通过模 `q` 加法聚合。这正好体现 Haechi 需要的同态 tally verification。

VeriVote 当前 `createCommitment()` 是 SHA-256 工程模拟：

```text
sha256(electionId + voteVector + randomness)
```

因此 Pedersen 风格承诺适合在 VeriVote 中作为实验模块新增，例如 `createPedersenStyleCommitment()`，并保持现有 hash commitment 不变。不要第一步就替换现有 commitment，否则会影响公告板、Merkle、回执、benchmark、攻击实验和链上摘要。

### 4.3 confirmation code chain

朋友项目的 confirmation code chain 由三步组成：

1. 基于 manifest 和 commitment context 得到 `base_hash`。
2. 用 `hash("confirmation-seed", base_hash)` 初始化 seed。
3. 每张票用 `hash("confirmation", identifier_hash, commitment, previous_confirmation_code)` 生成当前 confirmation code。

验证器从 seed 开始按记录顺序重放。如果中间 confirmation code 被篡改，或记录被删除导致下一张票的 previous code 对不上，验证会失败。

VeriVote 当前 `receiptCode` 是单票独立 hash：

```text
sha256(electionId + commitment + userId + createdAt)
```

它适合回执查询，但不具备链式删除检测。融合时可增强为：

- 保留现有 `receiptCode` 语义。
- 增加 `previousReceiptCodeHash` 或 `receiptChainPrev`。
- 增加 `receiptChainHash` / `receiptChainIndex`。
- 在公告板或审计报告中暴露 chain verification result。

### 4.4 public election record

朋友项目的 `ElectionRecord` 是一个顺序 entries 列表，每条 `PublishedBallotRecord` 包含：

- `sequence_no`
- `ballot_id`
- `status`
- `identifier_hash`
- `commitment`
- `confirmation_code`
- `proof`
- 可选 `opening`

这对应 Haechi 的 public election record / bulletin board。VeriVote 当前的 Bulletin Board 更偏 Merkle 公告板：公开 commitments、receipt code hashes、leaves、Merkle Root 和 tally result。

两者可以融合：VeriVote 继续保留 Merkle bulletin board，同时增加 challenge audit record 或 receipt chain record，不需要把现有公告板改成朋友项目的数据结构。

### 4.5 verifier

`verifier.py` 的 `ElectionVerifier` 很适合作为 VeriVote 后续审计检查项的参考。它把验证拆成清晰的 checks：

- `identifier_hashes`
- `confirmation_chain`
- `ballot_proofs`
- `challenged_openings`
- `aggregate_commitment`
- `tally_opening`
- `tally_vector_shape`
- `tally_decode`
- `tally_mapping`
- `tally_proof`

VeriVote 当前已经有 Merkle proof、aggregator report、tally consistency、chain audit、ZK validity proof 和 Attack Lab。融合时可以借鉴这种 check taxonomy，把审计报告从“几个摘要和结果”升级成“逐项通过/失败的公开验证矩阵”。

### 4.6 proofs.py 中的证明结构

`proofs.py` 先定义抽象接口：

- `WellFormednessProofSystem`
- `TallyProofSystem`

再提供两个方向：

- `ZkOpeningWellFormednessProofSystem`
- `ZkOpeningTallyProofSystem`
- 以及较早的 placeholder proof systems。

其中 `ZkOpeningWellFormednessProofSystem` 做了三类约束：

- 整票 Pedersen vector commitment opening 的 NIZK proof of knowledge。
- 每个坐标的 bit OR proof，证明该位置是 0 或 1。
- 每个 contest 的 public total 与隐藏向量线性一致。

`ZkOpeningTallyProofSystem` 证明聚合 commitment 可以用公开的 aggregate vector 和 aggregate randomness 打开。

这比 VeriVote 当前 Real Groth16 one-hot demo 更贴近 Haechi 的承诺开封验证，但它是 Python 自写证明结构，不是 Circom/Groth16，也不是完整 Haechi compressed Sigma protocol。融合策略应是“吸收证明分层和约束设计”，不要复制 Python proof 代码。

### 4.7 security tests

`tests/test_security_paths.py` 值得融合为测试矩阵。它覆盖：

- baseline verification pass。
- 篡改 ballot proof。
- 篡改 bit OR proof。
- 篡改 contest total。
- 篡改 confirmation code。
- 篡改 challenged opening。
- 篡改 tally proof。
- 篡改 tally opening。
- challenge 后再次 cast 返回错误。
- overvote 返回错误。
- SQLite 服务重启后状态仍可恢复。

VeriVote 当前已有 Attack Lab 和 benchmark，但缺少一份明确的 `SECURITY_TESTS.md` 矩阵。后续可以先写矩阵，再按风险把 API 测试、crypto 单元测试、ZK adapter 测试补起来。

### 4.8 zeperio_adapter / artifact export

朋友项目文件名是 `zeeperio_adapter.py`。用户提到的 `zeperio_adapter` 可以理解为同一模块。

该模块按 contest 导出：

- `election_rows`
- `audit_ballot_ids`
- `public_inputs`
- `bundle.json`
- 每个 contest 的 `election.json`
- 每个 contest 的 `audit_ballots.json`
- 每个 contest 的 `public_inputs.json`

它依赖 `private_cast_vectors` 作为 prover witness 状态，并且 per-position code 是 deterministic placeholder。这很适合作为比赛展示中的“外部证明系统对接材料”，但不应作为生产级隐私设计。VeriVote 可在未来增加 TypeScript 版 artifact export，从当前 votes、bulletin board、aggregator report 和 ZK metadata 生成可审计 bundle。

## 5. 与 VeriVote 当前实现的相同点

| 维度 | 朋友项目 | VeriVote |
| --- | --- | --- |
| 论文定位 | 613 为主，565/545 为扩展 | 三篇论文思想融合，面向比赛原型 |
| 选票编码 | selections -> vector | candidateId -> `voteVector` |
| commitment | Pedersen 风格向量承诺 | SHA-256 hash commitment |
| 回执/确认 | confirmation code chain | `receiptCode` 查询 |
| 公共记录 | `ElectionRecord` | Bulletin Board + Merkle Root |
| 聚合/计票 | running tally + aggregate opening | Aggregator report + tally consistency |
| 证明 | 自写 NIZK/placeholder proof 后端 | Mock/Real Groth16 one-hot validity proof |
| 验证 | `ElectionVerifier` 分项检查 | Merkle、aggregator、chain audit、ZK verify |
| 攻击/异常 | unittest 安全路径 | Attack Lab + 异常演示 |
| 边界说明 | 研究型原型，不用于真实选举 | 比赛展示原型，不用于生产选举 |

两者都没有完整复现三篇论文，也都在文档中明确了当前实现与论文原版的差距。

## 6. 与 VeriVote 当前实现的差异

1. 技术栈不同  
   朋友项目是 Python / FastAPI / SQLite；VeriVote 是 TypeScript / React / Express / Circom / Hardhat。

2. 投票交互不同  
   朋友项目有 `prepare -> cast/challenge`；VeriVote 当前是注册、投票、回执、公告板、聚合器的直接流程。

3. commitment 不同  
   朋友项目是 Pedersen 风格同态向量承诺；VeriVote 当前是 SHA-256 hash commitment。

4. confirmation / receipt 不同  
   朋友项目是链式 confirmation code；VeriVote 当前是独立 `receiptCode`。

5. 公共记录不同  
   朋友项目顺序记录每张 cast/challenged ballot；VeriVote 用 Bulletin Board、Merkle leaves 和 Root 做包含性验证。

6. 验证重点不同  
   朋友项目偏 Haechi 本地公开验证；VeriVote 同时展示 Merkle、aggregator、Attack Lab、Hardhat audit 和 ZK 页面。

7. ZK 路径不同  
   朋友项目在 Python 中实现 NIZK 风格证明结构；VeriVote 当前有 Circom/snarkjs/Groth16 real proof demo，但只证明固定长度 4 的 one-hot voteVector。

8. 持久化不同  
   朋友项目已接 SQLite；VeriVote README 明确当前后端仍是内存数据结构。

9. artifact export 不同  
   朋友项目已有 Zeeperio-style export；VeriVote 当前还没有同类审计材料导出。

10. 链上能力不同  
   VeriVote 已有 Hardhat 审计摘要提交；朋友项目没有 Solidity/Hardhat 路径。

## 7. 适合融合进 VeriVote 的内容

1. cast-or-challenge 审计页和 API  
   作为可选“挑战审计模式”加入，不替换现有投票入口。

2. confirmation code chain 增强 receiptCode  
   保留回执查询，同时增加链式检测能力，用于删除票和顺序篡改检测。

3. verifier check taxonomy  
   把审计报告拆成更清楚的检查项，便于比赛答辩。

4. 安全测试矩阵  
   先新增 `docs/SECURITY_TESTS.md`，再逐步补 API、crypto、ZK 和 aggregator 测试。

5. Pedersen 风格承诺实验模块  
   用 TypeScript / BigInt 重写，不替换当前 hash commitment，作为高级密码学实验开关。

6. Zeeperio-style artifact export  
   导出 `bundle.json`、per-contest rows、public inputs、audit ballots，让 VeriVote 的审计材料更完整。

7. 可选 SQLite 持久化  
   作为后期工程增强，但需要独立设计 TypeScript schema，不直接搬 Python service。

## 8. 不建议直接融合的内容

1. 不直接复制 Python proof 代码  
   证明系统必须和 VeriVote 的 Circom/snarkjs 路线、TypeScript 类型和审计边界一致。

2. 不直接替换 `createCommitment()`  
   当前 hash commitment 已被 vote flow、Merkle、receipt、benchmark、Attack Lab 和 chain audit 使用。直接替换风险过大。

3. 不直接迁移 FastAPI / SQLite service  
   VeriVote 已有 Express API。持久化应通过 Node 生态重新设计。

4. 不直接采用朋友项目的前端  
   VeriVote 已有 React/Vite 单页应用和多模块导航，应在现有 UI 中增加页面。

5. 不把 `private_cast_vectors` 作为长期公开设计  
   这适合作 prover witness 状态，但需要严格隔离，不能误导成公开审计字段。

6. 不把 Zeeperio placeholder codes 当作最终方案  
   当前 adapter 的 deterministic code 是集成占位，不等于论文级 receipt / dispute code。

7. 不把 Aggios 预留设计描述成已实现  
   朋友项目没有 EPA。VeriVote 也应继续说明当前 aggregator 是工程化聚合器，不是完整 partition proof。

## 9. 为什么不要直接复制朋友代码

直接复制代码会带来几个问题：

- 许可证不明确，朋友项目 README 也提示尚未加入 license。
- Python/FastAPI/SQLite 与 VeriVote 当前 TypeScript/Express/React 工作区不兼容。
- 数据模型不一致，直接迁移会破坏现有 API、shared types 和前端状态。
- 密码学代码需要在同一语言、同一测试体系和同一审计边界中重写，复制更难证明正确。
- 比赛答辩更需要解释“我们如何吸收论文机制并工程化实现”，而不是把另一个原型混入主项目。
- `reference/` 是参考资料，不应进入主仓库提交历史。

替代方案是：用 TypeScript 重写思想。

建议做法：

- 用 `@verivote/shared` 先定义数据结构和 API contract。
- 在 `@verivote/crypto` 中新增 domain-separated helpers。
- 在 `apps/api` 中增加小范围 API，不改现有主流程。
- 在 `apps/web` 中增加挑战审计和 artifact export 页面。
- 在 docs 中明确哪些是论文机制、哪些是当前工程近似。
- 每个阶段都配套最小验证方式：typecheck、build、API happy path、tamper path。

## 10. 结论

朋友项目最值得借鉴的是 Haechi 主流程的完整度：`prepare -> cast/challenge -> record -> tally -> verifier`。VeriVote 当前更强的是比赛展示闭环：React UI、Express API、Merkle bulletin board、aggregator、Attack Lab、Hardhat audit、Circom/snarkjs real proof demo 和 benchmark。

融合方向应是把朋友项目的机制思想转成 VeriVote 自己的 TypeScript 实现，并且保持分层：

- 短期增强审计交互和文档表达。
- 中期增强 receipt chain、安全测试和 artifact export。
- 长期再做 Pedersen commitment、完整 tally proof、SQLite 持久化和更严肃的 Zeeperio/Aggios 后端。

