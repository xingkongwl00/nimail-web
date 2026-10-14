# 📬 Temp Mail — 临时邮箱网站（mail.tm 版）

免费临时邮箱网站：**一键创建、一键复制、实时查看收件箱与邮件正文**。
基于 [mail.tm](https://temp-mail.io/zh) 开放 API 的零依赖 Node.js 代理实现，克隆即用、开箱即跑。

> ✨ **零第三方依赖** —— 不需要 `npm install`，只要有 Node.js ≥ 18，`node server.js` 即可运行。

## ✨ 功能特性

| 功能 | 说明 |
|---|---|
| ✉️ 创建临时邮箱 | 一键随机创建，或自定义邮箱名 + 自选可用域名 |
| 📋 复制邮箱 | 大号展示邮箱地址，一键复制（含剪贴板降级方案） |
| 📥 查看邮箱信息 | 创建时间 / 收件计数 / 已用配额 / 账号 ID 实时展示 |
| 📨 实时收件箱 | 每 7.5 秒自动轮询，展示发件人 / 主题 / 时间 / 大小 / 附件标记 |
| 🪟 邮件正文 | 沙箱 iframe 安全渲染原始 HTML，支持复制正文 / 查看原文 / 删除邮件 |
| 🧹 邮箱管理 | 删除单封 / 批量删除 / 换一个邮箱 / 注销销毁 |
| 💾 断点恢复 | localStorage 记住账号，刷新页面不丢失，token 过期自动重登 |
| 🛡️ 限流保护 | 上游 429 时自动降速暂停，30 秒后恢复 |
| 📱 移动端适配 | 响应式布局，触控区域 ≥ 44px |

## 🚀 快速开始

### 方式一：直接运行（推荐，零依赖）

```bash
# 克隆仓库
git clone https://github.com/xingkongwl00/nimail-web.git
cd nimail-web

# 启动（无需 npm install）
node server.js
```

打开浏览器访问 <http://localhost:3000> 即可使用。

自定义端口：

```bash
PORT=8080 node server.js
```

### 方式二：Docker

```bash
docker build -t mailtm-web .
docker run -d -p 3000:3000 --name mailtm-web --restart unless-stopped mailtm-web
```

或使用 docker-compose：

```bash
docker compose up -d
```

### 方式三：一键部署到云平台

仓库已包含 `Dockerfile`，支持 Railway / Render / Zeabur / 自有服务器等任意 Docker 平台部署。
Render 等平台会自动识别 Node 项目，构建命令 `npm start`、启动命令 `node server.js`。

## 🏗️ 架构说明

```
浏览器（public/ 静态页面）
   │  fetch /api/*  （Authorization: Bearer <JWT>）
   ▼
server.js（零依赖 Node http 服务）
   │  静态文件服务 + API 反向代理
   ▼
https://api.mail.tm（mail.tm 开放 API）
```

**为什么需要代理？** mail.tm API 不返回 CORS 响应头，浏览器无法跨域直连，
因此由本服务在同源环境下转发请求，前端零跨域问题。

### 代理接口一览（上游规范见 https://docs.mail.tm）

| 前端接口 | 上游接口 | 说明 |
|---|---|---|
| `GET /api/domains` | `GET /domains` | 可用域名列表 |
| `POST /api/accounts` | `POST /accounts` | 创建账号 `{ address, password }` |
| `POST /api/token` | `POST /token` | 登录换取 JWT `{ address, password }` |
| `GET /api/me` | `GET /me` | 当前账号信息（需 Bearer） |
| `GET /api/messages` | `GET /messages` | 邮件列表（需 Bearer，支持 `?page=`） |
| `GET /api/messages/:id` | `GET /messages/:id` | 邮件详情（需 Bearer） |
| `PATCH /api/messages/:id` | `PATCH /messages/:id` | 标记已读（需 Bearer） |
| `DELETE /api/messages/:id` | `DELETE /messages/:id` | 删除邮件（需 Bearer） |
| `GET /api/sources/:id` | `GET /sources/:id` | 邮件原始源（需 Bearer） |
| `DELETE /api/account/:id` | `DELETE /accounts/:id` | 注销账号（需 Bearer） |
| `GET /healthz` | — | 健康检查 |

## 📁 目录结构

```
nimail-web/
├── server.js            # 零依赖 Node 服务（静态 + API 代理）
├── package.json         # 无 dependencies，声明 engines 与启动脚本
├── public/
│   ├── index.html       # 页面结构
│   ├── style.css        # 样式（响应式 / 移动端适配）
│   └── app.js           # 前端逻辑（创建/复制/收件/详情/销毁/限流降速）
├── ui-test.js           # Playwright UI 端到端测试（开发用）
├── Dockerfile           # 容器化（node:22-alpine，含 HEALTHCHECK）
├── docker-compose.yml   # 编排文件
├── LICENSE              # MIT
└── README.md
```

## ⚠️ 已知限制（上游行为，非本站问题）

| 项 | 说明 |
|---|---|
| 公共域名 | mail.tm 公共域名池动态变化（当前仅 `maxxspace.com`），页面自动拉取实时列表 |
| 接口限流 | 上游约 30 次/分钟，前端 7.5s 轮询（约 8 次/分钟）+ 429 自动降速，正常使用无感知 |
| 账号生命周期 | mail.tm 账号长期有效直至注销，但长时间不活跃可能被上游回收 |

## 🧪 UI 测试

仓库内置 Playwright 端到端测试（需本机有 Playwright Chromium）：

```bash
node ui-test.js   # 先启动服务，再运行；覆盖创建/复制/恢复/换一个/销毁全流程
```

## ⚠️ 免责声明

- 本服务仅用于**学习和临时系统测试**，严禁用于任何非法、欺诈、侵权或违反公序良俗的行为。
- 临时邮箱邮件**不加密**，任何人知道地址即可查看内容，请勿用于接收敏感信息。
- 邮箱与邮件由 [mail.tm](https://temp-mail.io/zh) 提供，请遵守上游服务条款，勿滥用接口。

## 📄 License

[MIT](./LICENSE) © contributors
