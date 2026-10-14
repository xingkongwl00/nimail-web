#!/usr/bin/env node
/**
 * nimail-web —— 临时邮箱网站
 * 零第三方依赖：只需要 Node.js >= 18，直接 `node server.js` 即可运行。
 *
 * 架构说明：
 *   NiMail 官方 API (https://www.nimail.cn/api/*) 不返回 CORS 头，
 *   浏览器无法跨域直连，因此由本服务做后端代理：
 *     前端  ->  /api/*  ->  https://www.nimail.cn/api/*
 *
 * 代理接口一览：
 *   POST /api/apply           申请邮箱        { mail }
 *   POST /api/mails           邮件列表        { mail, time }
 *   GET  /api/mail/:mail/:id  邮件正文(raw-html)
 *   POST /api/delmail         删除邮件        { delMail: "id1,id2" }
 *   POST /api/destroy         销毁邮箱        { mail }
 *   POST /api/test            发送测试邮件     { mail }
 *   GET  /api/download/:mail/:id      下载单封邮件原文件
 *   GET  /api/download/:mail/all.zip  打包下载全部邮件
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const NIMAIL = "https://www.nimail.cn";
const PUBLIC_DIR = path.join(__dirname, "public");
const UPSTREAM_TIMEOUT = 20000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const NIMAIL_HEADERS = {
  origin: NIMAIL,
  referer: NIMAIL + "/",
  "user-agent": UA,
  accept: "application/json",
  "accept-language": "zh-CN,zh",
};

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

/** 把请求体原样转发给 NiMail，返回 { status, headers, buffer }（自动跟随最多 3 次跳转） */
function forward(method, apiPath, { form, raw } = {}, depth = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(NIMAIL + apiPath);
    const opts = {
      method,
      hostname: target.hostname,
      port: 443,
      path: target.pathname + target.search,
      headers: { ...NIMAIL_HEADERS },
    };
    if (form) {
      const body = new URLSearchParams(form).toString();
      opts.headers["content-type"] = "application/x-www-form-urlencoded";
      opts.headers["content-length"] = Buffer.byteLength(body);
      opts._body = body;
    } else if (raw !== undefined) {
      opts.headers["content-length"] = Buffer.byteLength(raw);
      opts._body = raw;
    }
    const req = https.request(opts, (res) => {
      // 跟随跳转（GET 类请求，如 nginx 强制 https / 非 www 归一化）
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && depth < 3) {
        res.resume();
        const next = new URL(res.headers.location, NIMAIL);
        return resolve(forward(method, next.pathname + next.search, { form, raw }, depth + 1));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) })
      );
    });
    req.setTimeout(UPSTREAM_TIMEOUT, () => req.destroy(new Error("upstream timeout")));
    req.on("error", reject);
    if (opts._body) req.write(opts._body);
    req.end();
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

/** 把上游响应原样透传给前端（保留 content-type，失败时不丢信息） */
function pipeUpstream(res, r) {
  const ct = r.headers["content-type"] || "application/json; charset=utf-8";
  const headers = { "content-type": ct, "cache-control": "no-store" };
  if (r.headers["content-disposition"]) headers["content-disposition"] = r.headers["content-disposition"];
  res.writeHead(r.status, headers);
  res.end(r.buffer);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1e6) reject(new Error("body too large"));
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const text = await readBody(req);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const params = new URLSearchParams(text);
    return Object.fromEntries(params);
  }
}

/** 发送静态文件 */
function serveStatic(req, res, pathname) {
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

  try {
    // ---------- API 代理 ----------
    if (req.method === "POST" && pathname === "/api/apply") {
      const { mail } = await readJsonBody(req);
      if (!mail || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(mail)) {
        return sendJson(res, 400, { success: "false", message: "邮箱地址不合法" });
      }
      const r = await forward("POST", "/api/applymail", { form: { mail } });
      return pipeUpstream(res, r);
    }

    if (req.method === "POST" && pathname === "/api/mails") {
      const { mail, time } = await readJsonBody(req);
      if (!mail) return sendJson(res, 400, { success: "false", message: "缺少 mail 参数" });
      const r = await forward("POST", "/api/getmails", {
        form: { mail, time: time || 0, _: Date.now() },
      });
      return pipeUpstream(res, r);
    }

    // 邮件正文（raw-html）。URL: /api/mail/<邮箱>/<邮件id>
    const mailMatch = pathname.match(/^\/api\/mail\/([^/]+)\/([^/]+)$/);
    if (req.method === "GET" && mailMatch) {
      const r = await forward("GET", `/api/raw-html/${mailMatch[1]}/${mailMatch[2]}`);
      return pipeUpstream(res, r);
    }

    if (req.method === "POST" && pathname === "/api/delmail") {
      const { delMail } = await readJsonBody(req);
      if (!delMail) return sendJson(res, 400, { success: "false", message: "缺少 delMail 参数" });
      const r = await forward("POST", "/api/delmail", { form: { delMail, _: Date.now() } });
      return pipeUpstream(res, r);
    }

    if (req.method === "POST" && pathname === "/api/destroy") {
      const { mail } = await readJsonBody(req);
      if (!mail) return sendJson(res, 400, { success: "false", message: "缺少 mail 参数" });
      const r = await forward("POST", "/api/destroymail", { form: { mail, _: Date.now() } });
      return pipeUpstream(res, r);
    }

    if (req.method === "POST" && pathname === "/api/test") {
      const { mail } = await readJsonBody(req);
      if (!mail) return sendJson(res, 400, { success: "false", message: "缺少 mail 参数" });
      const r = await forward("POST", "/api/test", { form: { mail, _: Date.now() } });
      return pipeUpstream(res, r);
    }

    // 下载原文件：/api/download/<邮箱>/<id> 或 /api/download/<邮箱>/all.zip
    const dlMatch = pathname.match(/^\/api\/download\/([^/]+)\/([^/]+)$/);
    if (req.method === "GET" && dlMatch) {
      const r = await forward("GET", `/api/download/${dlMatch[1]}/${dlMatch[2]}`);
      return pipeUpstream(res, r);
    }

    // ---------- 健康检查 ----------
    if (pathname === "/healthz") {
      return sendJson(res, 200, { ok: true, ts: Date.now() });
    }

    // ---------- 静态资源 ----------
    if (req.method === "GET") return serveStatic(req, res, pathname);

    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
  } catch (e) {
    log("error:", e.message);
    sendJson(res, 502, { success: "false", message: "上游服务异常: " + e.message });
  }
});

server.listen(PORT, HOST, () => {
  log(`nimail-web 已启动: http://localhost:${PORT}`);
  log(`上游代理目标: ${NIMAIL}`);
});
