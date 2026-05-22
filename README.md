# VeriVote

VeriVote 是一个面向低信任组织（如高校、社团、企业内部选举）设计的**隐私保护与可验证电子投票平台**。项目侧重于投票主流程的公开验证、聚合审计、链上存证和 ZK 零知识合法性证明的工程实现。

## 项目特点与审计机制

系统采用多层审计架构，以降低对单一中心化服务器的信任：
1. **回执链验证（Receipt Chain）**：利用哈希链条关联所有选票，保证投票记录的连续性与防篡改性，防止投票历史被中途插入或删改。
2. **Merkle 包含性验证**：将所有投票哈希构建为 Merkle Tree，用户可使用 Merkle Proof 验证自己的选票是否已被计入公告板。
3. **聚合器审计（Aggregator）**：在计票阶段，通过聚合器检测重复投票、非法选票，并验证计票一致性，输出审计哈希。
4. **双通道零知识证明（ZK Proof）**：支持单票 one-hot 合法性证明及批次计票正确性证明，拦截不合规的伪造选票。
5. **智能合约链上审计**：在 Hardhat 本地测试链部署合约，将 Merkle Root、Receipt Root、聚合审计哈希等数据上链，作为最终审计基准。

---

## 技术栈与目录结构

- **前端**：React + Vite + TypeScript (提供投票端 Voter Portal 与审计管理端 Admin Console 双门户)
- **后端**：Node.js + Express (支持内存模式与 SQLite 本地持久化)
- **密码学/ZK**：Circom 2 + snarkjs + Groth16
- **区块链**：Solidity + Hardhat (本地链上存证合约)
- **包管理**：pnpm monorepo 工作区

```text
verivote/
├── apps/
│   ├── api/                  # Express 后端服务
│   └── web/                  # React 前端 SPA 
├── packages/
│   ├── crypto/               # 哈希、Commitment、Merkle 树、回执链工具库
│   ├── zk/                   # Mock/Real ZK 证明适配器
│   └── shared/               # 共享 TypeScript 类型定义
├── contracts/                # Hardhat 智能合约项目
├── circuits/                 # Circom ZK 电路 (合法性与计票正确性)
├── scripts/                  # Benchmark、ZK 编译、Demo 脚本
└── docs/                     # 机制细节、论文映射及部署指南
```

---

## 快速开始

### 1. 安装依赖
确保本地已安装 Node.js (v18+) 和 pnpm，然后运行：
```bash
pnpm install
```

### 2. 启动服务
```bash
# 启动后端 API 服务 (默认端口 3001)
pnpm dev:api

# 启动前端 Web 界面 (默认端口 18340)
pnpm dev:web -- --port 18340
```
启动后访问 `http://localhost:18340` 即可使用双门户界面。

### 3. 健康检查
验证后端服务运行状态：
```bash
curl http://localhost:3001/health
```

---

## 零知识证明 (ZK) 使用指南

ZK 模块用于证明两点：
- **`valid_vote`**：证明单张 `voteVector` 是合法的 one-hot 向量（元素为 0/1 且和为 1）。
- **`tally_correctness`**：证明批次计票汇总结果（默认 8x4 批次）与单票向量累加一致。

### 方式 A：Mock ZK (无需本地编译)
在前端“ZK 验证”界面中选择 **Mock ZK Validity Proof**。系统会以纯 JS 逻辑验证 one-hot 约束，方便快速测试前端交互流程。

### 方式 B：Real Groth16 ZK (需要本地 Circom 环境)
1. 确保本地安装了 `circom` 编译器（v2.0.0+）：
   ```bash
   circom --version
   ```
2. 运行 setup 脚本，编译电路并生成 Proving Key / Verification Key 等 artifacts：
   ```bash
   pnpm zk:setup
   ```
3. 在本地运行 ZK 命令行 demo：
   ```bash
   pnpm zk:demo
   ```
4. 运行 `pnpm dev:api` 后，前端选择 **Real Groth16 ZK Proof** 即可进行真实密码学证明生成与校验。

---

## 智能合约链上审计

平台支持将投票的关键审计摘要数据锚定至本地 Hardhat 区块链。

### 1. 启动本地 Hardhat 节点并部署合约
```bash
# 编译 Solidity 合约
pnpm contract:compile

# 运行合约单元测试
pnpm contract:test

# 启动本地区块链节点 (默认监听 http://127.0.0.1:8545)
pnpm contract:node

# 部署合约到本地节点
pnpm contract:deploy
```

### 2. 配置后端连接
在部署合约后，将终端输出的 `VeriVoteAudit` 合约地址以及 RPC 地址配置到 `apps/api` 的环境变量或 `.env` 中：
```env
BLOCKCHAIN_AUDIT_MODE=hardhat
HARDHAT_RPC_URL=http://127.0.0.1:8545
AUDIT_CONTRACT_ADDRESS=0xYourContractAddressHere
```
配置完成后重启后端 API 服务，审计管理端即可实时提交并验证链上凭证。

---

## 性能测试 (Benchmark)

项目自带本地性能测试脚本，可评估核心加密组件的吞吐量。
```bash
pnpm benchmark
```
测试运行完毕后，将自动在根目录下生成或更新：
- 结构化 JSON 报告：`benchmark-results.json`
- 结构化 CSV 报告：`benchmark-results.csv`
- 文档化汇总说明：`docs/BENCHMARK.md`

性能测试主要覆盖：哈希计算、Commitment 生成、Merkle Root 构建、Merkle Proof 生成与验证、聚合器校验的内存执行效率。

---

## 常用验证与维护命令

| 命令 | 描述 |
| :--- | :--- |
| `pnpm typecheck` | 执行全局 TypeScript 类型静态检查 |
| `pnpm build` | 执行全局工作区打包编译 |
| `pnpm zk:setup` | 编译 Circom 电路并导出 snarkjs 依赖 |
| `pnpm zk:demo` | 运行本地 ZK 证明生命周期命令行演示 |
| `pnpm contract:test` | 运行 Hardhat 智能合约测试 |

关闭本地开发端口（针对 Windows PowerShell 环境的端口清理快捷脚本）：
```powershell
# 清理后端和前端常用的占用端口 (3001, 18340, 5173)
$ports = @(3001, 18340, 5173)
foreach ($port in $ports) {
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($conn in $listeners) {
    if ($conn.OwningProcess -ne 0) {
      Stop-Process -Id $conn.OwningProcess -Force
    }
  }
}
```

---

## 论文映射与学术背景

VeriVote 融合了以下三篇电子投票领域研究论文的核心设计思想：

| 论文标识 | 论文核心机制 | VeriVote 中的吸收与工程实现 | 边界与局限 |
| :--- | :--- | :--- | :--- |
| **613 / Haechi** | 连续选票确认码链条、挑战式审计（Cast-or-Challenge） | 实现 `receiptCode` 的哈希级联，前端支持 cast-or-challenge 的展示与公开承诺打开验证。 | 实验阶段，Pedersen 风格承诺目前作为独立模块存放在 `packages/crypto/src/pedersen`，未直接替换主流程的 SHA-256。 |
| **565 / Zeeperio** | 公开审计摘要、链上 verifier 合约存证 | 实现了 `proofHash` 和 `auditHash`，支持将关键摘要通过 Hardhat 部署的 Solidity 合约进行锚定存储。 | 未将 full tally zk-SNARK verifier 逻辑写死在主网链上，以降低 gas 开销；链上仅保存摘要与根节点。 |
| **545 / Aggios** | 计票聚合器（Aggregator）、重复检测与错误容忍 | 实现工程级的 Aggregator 聚合模块，自动比对并统计无效票、重复票，生成聚合审计摘要。 | 尚未实现论文中完整的 Extended Partition Argument 密码学聚合证明。 |

更多学术机制映射细节与演进规划，请参考相关说明文档：
- [论文机制映射说明](file:///e:/jingsai/--main/verivote-main%20%281%29/verivote-main/docs/PAPER_MAPPING.md)
- [安全测试矩阵设计](file:///e:/jingsai/--main/verivote-main%20%281%29/verivote-main/docs/SECURITY_TESTS.md)
- [链上验证器集成说明](file:///e:/jingsai/--main/verivote-main%20%281%29/verivote-main/docs/ON_CHAIN_VERIFIER.md)
- [部署与运维指南](file:///e:/jingsai/--main/verivote-main%20%281%29/verivote-main/docs/DEPLOYMENT.md)
