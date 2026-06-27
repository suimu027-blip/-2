# VeriVote 电子投票系统 - 大作业/毕业设计

## Demo startup paths

### 1. Quick mock demo

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm demo:seed
```

Open the Web URL from Vite, enter Admin & Audit Console, then use Aggregator, Tally ZK, Chain Audit, Attack Lab, and Artifact Export. This path uses `BLOCKCHAIN_AUDIT_MODE=local-mock` by default.

### 2. Hardhat chain demo

Terminal A:

```bash
corepack pnpm contract:node
```

Terminal B:

```bash
corepack pnpm contract:deploy
```

Copy `AUDIT_CONTRACT_ADDRESS=...` from the deploy output into `.env`, set `BLOCKCHAIN_AUDIT_MODE=hardhat`, restart the API, then use Chain Audit.

### 3. Real verifier demo

```bash
corepack pnpm zk:setup
corepack pnpm zk:demo
corepack pnpm contract:compile
corepack pnpm contract:test
```

Use this path only when the generated verifier artifacts are present. If the page is showing sample proof or local-mock data, describe it as fixture/mock evidence, not as a real on-chain verifier result.

这是一个面向低信任场景（比如高校选举、社团投票、企业内部评选等）设计的**隐私保护与可验证电子投票系统**。

这个项目主要是我们小组为了解决电子投票中“选民不相信结果、管理员可能在后台改票”的问题。我们把零知识证明（ZK-SNARKs）、密码学承诺、默克尔树以及智能合约存证都做进去了。项目采用单仓（monorepo）结构，前后端和合约全在一个工程里，方便跑起来演示。

---

## 1. 结构和目录

- `apps/api`：后端接口，用 Node.js / Express 写的。
- `apps/web`：前端页面，React + Vite + Vanilla CSS。
- `packages/crypto`：密码学工具箱，负责哈希计算、Pedersen 承诺、Merkle 树和回执链等。
- `packages/shared`：前后端共用的类型定义。
- `packages/zk`：零知识证明适配器（支持 Mock 和 Real 真实证明）。
- `contracts`：Solidity 智能合约，用来在链上锚定最终的投票审计数据。
- `circuits`：Circom 2 零知识证明电路。
- `scripts`：一些测试和 ZK 初始化脚本。

---

## 2. 快速跑起来

请确保你本地安装了 `Node.js` (推荐 v18+) 和 `pnpm`。

### 第一步：装依赖
```bash
pnpm install
```

### 第二步：把本地的区块链跑起来
我们用 Hardhat 模拟了一条本地区块链，用来演示最终结果上链存证。
```bash
# 启动本地 Hardhat 节点
pnpm contract:node
```
*启动后不要关掉这个终端，新开一个终端继续操作。*

新开的终端里，把审计合约部署上去：
```bash
pnpm contract:deploy
```
*注意：部署成功后，控制台会输出合约地址（Contract deployed to: 0x...），把它复制下来。*

### 第三步：跑前后端服务
```bash
pnpm dev
```
启动后：
- 前端地址：`http://localhost:18340` (如果端口冲突，看终端输出)
- 后端 API 地址：`http://localhost:3001`
打开前端浏览器就能开始操作了！

---

## 3. 核心功能说明（评委/老师演示指南）

我们在前端做了**双门户设计**，可以在左上角切换：

1. **投票端 (Voter Portal)**
   - 给普通选民用的，可以注册账户、投票、查看投票结果。
   - 投票后会给一个“回执码”，大家可以用这个回执码在“公告板”里查到自己的加密票，确认自己的票确实被计入统计了，没有被后台管理员丢弃。

2. **审计与管理后台 (Admin & Audit Console)**
   - 专门给管理员、审计员和评委看的。
   - **公告板 (Bulletin Board)**：公开展示所有加密投票。
   - **聚合器审计 (Aggregator)**：自动检查有没有人重复投票、有没有恶意篡改的假票。
   - **零知识证明 (ZK 验证)**：证明每张票是否合法（是否满足 one-hot 限制，比如没有多选、数据格式正确）。
   - **链上存证 (智能合约)**：把最终的投票 Merkle 根、审计哈希直接发到本地部署的 Hardhat 合约上存证。即使有人黑进数据库改了票数，和链上哈希也对不上，一眼就能看出来。

---

## 4. 密码学与 ZK 验证说明

本系统支持两种 ZK 验证模式：

### 模式 A：Mock ZK (推荐快速演示)
- 不需要本地安装 Circom 和生成证明。
- 在前端 ZK 验证页面，选择 "Mock ZK Validity Proof" 就能秒过，方便展示业务逻辑 and 失败路径。

### 模式 B：Real ZK 真实证明 (选做)
需要你本地安装了 `circom` (并在命令行可以执行 `circom --version`)。
1. 在终端运行：
   ```bash
   pnpm zk:setup
   ```
   这会进行 ZK 可信设置并编译电路（可能需要两三分钟，视配置而定）。
2. 可以跑一下命令行 demo 验证：
   ```bash
   pnpm zk:demo
   ```
3. 在启动前后端后，在前端页面选择 "Real Groth16 ZK Proof" 进行真实的零知识证明生成与校验。

---

## 5. 开发常见问题

### 1. 数据怎么重启就没了？
后端默认是把数据存在内存里的，为了开发调试方便。如果想持久化，可以去配置环境变量切换成 SQLite 数据库：
在 `apps/api/.env`（或者直接在环境变量里）设置 `VERIVOTE_PERSISTENCE=sqlite`，它就会自动在 `apps/api/data/verivote.db` 落地。

### 2. 总是提示端口占用怎么办？
如果退出了服务，但有些后台端口（3001, 18340）还没释放，可以在 PowerShell 运行以下命令一键清理：
```powershell
$ports = @(3001, 18340, 5173, 8545)
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
*感谢老师和评委的测试！项目还在不断打磨中。*
