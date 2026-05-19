# VeriVote 与朋友项目分阶段融合路线

## 1. 融合原则

本路线只描述后续融合方案。本轮没有修改业务代码，也不把 `reference/` 加入 Git。

融合时遵循以下原则：

- 以 VeriVote 当前 TypeScript / React / Node / Circom / Hardhat 架构为主。
- 朋友项目只作为机制参考，不复制 Python 代码。
- 先增强可解释性、审计流程和测试，再触碰核心密码学实现。
- 任何新机制都先做实验模块或可选路径，不破坏现有投票闭环。
- 文档中持续区分“论文原版机制”“当前工程实现”“未来增强方向”。

## 阶段 1：挑战审计 cast-or-challenge 页面和 API

### 目标

把朋友项目的 `prepare -> cast/challenge` 思想引入 VeriVote，作为可选挑战审计流程。用户先生成一张 pending ballot，随后选择：

- `cast`：确认投出，进入正式票集合。
- `challenge`：公开该票的 `voteVector`、randomness 和 commitment opening，用于证明设备没有篡改选择，但不计入 tally。

这一阶段不替换当前 `/elections/:id/vote` 主投票接口，而是增加一个比赛展示用的“挑战审计”路径。

### 涉及文件

计划涉及：

- `packages/shared/src/index.ts`：新增 pending ballot、challenge record、challenge verification 类型。
- `packages/crypto/src/index.ts`：复用现有 `createVoteVector()`、`createCommitment()`，可增加 opening verification helper。
- `apps/api/src/index.ts`：新增 prepare、cast prepared ballot、challenge prepared ballot、challenge audit record API。
- `apps/web/src/App.tsx`：新增 cast-or-challenge 页面或在投票页旁增加挑战审计模式。
- `apps/web/src/styles.css`：补充页面样式。
- `docs/FUSION_ROADMAP.md` 或后续演示文档：记录流程边界。

### 不应该修改的文件

本阶段不应修改：

- `contracts/*`
- `circuits/*`
- `packages/zk/*`
- `scripts/*`
- `package.json`
- `pnpm-lock.yaml`
- `docs/PAPER_MAPPING.md`

### 验证方式

- `pnpm typecheck`
- `pnpm build`
- 手动 API 验证：prepare 后 cast 成功，prepare 后 challenge 成功。
- 手动异常验证：challenge 后再 cast 同一 ballot 应失败，cast 后再 challenge 应失败。
- 前端验证：页面能展示 pending ballot、commitment、receipt/challenge result。

### 对论文关系的提升

该阶段显著增强 VeriVote 与 `2026-613 / Haechi` 的对应关系。当前 VeriVote 已有 commitment 和 receipt，但缺少 Haechi 中选民主动挑战设备的交互。加入 cast-or-challenge 后，系统可以更清楚地解释“设备诚实性审计”。

### 对比赛展示的价值

评委可以直接看到：

- 正常投票路径。
- 挑战审计路径。
- 被 challenge 的票不会计入 tally。
- challenge opening 可以被公开验证。

这比只展示 hash 和 Merkle Root 更直观。

### 风险和边界

- 第一阶段仍使用现有 SHA-256 commitment，不引入 Pedersen。
- pending ballot 需要有生命周期，避免长期堆积。
- challenge opening 会公开选择，只适合审计样票，不适合被计入正式投票。
- UI 要明确 challenge 是审计行为，不是投票反悔功能。

## 阶段 2：confirmation code chain 增强 receiptCode

### 目标

在保留现有 `receiptCode` 查询能力的基础上，加入链式 receipt / confirmation code。每张票除自身 receiptCode 外，还记录上一张票的 receipt chain hash，使公告板可以检测删除票、重排票、篡改回执链等问题。

建议字段方向：

- `receiptChainIndex`
- `previousReceiptCodeHash`
- `receiptChainHash`
- `receiptChainVerified`

### 涉及文件

计划涉及：

- `packages/shared/src/index.ts`：扩展 `Vote`、`BulletinBoard`、receipt proof 和 audit report 类型。
- `packages/crypto/src/index.ts`：新增 `createReceiptChainHash()` 或 `createConfirmationCode()`。
- `apps/api/src/index.ts`：投票时维护链状态，公告板和 receipt proof 返回链字段。
- `apps/web/src/App.tsx`：回执查询、公告板、审计报告展示链式验证结果。
- `apps/web/src/styles.css`：补充链式回执展示样式。
- 未来 `docs/SECURITY_TESTS.md`：加入删除票、重排票、篡改 receipt chain 的测试项。

### 不应该修改的文件

本阶段不应修改：

- `circuits/*`
- `contracts/*`
- `packages/zk/*`
- `scripts/zk-*`
- `zk-artifacts/*`
- `package.json`
- `pnpm-lock.yaml`

### 验证方式

- `pnpm typecheck`
- `pnpm build`
- 创建多张票后生成公告板，验证 chain 全部通过。
- 删除或篡改中间一张票后，链验证应失败。
- receipt 查询仍能使用旧的 `receiptCode` 找到票。

### 对论文关系的提升

该阶段加强 `2026-613 / Haechi` 的 confirmation code chain 映射。当前 VeriVote 的 receiptCode 是单票查询码，加入链后更接近论文中的公共记录连续性验证。

### 对比赛展示的价值

可以新增一个非常清晰的攻击演示：

1. 正常投票。
2. 生成公告板，receipt chain 通过。
3. 删除或篡改一张票。
4. 公告板显示 chain broken。

这类演示对评委很友好，因为它把“可验证”变成了可见失败。

### 风险和边界

- 链式 receipt 不能单独证明 tally 正确，只证明记录连续性。
- 如果现有内存数组被攻击直接整体重算链，仍需 Merkle Root、audit hash 和链上摘要一起约束。
- 需要避免破坏现有 receipt API 的兼容性。

## 阶段 3：安全测试矩阵 SECURITY_TESTS.md

### 目标

先建立 `docs/SECURITY_TESTS.md`，把 VeriVote 现有 Attack Lab、朋友项目安全测试、未来 API/crypto/ZK 测试统一成矩阵。该阶段的重点是明确“哪些攻击应该被发现、由哪个模块发现、如何验证”。

建议矩阵包含：

- overvote / invalid candidate。
- duplicate voteTokenHash。
- challenge 后重复 cast。
- 篡改 commitment。
- 删除 vote。
- 篡改 receiptCode / receipt chain。
- 篡改 Merkle leaf / Root。
- 篡改 tallyResult。
- 篡改 aggregator report。
- 篡改 ZK proof / publicSignals。
- 缺失 ZK artifacts。
- 服务重启后的状态恢复。

### 涉及文件

计划涉及：

- `docs/SECURITY_TESTS.md`：新增测试矩阵。
- 后续可选 `apps/api` 测试文件：补 API 安全路径测试。
- 后续可选 `packages/crypto` 测试文件：补 hash、Merkle、receipt chain 测试。
- 后续可选 `packages/zk` 测试文件：补 mock/real proof 验证路径。

### 不应该修改的文件

本阶段如果只做文档，不应修改：

- `apps/api/src/index.ts`
- `apps/web/src/App.tsx`
- `packages/*`
- `contracts/*`
- `circuits/*`
- `scripts/*`
- `package.json`
- `pnpm-lock.yaml`

如果后续要新增自动化测试，也应避免在同一阶段改业务行为。

### 验证方式

- 文档审查：每一行测试都有攻击目标、预期检测模块和预期结果。
- 与现有 Attack Lab 对照：已有演示标记为 implemented。
- 与朋友项目测试对照：可迁移思想标记为 planned。
- 后续自动化测试可以逐项把 planned 改为 covered。

### 对论文关系的提升

安全测试矩阵把三篇论文的安全目标转成工程验证项：

- 613：记录完整性、challenge opening、tally consistency。
- 565：public proof、receipt/dispute、自动验证。
- 545：duplicate detection、batch inclusion、聚合正确性。

### 对比赛展示的价值

这份矩阵可以直接进入答辩材料，说明项目不是只做 happy path，而是主动覆盖篡改、删除、重复、非法输入和证明失败。

### 风险和边界

- 不要把文档矩阵误写成“全部已实现”。
- 自动化测试应分批补，不要为了测试一次性重构主 API。
- Real ZK 测试受本地 artifacts 影响，应区分 mock、real-ready 和 real-missing 场景。

## 阶段 4：Pedersen 风格承诺实验模块，不替换当前 hash commitment

### 目标

新增 TypeScript 版 Pedersen 风格承诺实验模块，用于展示 Haechi 的同态向量承诺思想。它只作为高级演示或开发开关，不替换当前主流程中的 SHA-256 commitment。

建议能力：

- 从 election/candidate list 派生 slot generators。
- 用 BigInt 实现 `commit(vector, randomness)`。
- 实现 `verifyOpening(commitment, vector, randomness)`。
- 实现 `aggregateCommitments()` 和 `aggregateRandomness()`。
- 在文档中明确其为实验模块，未经过生产密码学审计。

### 涉及文件

计划涉及：

- `packages/crypto/src/index.ts` 或新增 `packages/crypto/src/pedersen.ts`。
- `packages/shared/src/index.ts`：如需新增实验结果类型。
- `apps/api/src/index.ts`：可选增加实验 API，不接入默认投票。
- `apps/web/src/App.tsx`：可选增加 Pedersen demo panel。
- `docs/ZK_VALIDITY_PROOF.md` 或新增实验说明文档：解释 hash commitment 与 Pedersen-style commitment 的区别。

### 不应该修改的文件

本阶段不应修改：

- 默认投票路径的 `createCommitment()` 语义。
- `contracts/*`
- `circuits/*`
- `packages/zk/*`
- `scripts/benchmark.ts`，除非单独增加实验 benchmark。
- `README.md`
- `docs/PAPER_MAPPING.md`

### 验证方式

- `pnpm typecheck`
- `pnpm build`
- 单元级验证：同一 vector/randomness 可打开，同一 commitment 被篡改后打开失败。
- 聚合验证：`commit(v1,r1) * commit(v2,r2)` 与 `commit(v1+v2,r1+r2)` 一致。
- UI 或 API demo 验证：不影响现有 hash commitment、receipt、Merkle 和 chain audit。

### 对论文关系的提升

该阶段直接增强 `2026-613 / Haechi` 的 commitment 映射。当前 VeriVote 文档已说明 SHA-256 commitment 不等于 Pedersen vector commitment；加入实验模块后，可以展示“为什么同态承诺能支持聚合开封”。

### 对比赛展示的价值

这是密码学深度展示点。评委可以看到项目既有工程闭环，也理解论文中的同态承诺机制，并且团队清楚地区分实验模块与生产路径。

### 风险和边界

- BigInt 群参数、generator 派生和模运算需要谨慎，不应宣称生产安全。
- 不能直接替换 hash commitment，否则会牵动 Merkle、receipt、benchmark、Attack Lab 和 chain audit。
- 如果未来要生产化，需要更严格的参数选择、序列化规范和第三方审计。

## 阶段 5：Zeeperio artifact export 和审计材料增强

### 目标

参考朋友项目 `zeeperio_adapter.py`，为 VeriVote 增加 TypeScript 版 artifact export。目标不是实现完整 Zeeperio prover，而是把当前选举公开材料导出为结构化 bundle，方便外部审计、未来 prover 接入和比赛展示。

建议导出：

- `bundle.json`
- `election.json`
- `public_inputs.json`
- `audit_ballots.json`
- `bulletin_board.json`
- `aggregator_report.json`
- `zk_summary.json`
- `chain_audit.json`

### 涉及文件

计划涉及：

- `packages/shared/src/index.ts`：定义 export bundle 类型。
- `apps/api/src/index.ts`：新增 artifact build 和 download/export API。
- `apps/web/src/App.tsx`：新增审计材料导出入口。
- `apps/web/src/styles.css`：补充导出面板样式。
- 可选新增 `docs/ARTIFACT_EXPORT.md`：说明字段含义和 Zeeperio 关系。

### 不应该修改的文件

本阶段不应修改：

- `circuits/*`
- `contracts/*`
- `packages/zk/*` 的 proof 语义。
- 现有 vote、receipt、bulletin、aggregator API 的返回兼容性。
- `package.json`
- `pnpm-lock.yaml`

### 验证方式

- `pnpm typecheck`
- `pnpm build`
- 对同一 election 重复导出，核心 public fields 应稳定。
- 导出的 tally 与 aggregator report 一致。
- 导出的 Merkle Root 与 bulletin board 一致。
- 如果有 ZK proof，导出 metadata；如果没有，应明确为 null 或 unavailable。

### 对论文关系的提升

该阶段增强 `2026-565 / Zeeperio` 的工程映射。即使暂未实现完整 succinct proof，也能展示 VeriVote 已具备把 election record 转成外部验证材料的接口。

### 对比赛展示的价值

评委可以下载或查看完整审计 bundle，看到：

- 公告板数据。
- 聚合报告。
- 回执/Merkle 材料。
- ZK 验证摘要。
- 链上审计摘要。

这能明显提升项目的“可审计材料完整度”。

### 风险和边界

- 不要把 artifact export 描述成完整 Zeeperio verifier。
- 不应导出敏感 witness，例如未公开的 voteVector 或 randomness，除非是在 challenge audit 样票中。
- 文件下载和本地写目录要考虑运行环境，优先提供 JSON response，再考虑写入磁盘。

## 阶段 6：可选 SQLite / 持久化

### 目标

将当前内存数据结构逐步迁移到可持久化存储。优先目标是服务重启后保留 elections、users、candidates、votes、bulletin boards、aggregator reports、attack logs 和 chain audit records。

SQLite 可作为本地比赛演示的第一选择，后续再考虑 PostgreSQL。

### 涉及文件

计划涉及：

- `apps/api/src/index.ts`：抽离 storage interface，减少直接操作内存数组。
- 可新增 `apps/api/src/storage.ts`：定义 in-memory 和 SQLite storage。
- 可新增 `apps/api/src/schema.ts` 或 migration SQL。
- `packages/shared/src/index.ts`：如需要补持久化状态类型。
- `README.md` 和部署文档：后续说明数据库配置。本路线不要求本轮修改。

### 不应该修改的文件

本阶段不应修改：

- `apps/web/src/App.tsx` 的用户流程，除非 API 返回字段确实需要兼容展示。
- `packages/crypto/*` 的 commitment、receipt、Merkle 语义。
- `packages/zk/*`
- `circuits/*`
- `contracts/*`
- `scripts/zk-*`

是否修改 `package.json` 取决于 SQLite 方案。如果选择已有 Node 内置或当前依赖可满足，则不改；如果必须新增依赖，应单独开一个持久化阶段并明确记录。

### 验证方式

- `pnpm typecheck`
- `pnpm build`
- 创建 election、candidate、user、vote。
- 重启 API 后查询数据仍存在。
- 生成公告板、运行 aggregator、提交 chain audit 后重启，状态仍可查询。
- Attack Lab 日志在重启后按预期保留或明确不保留。

### 对论文关系的提升

持久化本身不是三篇论文的核心密码学机制，但它提升 public election record 的可信展示能力。对 613 和 565 来说，稳定保存公告板、审计材料和验证结果是后续公开复验的基础。

### 对比赛展示的价值

持久化能让演示更稳定：

- 不怕 API 重启丢数据。
- 可以预置 demo election。
- 可以保存攻击演示和审计结果。
- 更接近真实服务形态。

### 风险和边界

- 持久化会牵动 API 架构，风险高于前五阶段。
- 数据 schema 一旦定下，后续迁移需要维护。
- SQLite 不等于生产部署方案，仍需权限、备份、并发和安全设计。
- 不应为了持久化提前引入复杂 ORM，除非项目规模确实需要。

## 2. 推荐执行顺序

推荐顺序就是上面的阶段顺序：

1. 先做 cast-or-challenge，因为它最能提升 Haechi 展示效果，且可以作为独立页面。
2. 再做 confirmation code chain，因为它和 receipt 查询、公告板、攻击检测高度相关。
3. 再补安全测试矩阵，避免后续密码学增强没有验证基线。
4. 再做 Pedersen 风格实验模块，保持不替换当前 hash commitment。
5. 再做 Zeeperio artifact export，增强审计材料。
6. 最后考虑 SQLite，因为它影响 API 状态管理，适合在机制稳定后做。

这个顺序的好处是：每一步都能单独展示价值，同时不会过早破坏现有 VeriVote 的可运行闭环。

