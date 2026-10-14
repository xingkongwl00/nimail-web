/* ============ mailtm-web 前端逻辑（mail.tm） ============ */
(function () {
  "use strict";

  // 仓库地址（部署后由构建脚本替换）
  var GH_REPO = "https://github.com/xingkongwl00/nimail-web";

  var POLL_INTERVAL = 7500;   // mail.tm 限流 30 次/分钟，7.5s 轮询约 8 次/分钟，安全
  var LS_ACCOUNT = "mailtm-web:account";
  var LS_DOMAINS = "mailtm-web:domains";

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var applySection = $("applySection"), mailPanel = $("mailPanel");
  var customUser = $("customUser"), domainSelect = $("domainSelect"), domainSuffix = $("domainSuffix"), btnApply = $("btnApply");
  var mailAddress = $("mailAddress"), btnCopy = $("btnCopy"), copyIcon = $("copyIcon"), copyTextLabel = $("copyText");
  var statusText = $("statusText");
  var infoCreated = $("infoCreated"), infoCount = $("infoCount"), infoQuota = $("infoQuota"), infoAccountId = $("infoAccountId");
  var btnRefresh = $("btnRefresh"), btnCopyAddr = $("btnCopyAddr"), btnRandom = $("btnRandom"), btnDestroy = $("btnDestroy");
  var inboxBody = $("inboxBody"), inboxCount = $("inboxCount"), emptyRow = $("emptyRow");
  var btnDelSel = $("btnDelSel");
  var mailModal = $("mailModal"), modalTitle = $("modalTitle"), modalMeta = $("modalMeta"), mailFrame = $("mailFrame");
  var modalClose = $("modalClose"), btnCopyBody = $("btnCopyBody"), btnOpenRaw = $("btnOpenRaw"), btnDelOne = $("btnDelOne");
  var toastEl = $("toast");

  $("ghLink").href = GH_REPO;

  // ---------- 状态 ----------
  var state = {
    address: "",
    password: "",
    token: "",
    id: "",
    createdAt: "",
    quota: 0,
    used: 0,
    mails: new Map(),   // id -> 邮件对象
    unread: new Set(),
    domains: []
  };
  var pollTimer = null;
  var currentMail = null;
  var rateLimited = false;   // mail.tm 限流 30 次/分钟，429 时降速

  // ---------- 工具 ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDateTime(iso) {
    if (!iso) return "--";
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function fmtSize(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(2) + " MB";
  }
  var toastTimer = null;
  function toast(msg, type) {
    toastEl.textContent = msg;
    toastEl.className = "toast " + (type || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.add("hidden"); }, 2600);
  }
  function authHeaders() {
    // 双通道：部分部署平台会改写 Authorization 头，故同时带 X-Auth-Token 与 query token
    return { "X-Auth-Token": state.token, "Authorization": "Bearer " + state.token };
  }
  function withToken(path) {
    if (!state.token) return path;
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(state.token);
  }
  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    return fetch(withToken(path), {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      var ct = r.headers.get("content-type") || "";
      var p = ct.indexOf("json") >= 0 ? r.json() : r.text();
      return p.then(function (data) { return { status: r.status, data: data }; });
    });
  }
  function randUser() {
    var s = "";
    for (var i = 0; i < 10; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
    return s;
  }
  function randPassword() {
    var s = "Tm";
    for (var i = 0; i < 10; i++) s += "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 54)];
    return s;
  }
  function saveAccount() {
    try {
      localStorage.setItem(LS_ACCOUNT, JSON.stringify({
        address: state.address, password: state.password, token: state.token,
        id: state.id, createdAt: state.createdAt, quota: state.quota, used: state.used,
      }));
    } catch (e) { }
  }
  function clearAccount() { try { localStorage.removeItem(LS_ACCOUNT); } catch (e) { } }

  // ---------- 复制 ----------
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { }
      document.body.removeChild(ta);
      toast(ok ? (okMsg || "复制成功") : "复制失败，请手动选择复制", ok ? "ok" : "err");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(okMsg || "复制成功", "ok");
      }, fallback);
    } else fallback();
  }

  // ---------- 域名 ----------
  function toArray(data) {
    // mail.tm 依 Accept 头可能返回纯数组或 hydra:member 包装，两种都兼容
    if (Array.isArray(data)) return data;
    return (data && data["hydra:member"]) || [];
  }

  function loadDomains() {
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(LS_DOMAINS) || "null"); } catch (e) { }
    if (cached && cached.ts && Date.now() - cached.ts < 3600000 && cached.list && cached.list.length) {
      return Promise.resolve(cached.list);
    }
    return api("/api/domains").then(function (r) {
      var list = [];
      toArray(r.data).forEach(function (d) {
        if (d && (d.isActive === undefined || d.isActive) && !d.isPrivate && d.domain) list.push(d.domain);
      });
      if (!list.length) throw new Error("无可用域名");
      try {
        localStorage.setItem(LS_DOMAINS, JSON.stringify({ ts: Date.now(), list: list }));
      } catch (e) { }
      return list;
    });
  }

  function renderDomainSelect() {
    domainSelect.innerHTML = "";
    state.domains.forEach(function (d) {
      var opt = document.createElement("option");
      opt.value = d;
      opt.textContent = "@" + d;
      domainSelect.appendChild(opt);
    });
    domainSuffix.textContent = "@" + (state.domains[0] || "");
  }

  // ---------- 登录态维护 ----------
  function ensureToken() {
    // 用已有 token 试 /me；401 则用保存的密码重新登录换 token
    return api("/api/me", { headers: authHeaders() }).then(function (r) {
      if (r.status === 200) {
        applyMe(r.data);
        return true;
      }
      return relogin();
    }).catch(function () { return relogin(); });
  }

  function relogin() {
    if (!state.address || !state.password) return Promise.resolve(false);
    return api("/api/token", { method: "POST", body: { address: state.address, password: state.password } }).then(function (r) {
      if (r.status === 200 && r.data && r.data.token) {
        state.token = r.data.token;
        state.id = r.data.id || state.id;
        saveAccount();
        return true;
      }
      return false;
    }).catch(function () { return false; });
  }

  function applyMe(me) {
    if (!me) return;
    state.id = me.id || state.id;
    state.address = me.address || state.address;
    state.createdAt = me.createdAt || state.createdAt;
    state.quota = me.quota || state.quota;
    state.used = me.used || 0;
    saveAccount();
  }

  // ---------- 创建邮箱 ----------
  function createAccount(user, domain) {
    btnApply.disabled = true;
    var address = (user || randUser()) + "@" + (domain || state.domains[0]);
    var password = randPassword();
    return api("/api/accounts", { method: "POST", body: { address: address, password: password } })
      .then(function (r) {
        if (r.status !== 201 && !(r.data && r.data.id)) {
          var d0 = r.data || {};
          var msg = d0["hydra:description"] || d0.message ||
            (d0.violations && d0.violations[0] && d0.violations[0].message) ||
            ("HTTP " + r.status);
          throw new Error(msg);
        }
        state.address = r.data.address || address;
        state.password = password;
        state.id = r.data.id || "";
        state.createdAt = r.data.createdAt || new Date().toISOString();
        state.quota = r.data.quota || 0;
        state.used = r.data.used || 0;
        state.mails.clear();
        state.unread.clear();
        // 注册后自动登录拿 token
        return api("/api/token", { method: "POST", body: { address: state.address, password: password } }).then(function (tr) {
          if (tr.status !== 200 || !tr.data || !tr.data.token) throw new Error("登录失败");
          state.token = tr.data.token;
          saveAccount();
          renderPanel();
          toast("临时邮箱创建成功：" + state.address, "ok");
          startPolling();
        });
      })
      .catch(function (e) {
        if (String(e.message).indexOf("429") >= 0) {
          toast("创建失败：请求过于频繁（429），请稍后再试", "err");
        } else {
          toast("创建失败：" + e.message, "err");
        }
      })
      .finally(function () { btnApply.disabled = false; });
  }

  // ---------- 面板渲染 ----------
  function renderPanel() {
    var has = !!state.address;
    applySection.classList.toggle("hidden", has);
    mailPanel.classList.toggle("hidden", !has);
    if (!has) return;
    mailAddress.textContent = state.address;
    infoCreated.textContent = fmtDateTime(state.createdAt);
    infoAccountId.textContent = state.id ? (state.id.length > 12 ? state.id.slice(0, 12) + "…" : state.id) : "--";
    renderInbox();
    updateQuota();
  }

  function updateQuota() {
    infoQuota.textContent = state.quota
      ? fmtSize(state.used) + " / " + fmtSize(state.quota)
      : "--";
  }

  // ---------- 收件箱 ----------
  function fetchMessages() {
    if (!state.token || !state.address || rateLimited) return Promise.resolve();
    return api("/api/messages?page=1", { headers: authHeaders() }).then(function (r) {
      if (r.status === 429) {
        // 触发上游限流：暂停轮询 30 秒后自动恢复
        if (!rateLimited) {
          rateLimited = true;
          stopPolling();
          toast("请求过于频繁，已自动降速，30 秒后恢复", "err");
          setTimeout(function () {
            rateLimited = false;
            if (state.address && state.token) startPolling();
          }, 30000);
        }
        return;
      }
      if (r.status === 401) {
        // token 过期：静默重登一次再拉
        return relogin().then(function (ok) {
          if (!ok) { stopPolling(); toast("登录已过期，请重新创建邮箱", "err"); return; }
          return api("/api/messages?page=1", { headers: authHeaders() }).then(renderMessages);
        });
      }
      if (r.status === 200) renderMessages(r);
    }).catch(function () { /* 网络抖动时静默，下一轮再试 */ });
  }

  function renderMessages(r) {
    var members = toArray(r.data);
    members.forEach(function (m) {
      if (m && m.id && !state.mails.has(m.id)) {
        state.mails.set(m.id, m);
        if (!m.seen) state.unread.add(m.id);
      }
    });
    renderInbox();
  }

  function renderInbox() {
    var rows = Array.from(state.mails.values()).sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    inboxCount.textContent = rows.length;
    infoCount.textContent = rows.length + " 封";
    if (!rows.length) {
      inboxBody.innerHTML = "";
      inboxBody.appendChild(emptyRow);
      return;
    }
    var html = "";
    rows.forEach(function (m) {
      var atta = m.hasAttachments ? '<span class="atta-yes">📎</span>' : '<span class="atta-no">—</span>';
      var dot = !m.seen ? '<span class="unread-dot" title="未读"></span>' : "";
      var from = (m.from && (m.from.name || m.from.address)) || "（未知发件人）";
      html += '<tr data-id="' + esc(m.id) + '">' +
        '<td class="col-check"><input type="checkbox" class="row-check" value="' + esc(m.id) + '" /></td>' +
        '<td class="col-from">' + dot + esc(from) + '</td>' +
        '<td class="col-subject">' + esc(m.subject || "（无主题）") + '</td>' +
        '<td class="col-time">' + esc(fmtDateTime(m.createdAt)) + '</td>' +
        '<td class="col-size">' + esc(fmtSize(m.size)) + '</td>' +
        '<td class="col-atta">' + atta + '</td>' +
        '</tr>';
    });
    inboxBody.innerHTML = html;
  }

  function startPolling() {
    stopPolling();
    fetchMessages();
    pollTimer = setInterval(fetchMessages, POLL_INTERVAL);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ---------- 邮件详情 ----------
  function openMail(id) {
    var m = state.mails.get(id);
    if (!m) return;
    currentMail = m;
    modalTitle.textContent = m.subject || "（无主题）";
    var from = (m.from && (m.from.name || "")) + (m.from && m.from.address ? " <" + m.from.address + ">" : "");
    modalMeta.innerHTML =
      "<span>发件人：" + esc(from || "—") + "</span>" +
      "<span>时间：" + esc(fmtDateTime(m.createdAt)) + "</span>" +
      "<span>大小：" + esc(fmtSize(m.size)) + "</span>" +
      (m.hasAttachments ? '<span>附件：有</span>' : "");
    mailFrame.srcdoc = "<div style='padding:16px;color:#888;font-family:sans-serif'>加载中…</div>";
    mailModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    api("/api/messages/" + encodeURIComponent(id), { headers: authHeaders() }).then(function (r) {
      if (r.status !== 200 || !r.data) {
        mailFrame.srcdoc = "<div style='padding:16px;color:#c00'>正文加载失败</div>";
        return;
      }
      var d = r.data;
      var bodyHtml = "";
      if (d.html && d.html.length) {
        bodyHtml = Array.isArray(d.html) ? d.html.join("\n") : String(d.html);
      } else if (d.text) {
        bodyHtml = "<pre style='white-space:pre-wrap;word-break:break-all;font-family:inherit;padding:16px;margin:0'>" + esc(d.text) + "</pre>";
      } else {
        bodyHtml = "<div style='padding:16px;color:#888'>（空邮件）</div>";
      }
      mailFrame.srcdoc = bodyHtml;
      // 标记已读
      if (!m.seen) {
        fetch(withToken("/api/messages/" + encodeURIComponent(id)), {
          method: "PATCH",
          headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
          body: JSON.stringify({ seen: true }),
        }).then(function () {
          m.seen = true;
          state.unread.delete(id);
          renderInbox();
        }).catch(function () { });
      }
    }).catch(function () {
      mailFrame.srcdoc = "<div style='padding:16px;color:#c00'>正文加载失败</div>";
    });
  }

  function closeMail() {
    mailModal.classList.add("hidden");
    mailFrame.srcdoc = "";
    document.body.style.overflow = "";
    currentMail = null;
  }

  // ---------- 事件绑定 ----------
  btnApply.addEventListener("click", function () {
    var u = customUser.value.trim();
    if (u && !/^[A-Za-z0-9._-]+$/.test(u)) { toast("邮箱名只支持字母、数字及 . _ -", "err"); return; }
    createAccount(u, domainSelect.value);
  });
  customUser.addEventListener("keydown", function (e) { if (e.key === "Enter") btnApply.click(); });

  function flashCopyBtn() {
    copyIcon.textContent = "✅";
    copyTextLabel.textContent = "已复制";
    btnCopy.classList.add("copied");
    setTimeout(function () {
      copyIcon.textContent = "📋";
      copyTextLabel.textContent = "复制";
      btnCopy.classList.remove("copied");
    }, 1800);
  }
  btnCopy.addEventListener("click", function () { copyText(state.address, "邮箱地址已复制"); flashCopyBtn(); });
  btnCopyAddr.addEventListener("click", function () { copyText(state.address, "邮箱地址已复制"); });

  btnRefresh.addEventListener("click", function () {
    btnRefresh.disabled = true;
    fetchMessages().finally(function () { btnRefresh.disabled = false; });
    toast("收件箱已刷新", "ok");
  });

  btnRandom.addEventListener("click", function () { createAccount(null, domainSelect.value || state.domains[0]); });

  btnDestroy.addEventListener("click", function () {
    if (!confirm("确定销毁当前邮箱吗？销毁后账号与收件箱内容将全部删除。")) return;
    fetch(withToken("/api/account/" + encodeURIComponent(state.id)), {
      method: "DELETE", headers: authHeaders(),
    }).then(function (r) {
      if (r.status === 204 || r.ok) {
        stopPolling();
        state.address = ""; state.token = ""; state.id = "";
        state.mails.clear(); state.unread.clear();
        clearAccount();
        renderPanel();
        toast("邮箱已销毁", "ok");
      } else {
        toast("销毁失败：HTTP " + r.status, "err");
      }
    }).catch(function () { toast("销毁失败：网络异常", "err"); });
  });

  btnDelSel.addEventListener("click", function () {
    var ids = Array.from(inboxBody.querySelectorAll(".row-check:checked")).map(function (c) { return c.value; });
    if (!ids.length) { toast("请先勾选要删除的邮件", "err"); return; }
    Promise.all(ids.map(function (id) {
      return fetch(withToken("/api/messages/" + encodeURIComponent(id)), { method: "DELETE", headers: authHeaders() })
        .then(function (r) { return { id: id, ok: r.ok }; });
    })).then(function (results) {
      var okCount = 0;
      results.forEach(function (x) { if (x.ok) { state.mails.delete(x.id); state.unread.delete(x.id); okCount++; } });
      renderInbox();
      toast(okCount ? ("已删除 " + okCount + " 封邮件") : "删除失败", okCount ? "ok" : "err");
    }).catch(function () { toast("删除失败：网络异常", "err"); });
  });

  inboxBody.addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-id]");
    if (!tr || e.target.classList.contains("row-check")) return;
    openMail(tr.getAttribute("data-id"));
  });

  modalClose.addEventListener("click", closeMail);
  mailModal.addEventListener("click", function (e) { if (e.target.dataset.close) closeMail(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !mailModal.classList.contains("hidden")) closeMail(); });

  btnDelOne.addEventListener("click", function () {
    if (!currentMail) return;
    if (!confirm("确定删除这封邮件吗？")) return;
    fetch(withToken("/api/messages/" + encodeURIComponent(currentMail.id)), { method: "DELETE", headers: authHeaders() })
      .then(function (r) {
        if (r.ok) {
          state.mails.delete(currentMail.id);
          state.unread.delete(currentMail.id);
          renderInbox();
          closeMail();
          toast("邮件已删除", "ok");
        } else toast("删除失败：HTTP " + r.status, "err");
      })
      .catch(function () { toast("删除失败：网络异常", "err"); });
  });

  btnOpenRaw.addEventListener("click", function () {
    if (!currentMail) return;
    api("/api/sources/" + encodeURIComponent(currentMail.id), { headers: authHeaders() }).then(function (r) {
      var data = (r.data && r.data.data) || "(无原文)";
      var w = window.open("", "_blank");
      if (w) {
        w.document.write("<!DOCTYPE html><html><head><meta charset='utf-8'><title>邮件原文</title>" +
          "<style>body{background:#fff;color:#222;font-family:Consolas,monospace;padding:20px;white-space:pre-wrap;word-break:break-all}</style>" +
          "</head><body>" + esc(data) + "</body></html>");
        w.document.close();
      }
    }).catch(function () { toast("原文获取失败", "err"); });
  });

  btnCopyBody.addEventListener("click", function () {
    if (!currentMail) return;
    api("/api/messages/" + encodeURIComponent(currentMail.id), { headers: authHeaders() }).then(function (r) {
      var d = r.data || {};
      var text = d.text || "";
      if (!text && d.html) {
        var tmp = document.createElement("div");
        tmp.innerHTML = (Array.isArray(d.html) ? d.html.join("\n") : String(d.html)).replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ");
        text = (tmp.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
      }
      copyText(text || "(空邮件)", "正文已复制");
    }).catch(function () { toast("正文获取失败", "err"); });
  });

  // ---------- 启动 ----------
  (function init() {
    // 先拉域名（申请区与恢复态都可能用到）
    loadDomains().then(function (list) {
      state.domains = list;
      renderDomainSelect();
    }).catch(function (e) {
      domainSuffix.textContent = "@域名加载失败";
      toast("域名列表加载失败：" + e.message, "err");
    });

    // 恢复本地保存的账号
    try {
      var s = JSON.parse(localStorage.getItem(LS_ACCOUNT) || "null");
      if (s && s.address) {
        state.address = s.address;
        state.password = s.password || "";
        state.token = s.token || "";
        state.id = s.id || "";
        state.createdAt = s.createdAt || "";
        state.quota = s.quota || 0;
        state.used = s.used || 0;
        renderPanel();
        ensureToken().then(function (ok) {
          if (ok) {
            renderPanel();
            startPolling();
          } else {
            state.address = ""; state.token = "";
            clearAccount();
            renderPanel();
            toast("本地账号已失效，请重新创建", "err");
          }
        });
      }
    } catch (e) { }
  })();
})();
