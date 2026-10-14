#!/usr/bin/env node
/**
 * mailtm-web —— 临时邮箱网站（mail.tm 版）
 * 零第三方依赖：只需要 Node.js >= 18，直接 `node server.js` 即可运行。
 *
 * 架构说明：
 *   mail.tm API (https://api.mail.tm) 不返回 CORS 头，
 *   浏览器无法跨域直连，因此由本服务做后端代理：
 *     前端  ->  /api/*  ->  https://api.mail.tm/*
 *   前端把登录拿到的 JWT 放在 Authorization: Bearer <token> 头上，
 *   本服务原样透传给上游。
 *
 * 代理接口一览（详见 https://docs.mail.tm）：
 *   GET    /api/domains            可用域名列表
 *   POST   /api/accounts           创建账号        { address, password }
 *   POST   /api/token              登录换取 JWT     { address, password }
 *   GET    /api/me                 当前账号信息（需 Bearer）
 *   GET    /api/messages           邮件列表（需 Bearer，支持 ?page=）
 *   GET    /api/messages/:id       邮件详情（需 Bearer）
 *   PATCH  /api/messages/:id       标记已读（需 Bearer）
 *   DELETE /api/messages/:id       删除邮件（需 Bearer）
 *   GET    /api/sources/:id        邮件原始源（需 Bearer）
 *   DELETE /api/account/:id        注销账号（需 Bearer）
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const MAILTM = "https://api.mail.tm";
const PUBLIC_DIR = path.join(__dirname, "public");
const UPSTREAM_TIMEOUT = 20000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".zip": "application/zip",
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

/**
 * 通用上游转发：原样透传 method / body / Authorization，自动跟随跳转。
 * 返回 { status, headers, buffer }
 */
function forward(method, apiPath, { body, auth, contentType, depth = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(MAILTM + apiPath);
    const headers = {
      accept: "application/json",
      "accept-language": "zh-CN,zh",
      "user-agent": UA,
    };
    if (contentType) headers["content-type"] = contentType;
    if (auth) headers["authorization"] = auth;
    let payload;
    if (body !== undefined) {
      payload = typeof body === "string" ? body : JSON.stringify(body);
      headers["content-length"] = Buffer.byteLength(payload);
    }
    const req = https.request(
      {
        method,
        hostname: target.hostname,
        port: 443,
        path: target.pathname + target.search,
        headers,
      },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && depth < 3) {
          res.resume();
          const next = new URL(res.headers.location, MAILTM);
          return resolve(forward(method, next.pathname + next.search, { body, auth, contentType, depth: depth + 1 }));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) })
        );
      }
    );
    req.setTimeout(UPSTREAM_TIMEOUT, () => req.destroy(new Error("upstream timeout")));
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

/** 把上游响应原样透传给前端（保留 content-type） */
function pipeUpstream(res, r) {
  const headers = { "content-type": r.headers["content-type"] || "application/json; charset=utf-8", "cache-control": "no-store" };
  if (r.headers["content-disposition"]) headers["content-disposition"] = r.headers["content-disposition"];
  res.writeHead(r.status, headers);
  res.end(r.buffer);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1e6) throw new Error("body too large");
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** 发送静态文件 */
function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found");
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = u.pathname;
  const auth = req.headers["authorization"] || "";

  try {
    // ---------- 域名列表（无需登录） ----------
    if (req.method === "GET" && pathname === "/api/domains") {
      return pipeUpstream(res, await forward("GET", "/domains"));
    }

    // ---------- 创建账号 ----------
    if (req.method === "POST" && pathname === "/api/accounts") {
      const { address, password } = await readJsonBody(req);
      if (!address || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
        return sendJson(res, 400, { message: "邮箱地址不合法" });
      }
      if (!password || String(password).length < 8) {
        return sendJson(res, 400, { message: "密码至少 8 位" });
      }
      return pipeUpstream(res, await forward("POST", "/accounts", {
        body: { address, password },
        contentType: "application/json",
      }));
    }

    // ---------- 登录换 token ----------
    if (req.method === "POST" && pathname === "/api/token") {
      const { address, password } = await readJsonBody(req);
      if (!address || !password) {
        return sendJson(res, 400, { message: "缺少 address / password" });
      }
      return pipeUpstream(res, await forward("POST", "/token", {
        body: { address, password },
        contentType: "application/json",
      }));
    }

    // ---------- 以下接口都需要 Bearer token ----------
    let m = pathname.match(/^\/api\/messages\/([^/]+)$/);
    if (m) {
      if (!auth.toLowerCase().startsWith("bearer ")) {
        return sendJson(res, 401, { message: "未登录或登录已过期" });
      }
      if (req.method === "GET") {
        return pipeUpstream(res, await forward("GET", `/messages/${m[1]}`, { auth }));
      }
      if (req.method === "DELETE") {
        return pipeUpstream(res, await forward("DELETE", `/messages/${m[1]}`, { auth }));
      }
      if (req.method === "PATCH") {
        return pipeUpstream(res, await forward("PATCH", `/messages/${m[1]}`, {
          auth, body: { seen: true }, contentType: "application/merge-patch+json",
        }));
      }
    }

    m = pathname.match(/^\/api\/sources\/([^/]+)$/);
    if (m && req.method === "GET") {
      if (!auth.toLowerCase().startsWith("bearer ")) {
        return sendJson(res, 401, { message: "未登录或登录已过期" });
      }
      return pipeUpstream(res, await forward("GET", `/sources/${m[1]}`, { auth }));
    }

    m = pathname.match(/^\/api\/account\/([^/]+)$/);
    if (m && req.method === "DELETE") {
      if (!auth.toLowerCase().startsWith("bearer ")) {
        return sendJson(res, 401, { message: "未登录或登录已过期" });
      }
      return pipeUpstream(res, await forward("DELETE", `/accounts/${m[1]}`, { auth }));
    }

    if (req.method === "GET" && pathname === "/api/me") {
      if (!auth.toLowerCase().startsWith("bearer ")) {
        return sendJson(res, 401, { message: "未登录或登录已过期" });
      }
      return pipeUpstream(res, await forward("GET", "/me", { auth }));
    }

    if (req.method === "GET" && pathname === "/api/messages") {
      if (!auth.toLowerCase().startsWith("bearer ")) {
        return sendJson(res, 401, { message: "未登录或登录已过期" });
      }
      const q = u.search || "";
      return pipeUpstream(res, await forward("GET", `/messages${q}`, { auth }));
    }

    // ---------- 健康检查 ----------
    if (pathname === "/healthz") {
      return sendJson(res, 200, { ok: true, ts: Date.now() });
    }

    // ---------- 静态资源 ----------
    if (req.method === "GET") return serveStatic(res, pathname);

    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
  } catch (e) {
    log("error:", e.message);
    sendJson(res, 502, { message: "上游服务异常: " + e.message });
  }
});

server.listen(PORT, HOST, () => {
  log(`mailtm-web 已启动: http://localhost:${PORT}`);
  log(`上游代理目标: ${MAILTM}`);
});
