# Pedersen 承诺实验模块

> 本模块是 Haechi (613) 思路的工程化实验，**不替换**现有主流程的 SHA-256 承诺。
> 仅用于展示「开通验证」「汇总承诺核查」两项论文核心能力。

## 1. 定位与边界

- 当前主流程的 `createCommitment(electionId, voteVector, r) = SHA256(electionId || voteVector || r)` 保持不变。
- 该实验模块位于 `packages/crypto/src/pedersen.ts`，通过 `/crypto/pedersen/*` API 和前端「Pedersen 实验」页面暴露。
- 使用 RFC 3526 MODP Group 14（2048-bit 安全素数）的二次剩余子群，阶 `q = (p - 1) / 2`。
- 生成元 `g, h_1, …, h_n` 从 `(electionId, contextLabel, candidateCount)` 哈希派生，相同输入会得到相同 context，便于审计者复核。
- **未经生产级审计**：参数选择、hash-to-group、序列化、侧信道均未做工程硬化。请勿把该模块直接接入主流程或部署生产。

## 2. 构造

```
commit(v, r) = g^r · ∏ h_i^{v_i}   (mod p)
```

同态聚合：

```
commit(v1, r1) · commit(v2, r2)   ≡   commit(v1 + v2, r1 + r2 mod q)
```

## 3. TypeScript API（`@verivote/crypto`）

```ts
createPedersenContext(electionId, candidateCount, contextLabel?)
createPedersenCommitment(context, voteVector, randomness?)
verifyPedersenOpening(context, voteVector, randomness, commitment)
aggregateCommitments(context, commitmentHexList)
aggregateRandomness(context, randomnessHexList)
aggregateVoteVectors(voteVectors)
verifyAggregateOpening(context, batch)  // 返回 verified + 对比字段
exportPedersenContext(context)         // 导出可序列化 snapshot
```

## 4. HTTP API

### `POST /crypto/pedersen/commit`

请求：
```json
{
  "electionId": "...",
  "candidateCount": 4,
  "voteVector": [1, 0, 0, 0],
  "randomness": "optional hex",
  "contextLabel": "optional"
}
```
响应：
```json
{
  "context": { "electionId": "...", "contextHash": "...", "p": "...", "q": "...", "g": "...", "h": ["..."] },
  "commitmentRecord": { "commitment": "...", "randomness": "...", "length": 4, "contextHash": "..." },
  "message": "Pedersen-style commitment 已生成。..."
}
```

### `POST /crypto/pedersen/verify-opening`

检查 `commit(v, r) == C` 是否成立。字段与 commit 类似，额外需要 `randomness` 和 `commitment`。

返回：
```json
{ "verified": true, "message": "Pedersen opening 验证通过：commitment == g^r * prod h_i^{v_i} (mod p)" }
```

### `POST /crypto/pedersen/aggregate-verify`

汇总承诺核查。请求：
```json
{
  "electionId": "...",
  "candidateCount": 4,
  "batch": [
    { "voteVector": [1, 0, 0, 0], "randomness": "...", "commitment": "..." },
    { "voteVector": [0, 1, 0, 0], "randomness": "...", "commitment": "..." }
  ]
}
```
响应：
```json
{
  "aggregatedCommitment": "∏ C_i",
  "expectedCommitment": "commit(Σ v_i, Σ r_i mod q)",
  "aggregatedRandomness": "...",
  "aggregatedVector": [1, 1, 0, 0],
  "verified": true,
  "message": "Pedersen 聚合承诺核查通过：..."
}
```

## 5. 前端

审计管理端新增「Pedersen 实验」页面：

1. 输入 `electionId / candidateCount / voteVector` 点「commit」。
2. 生成承诺后可点「以原 randomness 验证」或「以当前输入 randomness 验证（演示篡改）」展示开通验证的成功 / 失败。
3. 每次生成承诺会自动追加一条到 batch。在「汇总承诺核查」区改动任一字段后点「运行 aggregate-verify」，可以展示篡改后聚合不一致。

## 6. 和安全测试矩阵的关系

- 开通验证覆盖 `SECURITY_TESTS.md` 中 **T8 挑战开口篡改** 的实验版。
- 汇总承诺核查覆盖 **T9 Pedersen 聚合承诺核查**（Haechi homomorphic tally verification）。
- 不覆盖：完整 Aggios EPA、完整 Zeeperio 链上 verifier。

## 7. 后续增强方向

- 把 SHA-256 承诺路径和 Pedersen 路径做可切换的「commitment adapter」，在某个实验 election 上用 Pedersen，而不改主流程默认行为。
- 引入椭圆曲线（如 ristretto255 / bn254）以减小体积，便于写进 Circom 电路。
- 把 `verifyAggregateOpening` 接入链上审计：把 `aggregatedCommitment / aggregatedVector / aggregatedRandomness` 作为 `tally proof` 的基础数据提交。
