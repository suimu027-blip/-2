# Tally Correctness Proof（批次计票正确性证明）

> 本模块把 ZK 从「单张票合法性」升级到「一个批次的票正确聚合成声称的 tally」。
> 用于把 VeriVote 从「工程化聚合器」推到 Aggios/Zeeperio 方向的「可证明聚合器」。

## 1. 威胁与目标

当前系统 Aggregator 只做工程检测：

- 重复 `voteTokenHash` 计数。
- 非法 `candidateId` 计数。
- `tallyConsistent`（重新聚合一次对比）。

上述都依赖**聚合器诚实**。一旦管理员修改 `votes` 同时重算 `tallyResult`，工程检测通过但结果已被篡改。

**Tally Correctness Proof** 的目标：聚合器对外发布 `(C_1..C_N, tally)`，其中 `C_i` 是每票承诺、`tally` 是每候选人票数。聚合器额外提交一个 ZK proof，**保证存在一组合法 one-hot 向量 v_i，使得对每个候选人 j 有 Σ_i v_{i,j} = tally[j]**，且不泄露具体投向。

## 2. 电路

`circuits/tally_correctness.circom`：

```circom
template TallyCorrectness(N, C) {
    signal input voteVector[N][C];   // 私有 witness
    signal input tally[C];           // 公共输出
    signal input batchSize;          // 公共输出

    // (1) 每位是 0/1：v*(v-1) === 0
    // (2) 每行 sum = 1（one-hot）
    // (3) 每列 sum === tally[j]
    // (4) sum(tally) === batchSize === N
}

component main { public [tally, batchSize] } = TallyCorrectness(8, 4);
```

默认 `N = 8`、`C = 4`。更大的批次可以重新编译（trusted setup 的 ptau power 在 `scripts/zk-setup.ts` 的 `PLANS` 里设为 2^14，够 N=64、C=8 左右的场景）。

## 3. 本地运行

```bash
pnpm install
pnpm zk:setup   # 会同时生成 valid_vote 和 tally_correctness 两个电路的 artifacts
pnpm zk:demo
```

`zk:demo` 会对两个电路分别跑：

- `valid_vote`：5 种输入（2 合法 + 3 非法），期望 verify 结果和预期一致。
- `tally_correctness`：
  - **case A**：8 张合法 one-hot 票，正确 tally → `valid=true, verified=true`。
  - **case B**：合法票但 tally[0] +1 / tally[1] -1 → witness 生成就会失败，返回 `valid=false, verified=false`。

## 4. API

### `POST /zk/prove-tally-correctness`

请求：

```json
{
  "electionId": "election_1",
  "voteVectors": [
    [1,0,0,0],
    [0,1,0,0],
    [0,0,1,0],
    [0,0,0,1],
    [1,0,0,0],
    [0,1,0,0],
    [0,0,1,0],
    [0,0,0,1]
  ],
  "tally": [2, 2, 2, 2]
}
```

响应：

```json
{
  "proofId": "zkp_tally_...",
  "publicSignals": {
    "electionIdHash": "...",
    "tally": [2,2,2,2],
    "batchSize": 8,
    "circuitId": "tally-correctness-8x4"
  },
  "proof": {
    "protocol": "verivote-tally-correctness-groth16-v1",
    "snarkjsProof": { ... },
    "snarkjsPublicSignals": ["..."]
  },
  "valid": true,
  "message": "Tally correctness proof generated and verified."
}
```

### `POST /zk/verify-tally-correctness`

把上一步响应里的 `proof` 和 `publicSignals` 发回即可验证：

```json
{ "verified": true, "message": "Tally correctness proof verified." }
```

## 5. 限制

- **批次大小固定为 8**，候选人固定为 4。不是因为协议需要，是为了让电路足够小能在普通笔记本电脑上 trusted setup。
- **trusted setup 是本地 demo setup**，不是真正的 ceremony，`toxic waste` 未被销毁。生产上线需要真实多方 ceremony。
- **尚未部署 Solidity verifier**。`snarkjs zkey export solidityverifier` 可以生成 `Verifier.sol`，把它挂到 `contracts/VeriVoteAudit.sol` 后面即可在链上自动验证。已列入后续 roadmap。
- 目前 proof 的 `electionIdHash` 只在服务端强绑定，没有作为 circuit public input。后续迭代要把它塞进电路，用 Poseidon 吸收 (electionId, batchSize, tally) 再暴露一个 `commit` 字段。

## 6. 与三篇论文的关系

| 模块 | 对应论文 | 本文档覆盖到的点 |
| --- | --- | --- |
| 单票 `valid_vote` 合法性 | Haechi 613 | ballot well-formedness |
| 批次 `tally_correctness` | Aggios 545 / Zeeperio 565 | proof of correct aggregation / succinct tally proof |
| 链上 verifier（TODO） | Zeeperio 565 | automatic on-chain verification |

## 7. Roadmap

1. 把 `electionIdHash` 直接绑进电路 publicSignals（使用 Poseidon / MiMC 吸收）。
2. 生成并部署 `TallyCorrectnessVerifier.sol`，让 `VeriVoteAudit.submitAudit` 同步验证 tally proof。
3. 把批次大小改成 `N_max = 128`，用 SNARK padding 支持小于 `N_max` 的实际批次。
4. 把 Pedersen commitment 接入：`C_total = g^{r_total} · ∏ h_j^{tally[j]}`，让 tally proof 和承诺开封同时检查。
5. 把批次 proof 与链上审计的 `tallyHash` 对齐，形成端到端链上可验证。
