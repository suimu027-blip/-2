# VeriVote 比赛演示脚本

> 目标：用 6 到 8 分钟讲清楚 VeriVote 已经形成完整比赛原型：能投票、能审计、能发现攻击、能导出证据链。

## 1. 演示前准备

在项目根目录运行：

```bash
python -m pip install -r apps/api/requirements.txt
pnpm install
pnpm verify:plan
```

启动后端：

```powershell
$env:PYTHONPATH="apps/api/src"
$env:VERIVOTE_PERSISTENCE="memory"
python -m uvicorn verivote_api.main:app --app-dir apps/api/src --host 127.0.0.1 --port 3001
```

启动前端：

```bash
pnpm --filter @verivote/web dev
```

打开：

- 后端健康检查：`http://127.0.0.1:3001/health`
- 前端页面：`http://127.0.0.1:5173`

## 2. 开场话术

VeriVote 是一个隐私保护可验证投票审计平台。它不是生产级电子投票系统，而是面向信息安全比赛的可演示原型。系统把 Haechi 的 cast-or-challenge、Aggios 的批量聚合和重复票检测、Zeeperio 的公开审计摘要整合成一条闭环。

## 3. 主闭环演示

1. 进入审计管理端，创建一个 election。
2. 添加 4 个候选人。
3. 进入投票端，注册两个用户。
4. 两个用户分别投票，保存 receiptCode。
5. 回到审计管理端，生成公告板。
6. 运行聚合器，展示：
   - `validVotes`
   - `duplicateVotes`
   - `invalidVotes`
   - `receiptChainVerified`
   - `pedersenTallyVerified`
7. 在投票端用 receiptCode 查询回执。
8. 进入 Merkle 验证页，展示 `verifyResult=true`。

## 4. Haechi 风格挑战审计

1. 在挑战审计页准备一张 pending ballot。
2. 点击 challenge，展示 opening：
   - `voteVector`
   - `randomness`
   - `commitment`
   - `openingVerified=true`
3. 强调：被 challenge 的 ballot 是审计行为，不进入正式 tally。
4. 再准备一张 pending ballot 并 cast，展示它进入正式 tally。

## 5. Aggios 风格聚合器演示

1. 运行聚合器，展示有效票、重复票、非法票分组。
2. 触发攻击演示：
   - 注入重复票
   - 注入非法票
3. 重新运行聚合器，展示：
   - `duplicateVotes > 0`
   - `invalidVotes > 0`
   - 非法/重复票不进入正式结果。

## 6. Zeeperio 风格公开审计

1. 生成 bulletin board 和 aggregator report。
2. 提交 local mock chain audit。
3. 打开链上审计页，展示：
   - `merkleRoot`
   - `commitmentRoot`
   - `receiptRoot`
   - `auditHash`
   - `tallyHash`
4. 打开审计材料导出页，下载 bundle。
5. 强调：bundle 是给外部验证者复核的证据包。

## 7. 安全攻击演示

按顺序演示：

1. 重复投票：同一用户再次投票，API 返回 409。
2. 篡改 tally：报告页显示 `tallyConsistent=false`。
3. 篡改 commitment：同一个 receipt 的 Merkle proof 变为失败。
4. 删除 vote：receipt chain 出现 breaks。
5. 伪造 ZK publicSignals：验证结果 `verified=false`。
6. Pedersen 聚合 opening 篡改：`verified=false`。

## 8. ZK / Pedersen 实验模块

1. ZK 页面用合法 one-hot 生成 mock proof，验证通过。
2. 把 `[1,0,0,0]` 改成 `[1,1,0,0]`，展示 proof invalid。
3. Pedersen 页面生成 commitment，验证 opening 通过。
4. 聚合多个 Pedersen commitment，展示 aggregate verify 通过。
5. 修改任意 randomness，展示 aggregate verify 失败。

## 9. 收尾话术

当前完成的是比赛原型的完整闭环：隐私承诺、回执链、Merkle 公告板、聚合器审计、挑战审计、公开摘要、ZK/Pedersen 实验、安全攻击演示和可导出证据包。后续如果继续科研化，可以把 mock proof 替换成更完整的 EPA / SNARK 证明体系，把 local mock chain audit 替换为真实链上验证。
