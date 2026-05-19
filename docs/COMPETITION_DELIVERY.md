# VeriVote 比赛交付说明

## 1. 当前交付定位

VeriVote 当前已经完成为一个可运行、可演示、可验证、可解释的比赛原型。它不是生产级电子投票系统，而是把三篇论文里的核心思想工程化整合到一个安全演示平台里。

核心叙事：

1. **隐私**：公开 commitment 和摘要，不直接公开明文投票。
2. **可验证**：receipt、Merkle proof、receipt chain、aggregator report 可独立复核。
3. **抗攻击**：重复票、非法票、篡改 tally、篡改 commitment、删除 vote、伪造 proof 都有检测路径。
4. **可审计**：链上/链下摘要和导出 bundle 形成外部复核证据。

## 2. 七阶段完成情况

| 阶段 | 目标 | 当前完成情况 | 验收方式 |
| --- | --- | --- | --- |
| 1. 主闭环稳定 | 创建选举 -> 投票 -> 回执 -> 公告板 -> 聚合 -> 验证 | 已完成 | `pnpm test:api-smoke` |
| 2. Haechi 挑战审计 | cast-or-challenge、opening 验证、challenge 不计票 | 已完成 | 挑战审计页 + smoke test |
| 3. Aggios 聚合器 | 重复票/非法票识别、批量 tally、audit report | 已完成 | 聚合器页 + attack flow |
| 4. Zeeperio 公开审计 | Merkle Root、tallyHash、proofHash/auditHash、链上摘要、导出 | 已完成 | 链上审计页 + export bundle |
| 5. 系统安全测试 | 攻击矩阵可执行化 | 已完成 | `scripts/api_smoke_test.py` |
| 6. ZK / Pedersen 实验 | one-hot proof、tally proof 骨架、Pedersen opening/aggregate | 已完成 | ZK / Pedersen 页面 + API |
| 7. 比赛材料 | 演示脚本、交付说明、状态文档 | 已完成 | `docs/DEMO_SCRIPT.md` 等文档 |

## 3. 一键验收

```bash
pnpm verify:plan
```

这条命令会执行：

1. `pnpm typecheck`
2. `pnpm test:api-smoke`
3. `pnpm --filter @verivote/web build`

也可以单独运行：

```bash
python scripts/api_smoke_test.py
```

## 4. 可展示能力清单

### 投票业务能力

- 用户注册。
- 创建 election。
- 添加候选人。
- 正式投票。
- receiptCode 查询。
- finalized 后拒绝继续投票或新增候选人。

### 审计能力

- Bulletin board。
- Merkle inclusion proof。
- Receipt chain 连续性验证。
- Aggregator report。
- Tally consistency check。
- Artifact bundle 导出。

### 安全检测能力

- 重复投票 API 拒绝。
- 聚合器识别重复票。
- 聚合器识别非法票。
- 篡改 tally 后检测不一致。
- 篡改 commitment 后 Merkle proof 失败。
- 删除 vote 后 receipt chain 断裂。
- 伪造 ZK publicSignals 后验证失败。
- Pedersen 聚合 opening 篡改后验证失败。

### 论文映射能力

- Haechi：commitment、receipt chain、cast-or-challenge。
- Aggios：batch aggregation、duplicate detection、audit report。
- Zeeperio：public audit、hash commitment to chain、exportable audit artifacts。

## 5. 答辩时可以强调的边界

1. 这是比赛原型，不承诺生产级身份认证和主网部署。
2. Real ZK / Solidity 验证链路已经有骨架；默认演示用 mock/local mode 保证稳定。
3. Pedersen 模块用于展示更接近论文的承诺思想；主流程已经使用 Pedersen-style commitment，但仍应表述为教学/比赛级实现。
4. 完整 Aggios EPA 证明体系属于后续科研增强，不影响当前比赛闭环验收。

## 6. 推荐提交材料

- `README.md`
- `docs/PROJECT_STATUS_AND_NEXT_STEPS.md`
- `docs/COMPETITION_DELIVERY.md`
- `docs/DEMO_SCRIPT.md`
- `docs/SECURITY_TESTS.md`
- `docs/ARCHITECTURE.md`
- `docs/THREAT_MODEL.md`
- `docs/PAPER_MAPPING.md`
- 前端演示截图或录屏
- `pnpm verify:plan` 的终端输出截图
