# Pedersen / Haechi 独立验收用例

本文档对应成员 C：Haechi/Pedersen 与 cast-or-challenge。目标是独立证明 prepare 后二选一、challenge opening 可验、cast opening 不公开、Pedersen aggregate commitment 可验。

## 1. 交付接口

- `POST /challenge/elections/:id/prepare`：生成 pending ballot，供用户选择 cast 或 challenge。
- `POST /challenge/ballots/:id/cast`：把 pending ballot 写入正式 vote，只返回 `voteId`、`receiptCode`、`commitment` 和 receipt chain 字段，不返回完整 vote witness。
- `POST /challenge/ballots/:id/challenge`：公开 `voteVector`、`randomness`、`commitment` opening，并标记该 ballot 不计入 tally。
- `POST /crypto/pedersen/commit`：生成 Pedersen-style vector commitment。
- `POST /crypto/pedersen/verify-opening`：验证 `commit(v, r) == C`。
- `POST /crypto/pedersen/aggregate-verify`：验证 `prod(C_i) == commit(sum(v_i), sum(r_i))`，输出 `pedersenAggregateHash`。

## 2. 样例材料

- `docs/contracts/pedersen_aggregate_audit.valid.sample.json`：正常三票聚合，`verified=true`。
- `docs/contracts/pedersen_aggregate_audit.tampered.sample.json`：篡改一条 commitment，`verified=false`。

公开材料只使用 `aggregatedRandomnessHash`，不公开 cast 票的 aggregate randomness 明文。

## 3. 验收命令

```bash
pnpm typecheck
pnpm build
```

Pedersen API 可用前端「Pedersen 实验」页面验证，也可用 `curl` 调用：

```bash
curl -s http://localhost:3001/crypto/pedersen/commit \
  -H 'content-type: application/json' \
  -d '{"electionId":"demo_pedersen_election","candidateCount":4,"voteVector":[1,0,0,0]}'
```

## 4. 必测场景

| 场景 | 操作 | 预期 |
| --- | --- | --- |
| cast 后 challenge | prepare -> cast -> challenge 同一个 pendingBallotId | challenge 返回 409 |
| challenge 后 cast | prepare -> challenge -> cast 同一个 pendingBallotId | cast 返回 409 |
| opening 篡改 randomness | commit 后改一位 randomness，再 verify-opening | `verified=false` |
| opening 篡改 voteVector | commit `[1,0,0,0]`，用 `[0,1,0,0]` verify-opening | `verified=false` |
| aggregate 正常 | 多条 commit 组成 batch 后 aggregate-verify | `verified=true`，输出 `pedersenAggregateHash` |
| aggregate 篡改 | 修改 batch 任一 commitment 后 aggregate-verify | `verified=false`，hash 与 valid 样例不同 |

## 5. 截图需求

- Challenge 成功：页面显示 `openingVerified=true`，并说明 challenge 票不计入 tally。
- Cast 后 challenge 失败：同一个 pending ballot 再 challenge 返回 409。
- Aggregate 篡改失败：Pedersen 页面显示 `tamperedVerified=false` 和 tampered aggregate hash。

## 6. 答辩边界

稳妥表述：当前实现是 Haechi-inspired commitment-based cast-or-challenge 与 Pedersen-style aggregate audit，用于竞赛原型的可复验工程闭环。

不能夸大：不要说已经实现 Haechi 完整 compressed proof、生产级匿名投票、生产级曲线参数审计，或把服务端保存的 witness 说成正式公开材料。
