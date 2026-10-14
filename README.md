# 📬 nimail-web — 临时邮箱网站

免费临时邮箱（10 分钟邮箱）网站：**一键申请、一键复制、实时查看收件箱与邮件正文**。
基于 [NiMail](https://www.nimail.cn/) 开放 API 的零依赖 Node.js 代理实现，克隆即用、开箱即跑。

> ✨ **零第三方依赖** —— 不需要 `npm install`，只要有 Node.js ≥ 18，`node server.js` 即可运行。

## ✨ 功能特性

| 功能 | 说明 |
|---|---|
| ✉️ 申请临时邮箱 | 一键随机申请，或自定义邮箱名（字母数字），有效期 10 分钟 |
| 📋 复制邮箱 | 大号展示邮箱地址，一键复制（含剪贴板降级方案） |
| 📥 查看邮箱信息 | 创建时间 / 到期时间 / 收件计数 / 邮箱状态实时展示 |
| ⏱️ 倒计时 | 10 分钟有效期倒计时，临到期变色提醒，到期自动提示 |
| 📨 实时收件箱 | 每 7.5 秒自动轮询，展示发件人 / 主题 / 时间 / 大小 / 附件标记 |
| 🪟 邮件正文 | 沙箱 iframe 安全渲染原始 HTML，支持复制正文 / 新窗口打开 / 下载原文件 |
| 🧹 邮箱管理 | 删除单封 / 批量删除 / 打包下载（zip）/ 发送测试邮件 / 续期 / 销毁 / 换一个 |
| 💾 断点恢复 | localStorage 记住当前邮箱，刷新页面不丢失 |
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
docker build -t nimail-web .
docker run -d -p 3000:3000 --name nimail-web --restart unless-stopped nimail-web
```

或使用 docker-compose：

```bash
docker compose up -d
```

### 方式三：一键部署到云平台

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/nimail-web)

仓库已包含 `Dockerfile`，支持 Railway / Render / Zeabur / 自有服务器等任意 Docker 平台部署。
Render 等平台会自动识别 Node 项目，构建命令 `npm start`、启动命令 `node server.js`。

## 🏗️ 架构说明

```
浏览器（public/ 静态页面）
   │  fetch /api/*
   ▼
server.js（零依赖 Node http 服务）
   │  静态文件服务 + API 反向代理
   ▼
https://www.nimail.cn/api/*（NiMail 开放 API）
```

**为什么需要代理？** NiMail API 不返回 CORS 响应头，浏览器无法跨域直连，
因此由本服务在同源环境下转发请求，前端零跨域问题。

### 代理接口一览

| 前端接口 | 上游接口 | 说明 |
|---|---|---|
| `POST /api/apply` | `POST /api/applymail` | 申请邮箱 `{ mail }` |
| `POST /api/mails` | `POST /api/getmails` | 邮件列表 `{ mail, time }` |
| `GET /api/mail/:mail/:id` | `GET /api/raw-html/:mail/:id` | 邮件正文（raw-html） |
| `POST /api/delmail` | `POST /api/delmail` | 删除邮件 `{ delMail: "id1,id2" }` |
| `POST /api/destroy` | `POST /api/destroymail` | 销毁邮箱 `{ mail }` |
| `POST /api/test` | `POST /api/test` | 发送测试邮件 `{ mail }` |
| `GET /api/download/:mail/:id` | `GET /api/download/:mail/:id` | 下载单封邮件原文件 |
| `GET /api/download/:mail/all.zip` | `GET /api/download/:mail/all.zip` | 打包下载全部邮件 |
| `GET /healthz` | — | 健康检查 |

## 📁 目录结构

```
nimail-web/
├── server.js            # 零依赖 Node 服务（静态 + API 代理）
├── package.json         # 无 dependencies，声明 engines 与启动脚本
├── public/
│   ├── index.html       # 页面结构
│   ├── style.css        # 样式（响应式 / 移动端适配）
│   └── app.js           # 前端逻辑（申请/复制/收件/倒计时/销毁）
├── Dockerfile           # 容器化（node:22-alpine，含 HEALTHCHECK）
├── docker-compose.yml   # 编排文件
├── LICENSE              # MIT
└── README.md
```

## ⚠️ 免责声明

- 本服务仅用于**学习和临时系统测试**，严禁用于任何非法、欺诈、侵权或违反公序良俗的行为。
- 临时邮箱邮件**不加密**，任何人知道地址即可查看内容，请勿用于接收敏感信息。
- 邮箱与邮件由 [NiMail](https://www.nimail.cn/) 提供，生命周期仅 10 分钟，请及时查看。
- 请遵守上游平台服务条款，合理使用，勿滥用接口。

## ⚠️ 已知限制（上游行为，非本站问题）

| 项 | 说明 |
|---|---|
| 删除邮件 `/api/delmail` | 上游依赖会话状态，无会话调用返回 `Invalid email address`，删除按钮可能失败；其余功能不受影响 |
| 测试邮件 `/api/test` | 上游偶发返回空响应，测试邮件不保证送达 |
| 邮箱有效期 | 固定 10 分钟，到期后邮箱与邮件一并被上游清除，无法找回 |

## 📄 License

[MIT](./LICENSE) © nimail-web contributors
