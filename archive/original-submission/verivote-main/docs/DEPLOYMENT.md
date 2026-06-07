# VeriVote 服务化部署指南

本文档描述三种部署形态：

1. **本地开发**（`pnpm dev:*`）
2. **本地 Docker 一键启动**（`docker compose up -d`）
3. **生产级服务化部署**（Nginx / systemd / VPS / Kubernetes）

涉及的重要环境变量集中在 `.env.example`，部署前请先 `cp .env.example .env` 并按需修改。

## 1. 环境变量速查

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | API 监听端口 |
| `VERIVOTE_PERSISTENCE` | `auto` | `auto` / `memory` / `sqlite`。`auto` 在找不到 `better-sqlite3` 时自动退回 memory |
| `VERIVOTE_SQLITE_PATH` | `./data/verivote.db` | SQLite 数据库路径 |
| `BLOCKCHAIN_AUDIT_MODE` | `local-mock` | `local-mock` / `hardhat` |
| `HARDHAT_RPC_URL` | `http://127.0.0.1:8545` | Hardhat 链上审计 RPC |
| `HARDHAT_PRIVATE_KEY` | _unset_ | Hardhat 发送交易用的私钥；未设置则使用默认 signer |
| `AUDIT_CONTRACT_ADDRESS` | _unset_ | Hardhat 模式下 `VeriVoteAudit` 合约地址 |
| `VERIVOTE_ZK_ARTIFACT_DIR` | `./zk-artifacts/valid-vote` | Real ZK artifacts 目录（single-vote 合法性证明）|
| `VERIVOTE_ZK_TALLY_ARTIFACT_DIR` | `./zk-artifacts/tally-correctness` | Tally correctness 电路 artifacts 目录 |
| `VITE_API_BASE_URL` | `http://localhost:3001` | 前端打包时注入 |

## 2. Docker 一键启动

### 2.1 启动 API + Web

```bash
cp .env.example .env
docker compose up -d --build
```

访问：

- Web: http://localhost:18340
- API: http://localhost:3001/health

首次构建会用 pnpm 做 workspace 多阶段安装与编译；之后的 `docker compose up` 会重用缓存。

### 2.2 可选：启动本地 Hardhat 节点

```bash
docker compose --profile hardhat up -d
```

这会在 8545 端口起一个 Hardhat 节点。然后再：

```bash
docker compose exec hardhat pnpm contract:deploy -- --network localhost
```

拿到输出的合约地址，写进 `.env`：

```
BLOCKCHAIN_AUDIT_MODE=hardhat
HARDHAT_RPC_URL=http://hardhat:8545
AUDIT_CONTRACT_ADDRESS=0x...
```

然后重启 api：

```bash
docker compose restart api
```

### 2.3 持久化数据

`docker-compose.yml` 声明了命名卷 `verivote_data`，挂到 `/data`，API 的 SQLite 文件写在 `/data/verivote.db`。用 `docker volume inspect verivote_data` 可以查看宿主路径；`docker volume rm verivote_data` 可清空。

## 3. 本地手动部署（systemd + Nginx）

适合把 API 跑在一台 VPS（Ubuntu/Debian）上，用 systemd 管理进程，Nginx 做静态站点和反向代理。

### 3.1 服务器初始化

```bash
sudo apt update && sudo apt install -y nginx git build-essential
# Install Node 22 (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pnpm@10.33.3
```

### 3.2 拉代码并构建

```bash
sudo useradd -r -m -d /opt/verivote -s /bin/bash verivote
sudo -u verivote bash -lc 'cd ~ && git clone <repo-url> app && cd app && pnpm install --frozen-lockfile && pnpm build'
```

### 3.3 环境变量

```bash
sudo -u verivote bash -lc 'cp /opt/verivote/app/.env.example /opt/verivote/.env'
# 编辑 /opt/verivote/.env
```

### 3.4 systemd 单元文件

把下面的内容保存为 `/etc/systemd/system/verivote-api.service`：

```ini
[Unit]
Description=VeriVote API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=verivote
Group=verivote
WorkingDirectory=/opt/verivote/app
EnvironmentFile=/opt/verivote/.env
ExecStart=/usr/bin/node apps/api/dist/index.js
Restart=on-failure
RestartSec=5
LimitNOFILE=65536
# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/verivote/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo mkdir -p /opt/verivote/data
sudo chown verivote:verivote /opt/verivote/data
sudo systemctl daemon-reload
sudo systemctl enable --now verivote-api
sudo systemctl status verivote-api
```

### 3.5 Nginx 反向代理 + 静态前端

把 `apps/web/dist/` 复制到 `/var/www/verivote/`：

```bash
sudo rsync -a /opt/verivote/app/apps/web/dist/ /var/www/verivote/
```

配置 `/etc/nginx/sites-available/verivote.conf`：

```nginx
server {
    listen 80;
    server_name verivote.example.com;

    root /var/www/verivote;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

启用站点、上 HTTPS：

```bash
sudo ln -s /etc/nginx/sites-available/verivote.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d verivote.example.com
```

注意：用 `/api/` 前缀代理时，前端需要把 `VITE_API_BASE_URL` 设置成同域 `/api`，再重新 `pnpm --filter @verivote/web build` 并同步静态文件。

## 4. Kubernetes 最简部署（可选）

仓库内暂未提供完整 Helm chart，但结构化 Dockerfile 已足够：

- `verivote/api:<tag>` → Deployment，挂 `PersistentVolumeClaim` 到 `/data`，envFrom 引入 Secret（含 `HARDHAT_PRIVATE_KEY`、`AUDIT_CONTRACT_ADDRESS`）。
- `verivote/web:<tag>` → Deployment + Service + Ingress（Nginx Ingress Controller）。
- Service 间通信：前端环境变量 `VITE_API_BASE_URL` 指向 Ingress 的同域 `/api`。

## 5. 升级 / 回滚

- Docker：`docker compose pull && docker compose up -d --build`
- systemd：`git pull && pnpm install && pnpm build && sudo systemctl restart verivote-api`
- 回滚：切回上一次 tag，重启服务即可；SQLite schema 为 KV payload + JSON，通常无需迁移。如未来改 schema，`data/` 目录需备份。

## 6. 运维观察点

- `GET /health` 返回 `{ok:true}`。Docker 和 Nginx 健康检查均可直接探测。
- 日志：启动时会打印 `persistence: memory|sqlite`；链上交易失败会走 500 + 错误信息。
- 指标：当前版本没有集成 Prometheus exporter。后续可在 API 里加 `pino` + OpenTelemetry。
- 备份：SQLite 文件定期 `cp verivote.db verivote.db.$(date +%F)`，或 `sqlite3 verivote.db ".backup verivote.backup.db"`。

## 7. 安全清单（部署前必看）

- 不要把 `.env` 推到 Git，务必加 `.env` 到 `.gitignore`（已加）。
- 生产环境不要开 CORS 通配符。若需要限制，在 Nginx 或代码层按域名白名单处理。
- `/attack/*` 接口仅用于演示，部署正式环境前应加管理员鉴权或直接关闭（可在 Nginx 层 `deny all`）。
- Real ZK 的 `zk-artifacts/` 不要上 Git，部署时从可信源拉取，或在部署节点本地重新 `pnpm zk:setup`。
- Hardhat 私钥属于敏感信息，请务必放 Secret，而不是明文 `.env` 文件。
