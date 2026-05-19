# VeriVote
隐私保护可验证电子投票与审计平台

这个分支把后端改成了 Python / FastAPI，前端、合约、电路和文档结构都保留着，方便继续演示、调试和扩展。

## 这条分支有什么

- Python 后端 API
- 投票、回执、公告板、聚合器、攻击演示
- Mock / Real ZK validity proof
- batch tally correctness proof
- cast-or-challenge 挑战审计
- 链上审计摘要提交
- Zeeperio 风格 artifact 导出

## 目录

- `apps/api`：Python 后端
- `apps/web`：前端页面
- `packages/shared`：共享类型
- `packages/crypto`、`packages/zk`：原 TypeScript 算法实现，保留给前端和脚本参考
- `contracts`：Hardhat / Solidity
- `circuits`：Circom 电路
- `docs`：部署、ZK、审计、威胁模型等文档

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

## 常用命令

```bash
pnpm --filter @verivote/api start
pnpm --filter @verivote/api build
pnpm --filter @verivote/web dev
pnpm benchmark
pnpm zk:setup
pnpm zk:demo
pnpm contract:compile
pnpm contract:test
```

## 关键文件

- `apps/api/src/verivote_api/main.py`
- `apps/api/src/verivote_api/crypto.py`
- `apps/api/src/verivote_api/zk.py`
- `apps/api/src/verivote_api/persistence.py`
- `apps/api/requirements.txt`
- `Dockerfile.api`
- `docker-compose.yml`
- `docs/DEPLOYMENT.md`

## 说明

- `VERIVOTE_PERSISTENCE=memory`：内存模式
- `VERIVOTE_PERSISTENCE=sqlite`：SQLite 持久化
- Real ZK 需要先跑 `pnpm zk:setup`
- 如果用 Docker，直接 `docker compose up -d --build`

