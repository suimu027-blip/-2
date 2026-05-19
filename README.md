# VeriVote

隐私保护可验证电子投票与审计平台。

VeriVote 是一个面向信息安全比赛和课程答辩的电子投票安全原型。它的目标不是直接做生产级投票系统，而是把“隐私保护、可验证投票、公开审计、攻击检测”做成一条能够演示、能够解释、能够验收的完整链路。

当前分支已经把后端迁移到 Python / FastAPI，并保留前端、合约、电路、ZK 脚本和文档体系，方便继续演示和扩展。

## 项目已经做了什么

### 1. 后端迁移到 Python / FastAPI

- 建立了 Python 后端入口：`apps/api/src/verivote_api/main.py`
- 拆分了核心模块：
  - `crypto.py`：commitment、receipt chain、Merkle、Pedersen 辅助逻辑
  - `persistence.py`：内存 / SQLite 持久化
  - `zk.py`：Mock / Real ZK proof、tally correctness proof 相关逻辑
- 保留了 Docker、部署文档和原有 TypeScript 包，便于后续扩展。

### 2. 完成主投票闭环

系统已经可以完整跑通：

```text
创建选举 -> 添加候选人 -> 注册用户 -> 投票 -> 生成回执
-> 公告板公开 -> 聚合器计票 -> 回执 / Merkle / 聚合结果验证
```

已经具备：

- 用户注册
- 创建 election
- 添加候选人
- 投票并生成 `receiptCode`
- 查询 receipt
- 生成 bulletin board
- 生成 Merkle Root
- 查询 Merkle inclusion proof
- 运行 aggregator
- 查看 tally result 和 audit report

### 3. 加入 Haechi 风格挑战审计

项目已经加入 `cast-or-challenge` 流程：

- 可以先生成 pending ballot
- 用户可以选择 cast，让 ballot 进入正式 tally
- 用户也可以选择 challenge，公开 opening 信息
- challenge 的 ballot 只用于审计，不进入正式计票
- 系统会验证 opening 是否能打开对应 commitment

这部分用于展示“票已被正确构造，但不泄露正式投票内容”的审计思路。

### 4. 加入 Aggios 风格聚合器

聚合器现在不只是简单计票，还会输出可解释的审计报告：

- 区分有效票、重复票、非法票
- 使用 `voteTokenHash` 检测重复投票
- 非法候选项不会进入正式 tally
- 输出 `commitmentRoot`、`receiptRoot`、`auditHash`
- 支持 tally consistency check，能发现结果被篡改

### 5. 加入 Zeeperio 风格公开审计

系统已经具备公开审计和证据导出能力：

- Bulletin board 公开 commitment、receipt hash、Merkle Root
- Aggregator report 公开聚合摘要
- Chain audit 支持 local mock 模式记录摘要
- 导出 Zeeperio 风格 artifact bundle
- 支持导出：
  - `bulletin_board.json`
  - `aggregator_report.json`
  - `zk_summary.json`
  - `chain_audit.json`
  - `public_inputs.json`

### 6. 加入 ZK / Pedersen 实验模块

项目中已经包含比赛展示用的密码学增强模块：

- Mock ZK validity proof
- Real Groth16 ZK validity proof 接口
- Tally correctness proof 骨架
- Pedersen-style commitment
- Pedersen opening verification
- Pedersen aggregate verification

这些模块用于展示更接近论文思想的承诺、开口验证和聚合验证能力。

### 7. 加入攻击演示和安全测试

当前已经支持以下攻击演示：

- 重复投票
- 注入重复票
- 注入非法票
- 篡改 commitment
- 删除 vote
- 篡改 tally
- 伪造 ZK publicSignals
- 篡改 Pedersen 聚合 opening
- 链上摘要与链下结果不一致

对应的自动化验收脚本是：

```bash
python scripts/api_smoke_test.py
```

也可以运行完整验收：

```bash
pnpm verify:plan
```

## 现在项目处于什么状态

当前项目已经达到“比赛原型可交付”状态：

- 能运行
- 能演示
- 能验证
- 能解释
- 能做攻击演示
- 能导出审计材料
- 能用脚本自动验收核心闭环

完整状态说明见：

- `docs/PROJECT_STATUS_AND_NEXT_STEPS.md`
- `docs/COMPETITION_DELIVERY.md`
- `docs/DEMO_SCRIPT.md`
- `docs/SECURITY_TESTS.md`

## 还需要继续做什么

当前项目已经完成比赛原型，但如果继续往更高质量、论文级或生产级方向推进，还需要补以下内容。

### 1. 更正式的密码学证明

当前 Pedersen / ZK 模块适合比赛展示，但还不是完整论文级复现。后续可以继续做：

- 更完整的 Pedersen 向量承诺
- 更严格的聚合承诺证明
- 把更多 public signals 绑定进真实电路
- 把 Mock ZK 流程逐步替换为真实 Groth16 / Plonk 证明
- 接近 Aggios EPA 的正式聚合证明

### 2. 更完整的链上审计

当前默认使用 local mock chain audit，适合稳定演示。后续可以继续做：

- 部署真实 Hardhat 本地链
- 连接真实 Solidity verifier
- 把 `submitAuditWithTallyProof` 作为默认链路
- 增加链上事件查询和前端展示
- 增加重复提交、错误摘要提交、错误 proof 提交的合约测试

### 3. 更真实的身份和权限系统

当前用户注册是比赛原型级模拟身份。后续如果要更接近真实投票系统，需要：

- 选民白名单
- 管理员权限
- 用户签名
- token / nullifier 防伪
- 防批量注册刷票
- 更清晰的角色隔离

### 4. 更系统的自动化测试

当前已经有 `api_smoke_test.py` 覆盖主闭环和安全边界。后续可以继续拆成更正式的测试体系：

- Python API 单元测试
- FastAPI 集成测试
- 前端 Playwright 流程测试
- Solidity 合约测试
- ZK artifact 存在时的 real proof 测试
- CI 自动运行 `pnpm verify:plan`

### 5. 更完整的比赛材料

项目已经有演示脚本和交付说明，后续参赛前还建议继续准备：

- 答辩 PPT
- 系统架构图
- 数据流图
- 威胁模型图
- 攻击演示截图
- `pnpm verify:plan` 运行截图
- 3 到 5 分钟录屏
- 讲解稿

## 目录结构

- `apps/api`：Python / FastAPI 后端
- `apps/web`：React 前端
- `packages/shared`：前后端共享类型
- `packages/crypto`：原 TypeScript 密码学辅助实现
- `packages/zk`：原 TypeScript ZK 辅助实现
- `contracts`：Hardhat / Solidity 合约
- `circuits`：Circom 电路
- `scripts`：benchmark、ZK setup、API 验收脚本
- `docs`：部署、架构、论文映射、安全测试、交付材料

## 快速开始

### 1. 安装依赖

```bash
pnpm install
python -m pip install -r apps/api/requirements.txt
```

### 2. 启动后端

PowerShell：

```powershell
Set-Location "E:\jingsai\--main\verivote-main (1)\verivote-main"
$env:PYTHONPATH="apps/api/src"
$env:VERIVOTE_PERSISTENCE="memory"
python -m uvicorn verivote_api.main:app --app-dir apps/api/src --host 127.0.0.1 --port 3001
```

### 3. 启动前端

```bash
pnpm --filter @verivote/web dev
```

### 4. 打开页面

- 后端健康检查：`http://127.0.0.1:3001/health`
- 前端页面：`http://127.0.0.1:5173`

## 验收命令

### 完整验收

```bash
pnpm verify:plan
```

这条命令会依次执行：

1. 所有核心包 typecheck
2. 后端主闭环和安全矩阵烟测
3. 前端生产构建

### 单独验证后端闭环

```bash
pnpm test:api-smoke
```

或：

```bash
python scripts/api_smoke_test.py
```

## 常用命令

```bash
pnpm --filter @verivote/api start
pnpm --filter @verivote/api build
pnpm --filter @verivote/web dev
pnpm test:api-smoke
pnpm verify:plan
pnpm benchmark
pnpm zk:setup
pnpm zk:demo
pnpm contract:compile
pnpm contract:test
```

## 关键文档

- `docs/PROJECT_STATUS_AND_NEXT_STEPS.md`：项目完成状态和后续路线
- `docs/COMPETITION_DELIVERY.md`：比赛交付说明
- `docs/DEMO_SCRIPT.md`：现场演示脚本
- `docs/SECURITY_TESTS.md`：安全测试矩阵
- `docs/THREAT_MODEL.md`：威胁模型
- `docs/PAPER_MAPPING.md`：三篇论文映射
- `docs/DEPLOYMENT.md`：部署说明

## 运行模式说明

- `VERIVOTE_PERSISTENCE=memory`：内存模式，适合演示和测试
- `VERIVOTE_PERSISTENCE=sqlite`：SQLite 持久化模式
- Real ZK 需要先运行 `pnpm zk:setup`
- Docker 部署可运行 `docker compose up -d --build`

## 一句话总结

VeriVote 当前已经从一个基础投票原型完善成了一个能完整演示“隐私承诺、回执验证、聚合审计、挑战审计、公开摘要、安全攻击检测、ZK/Pedersen 实验”的比赛项目。后续主要工作不再是补 MVP，而是继续增强真实密码学证明、链上验证、身份系统和答辩材料。
