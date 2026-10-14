/* ============ nimail-web 前端逻辑 ============ */
(function () {
  "use strict";

  // 仓库地址（部署后由构建脚本替换）
  var GH_REPO = "https://github.com/xingkongwl00/nimail-web";

  var DOMAIN = "nimail.cn";
  var POLL_INTERVAL = 7500;   // 与官方一致的轮询间隔
  var LS_KEY = "nimail-web:mailbox";

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var applySection = $("applySection"), mailPanel = $("mailPanel");
  var customUser = $("customUser"), btnApply = $("btnApply");
  var mailAddress = $("mailAddress"), btnCopy = $("btnCopy"), copyIcon = $("copyIcon"), copyText = $("copyText");
  var countdownEl = $("countdown"), expiredBadge = $("expiredBadge");
  var infoCreated = $("infoCreated"), infoExpire = $("infoExpire"), infoCount = $("infoCount"), infoStatus = $("infoStatus");
  var btnRefresh = $("btnRefresh"), btnTest = $("btnTest"), btnRenew = $("btnRenew"), btnRandom = $("btnRandom"), btnDestroy = $("btnDestroy");
  var inboxBody = $("inboxBody"), inboxCount = $("inboxCount"), emptyRow = $("emptyRow");
  var checkAll = $("checkAll"), btnDelSel = $("btnDelSel"), btnDlAll = $("btnDlAll");
  var mailModal = $("mailModal"), modalTitle = $("modalTitle"), modalMeta = $("modalMeta"), mailFrame = $("mailFrame");
  var modalClose = $("modalClose"), btnCopyBody = $("btnCopyBody"), btnOpenRaw = $("btnOpenRaw"), btnDlOne = $("btnDlOne");
  var toastEl = $("toast");

  $("ghLink").href = GH_REPO;

  // ---------- 状态 ----------
  var state = {
    mail: "",
    createdAt: 0,
    deadline: 0,
    cursor: 0,          // getmails 增量游标
    mails: new Map(),   // id -> 邮件对象
    unread: new Set(),  // 未读 id
    polling: false
  };
  var cdTimer = null, pollTimer = null;

  // ---------- 工具 ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function fmtDateTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  var toastTimer = null;
  function toast(msg, type) {
    toastEl.textContent = msg;
    toastEl.className = "toast " + (type || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.add("hidden"); }, 2600);
  }
  function api(path, body) {
    var opts = body === undefined
      ? { method: "GET" }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return fetch(path, opts).then(function (r) { return r.json(); });
  }
  function randUser() {
    var s = "";
    for (var i = 0; i < 10; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
    return s;
  }
  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        mail: state.mail, createdAt: state.createdAt, deadline: state.deadline
      }));
    } catch (e) { /* 隐私模式下忽略 */ }
  }
  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (s && s.mail) return s;
    } catch (e) { }
    return null;
  }
  function clearState() { try { localStorage.removeItem(LS_KEY); } catch (e) { } }

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

  // ---------- 倒计时 ----------
  function tickCountdown() {
    var left = Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
    var m = Math.floor(left / 60), s = left % 60;
    countdownEl.textContent = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    countdownEl.className = "countdown" + (left === 0 ? " danger" : left <= 60 ? " warn" : "");
    expiredBadge.classList.toggle("hidden", left > 0);
    infoStatus.textContent = left > 0 ? "生效中" : "已到期";
    infoStatus.style.color = left > 0 ? "var(--ok)" : "var(--danger)";
    if (left === 0) stopPolling();
  }

  // ---------- 邮箱申请 / 切换 ----------
  function applyMail(user, silent) {
    var mail = (user || randUser()) + "@" + DOMAIN;
    btnApply.disabled = true;
    return api("/api/apply", { mail: mail }).then(function (d) {
      btnApply.disabled = false;
      if (d.success !== "true") throw new Error(d.message || d.user || "申请失败");
      var parts = String(d.delay || "10:00").split(":");
      var secs = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
      state.mail = d.user || mail;
      state.createdAt = Date.now();
      state.deadline = Date.now() + secs * 1000;
      state.cursor = 0;
      state.mails.clear();
      state.unread.clear();
      saveState();
      renderPanel();
      if (!silent) toast("邮箱申请成功：" + state.mail, "ok");
      startPolling();
    }).catch(function (e) {
      btnApply.disabled = false;
      toast("申请失败：" + e.message, "err");
    });
  }

  function renderPanel() {
    var has = !!state.mail;
    applySection.classList.toggle("hidden", has);
    mailPanel.classList.toggle("hidden", !has);
    if (!has) return;
    mailAddress.textContent = state.mail;
    infoCreated.textContent = fmtDateTime(state.createdAt);
    infoExpire.textContent = fmtDateTime(state.deadline);
    renderInbox();
    tickCountdown();
  }

  // ---------- 收件箱 ----------
  function fetchMails() {
    if (!state.mail || state.deadline <= Date.now()) return Promise.resolve();
    return api("/api/mails", { mail: state.mail, time: state.cursor }).then(function (d) {
      if (d.success !== "true") return;
      state.cursor = d.time || state.cursor;
      var list = d.mail || [];
      list.forEach(function (m) {
        if (m && m.id != null && !state.mails.has(String(m.id))) {
          state.mails.set(String(m.id), m);
          state.unread.add(String(m.id));
        }
      });
      renderInbox();
    }).catch(function () { /* 网络抖动时静默，下一轮再试 */ });
  }

  function renderInbox() {
    var rows = Array.from(state.mails.values()).sort(function (a, b) {
      return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
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
      var id = esc(m.id);
      var atta = (m.attachments && m.attachments.length) ? '<span class="atta-yes">📎 ' + esc(m.attachments.length) + '</span>' : '<span class="atta-no">—</span>';
      var dot = state.unread.has(String(m.id)) ? '<span class="unread-dot" title="未读"></span>' : "";
      html += '<tr data-id="' + id + '">' +
        '<td class="col-check"><input type="checkbox" class="row-check" value="' + id + '" /></td>' +
        '<td class="col-from">' + dot + esc(m.from || m["reply-to"] || "（未知发件人）") + '</td>' +
        '<td class="col-subject">' + esc(m.subject || "（无主题）") + '</td>' +
        '<td class="col-time">' + esc(m.time || "") + '</td>' +
        '<td class="col-size">' + esc(m["mail-len"] != null ? m["mail-len"] + " B" : "—") + '</td>' +
        '<td class="col-atta">' + atta + '</td>' +
        '</tr>';
    });
    inboxBody.innerHTML = html;
  }

  function startPolling() {
    stopPolling();
    fetchMails();
    pollTimer = setInterval(fetchMails, POLL_INTERVAL);
    if (!cdTimer) cdTimer = setInterval(tickCountdown, 1000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ---------- 邮件详情 ----------
  var currentMail = null;
  function openMail(id) {
    var m = state.mails.get(String(id));
    if (!m) return;
    currentMail = m;
    state.unread.delete(String(id));
    renderInbox();
    modalTitle.textContent = m.subject || "（无主题）";
    modalMeta.innerHTML =
      "<span>发件人：" + esc(m.from || "—") + "</span>" +
      "<span>时间：" + esc(m.time || "—") + "</span>" +
      "<span>大小：" + esc(m["mail-len"] != null ? m["mail-len"] + " B" : "—") + "</span>" +
      (m.attachments && m.attachments.length ? "<span>附件：" + esc(m.attachments.length) + " 个</span>" : "");
    mailFrame.srcdoc = "<div style='padding:16px;color:#888;font-family:sans-serif'>加载中…</div>";
    mailModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    fetch("/api/mail/" + encodeURIComponent(state.mail) + "/" + encodeURIComponent(id))
      .then(function (r) { return r.text(); })
      .then(function (html) { mailFrame.srcdoc = html; })
      .catch(function () { mailFrame.srcdoc = "<div style='padding:16px;color:#c00'>正文加载失败</div>"; });
  }
  function closeMail() {
    mailModal.classList.add("hidden");
    mailFrame.srcdoc = "";
    document.body.style.overflow = "";
  }

  // ---------- 事件绑定 ----------
  btnApply.addEventListener("click", function () {
    var u = customUser.value.trim();
    if (u && !/^[A-Za-z0-9]*$/.test(u)) { toast("邮箱名只支持字母及数字", "err"); return; }
    applyMail(u);
  });
  customUser.addEventListener("keydown", function (e) { if (e.key === "Enter") btnApply.click(); });

  btnCopy.addEventListener("click", function () {
    copyText(state.mail, "邮箱地址已复制");
    copyIcon.textContent = "✅";
    copyText.textContent = "已复制";
    btnCopy.classList.add("copied");
    setTimeout(function () {
      copyIcon.textContent = "📋";
      copyText.textContent = "复制";
      btnCopy.classList.remove("copied");
    }, 1800);
  });

  btnRefresh.addEventListener("click", function () {
    btnRefresh.disabled = true;
    fetchMails().finally(function () { btnRefresh.disabled = false; });
    toast("收件箱已刷新", "ok");
  });

  btnTest.addEventListener("click", function () {
    fetch("/api/test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mail: state.mail })
    }).then(function (r) { return r.text(); }).then(function (t) {
      toast(t.slice(0, 120) || "测试邮件已发送", "ok");
      setTimeout(fetchMails, 1500);
    }).catch(function () { toast("测试邮件发送失败", "err"); });
  });

  btnRenew.addEventListener("click", function () {
    var u = state.mail.split("@")[0];
    applyMail(u, true).then(function () { toast("已续期十分钟", "ok"); });
  });

  btnRandom.addEventListener("click", function () { applyMail(null, true); });

  btnDestroy.addEventListener("click", function () {
    if (!confirm("确定销毁当前邮箱吗？销毁后收件箱内容将清空。")) return;
    api("/api/destroy", { mail: state.mail }).then(function (d) {
      if (d.success === "true") {
        stopPolling();
        state.mail = ""; state.mails.clear(); state.unread.clear();
        clearState();
        renderPanel();
        toast("邮箱已销毁", "ok");
      } else toast("销毁失败", "err");
    }).catch(function () { toast("销毁失败：网络异常", "err"); });
  });

  checkAll.addEventListener("change", function () {
    var boxes = inboxBody.querySelectorAll(".row-check");
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = checkAll.checked;
  });

  btnDelSel.addEventListener("click", function () {
    var ids = Array.from(inboxBody.querySelectorAll(".row-check:checked")).map(function (c) { return c.value; });
    if (!ids.length) { toast("请先勾选要删除的邮件", "err"); return; }
    fetch("/api/delmail", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delMail: ids.join(",") })
    }).then(function (r) { return r.text(); }).then(function (t) {
      var d = {};
      try { d = JSON.parse(t); } catch (e) { /* 上游可能返回 HTML 错误页 */ }
      if (d.success === "true") {
        ids.forEach(function (id) { state.mails.delete(String(id)); });
        checkAll.checked = false;
        renderInbox();
        toast("已删除 " + ids.length + " 封邮件", "ok");
      } else {
        toast(d.message || "删除失败：上游暂不支持无会话删除", "err");
      }
    }).catch(function () { toast("删除失败：网络异常", "err"); });
  });

  btnDlAll.addEventListener("click", function () {
    if (!state.mails.size) { toast("收件箱为空，无可下载内容", "err"); return; }
    window.open("/api/download/" + encodeURIComponent(state.mail) + "/all.zip", "_blank");
  });

  inboxBody.addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-id]");
    if (!tr || e.target.classList.contains("row-check")) return;
    openMail(tr.getAttribute("data-id"));
  });

  modalClose.addEventListener("click", closeMail);
  mailModal.addEventListener("click", function (e) { if (e.target.dataset.close) closeMail(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !mailModal.classList.contains("hidden")) closeMail(); });

  btnOpenRaw.addEventListener("click", function () {
    if (currentMail) window.open("/api/mail/" + encodeURIComponent(state.mail) + "/" + encodeURIComponent(currentMail.id), "_blank");
  });
  btnDlOne.addEventListener("click", function () {
    if (currentMail) window.open("/api/download/" + encodeURIComponent(state.mail) + "/" + encodeURIComponent(currentMail.id), "_blank");
  });
  btnCopyBody.addEventListener("click", function () {
    if (!currentMail) return;
    fetch("/api/mail/" + encodeURIComponent(state.mail) + "/" + encodeURIComponent(currentMail.id))
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var tmp = document.createElement("div");
        tmp.innerHTML = html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ");
        copyText((tmp.textContent || tmp.innerText || "").replace(/\n{3,}/g, "\n\n").trim(), "正文已复制");
      })
      .catch(function () { toast("正文获取失败", "err"); });
  });

  // ---------- 启动 ----------
  (function init() {
    var s = loadState();
    if (s) {
      state.mail = s.mail;
      state.createdAt = s.createdAt || Date.now();
      state.deadline = s.deadline || (Date.now() + 600000);
      renderPanel();
      if (state.deadline > Date.now()) startPolling();
      else { tickCountdown(); toast("上次申请的邮箱已到期，请重新申请", "err"); }
    }
    tickCountdown();
    if (!cdTimer) cdTimer = setInterval(tickCountdown, 1000);
  })();
})();
