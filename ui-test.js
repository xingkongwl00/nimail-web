/* UI 端到端测试：mailtm-web */
const { chromium } = require("playwright-core");

const EXE = "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const BASE = "http://localhost:3000";

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().includes("/api/")) {
      errors.push("HTTP " + r.status() + " " + r.url().replace(BASE, ""));
    }
  });

  const results = [];
  const check = (name, ok, extra) => {
    results.push({ name, ok, extra: extra || "" });
    console.log((ok ? "✅" : "❌") + " " + name + (extra ? " | " + extra : ""));
  };

  // 1. 打开页面
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  check("页面加载", await page.locator("#applySection").isVisible());
  check("域名下拉有选项", (await page.locator("#domainSelect option").count()) > 0,
    "域名: " + (await page.locator("#domainSelect option").first().textContent().catch(() => "?")));

  // 2. 自定义邮箱名并创建
  const uname = "uitest" + Date.now().toString().slice(-6);
  await page.fill("#customUser", uname);
  await page.click("#btnApply");
  await page.waitForTimeout(4000);

  const panelVisible = await page.locator("#mailPanel").isVisible();
  check("创建后面板显示", panelVisible);
  const addr = (await page.locator("#mailAddress").textContent()) || "";
  check("邮箱地址正确", addr.startsWith(uname + "@"), addr);
  check("状态行显示", (await page.locator("#statusText").textContent() || "").includes("长期有效"));
  check("信息栏-创建时间", (await page.locator("#infoCreated").textContent() || "") !== "--");
  check("信息栏-配额", (await page.locator("#infoQuota").textContent() || "") !== "--");
  check("信息栏-账号ID", (await page.locator("#infoAccountId").textContent() || "") !== "--");
  check("收件箱空状态", await page.locator("#emptyRow").isVisible());

  // 3. 复制按钮（剪贴板权限）
  try {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.click("#btnCopy");
    await page.waitForTimeout(600);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check("复制邮箱到剪贴板", clip === addr, "剪贴板: " + clip);
  } catch (e) {
    check("复制邮箱到剪贴板", false, e.message);
  }

  // 4. 刷新收件箱
  await page.click("#btnRefresh");
  await page.waitForTimeout(1500);
  check("刷新收件箱无报错", errors.length === 0, errors.join("; ").slice(0, 200));

  // 5. localStorage 持久化 + 刷新页面恢复
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const addr2 = (await page.locator("#mailAddress").textContent().catch(() => "")) || "";
  check("刷新页面后邮箱恢复", addr2 === addr, addr2);
  check("恢复后面板可见", await page.locator("#mailPanel").isVisible());

  // 6. 换一个邮箱（放慢节奏避开上游 30 次/分钟限流）
  await page.waitForTimeout(12000);
  await page.click("#btnRandom");
  await page.waitForTimeout(6000);
  const addr3 = (await page.locator("#mailAddress").textContent().catch(() => "")) || "";
  check("换一个邮箱生效", addr3 !== addr && addr3.includes("@"), addr3);

  // 7. 销毁邮箱
  page.on("dialog", (d) => d.accept());
  await page.click("#btnDestroy");
  await page.waitForTimeout(2000);
  check("销毁后回到申请区", await page.locator("#applySection").isVisible());

  await page.screenshot({ path: "D:/ai常规目录D盘/注册机相关/nimail-web/ui-test.png", fullPage: true });
  check("全程无 JS 错误", errors.length === 0, errors.join("; ").slice(0, 300));

  await browser.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n===== ${results.length - fail}/${results.length} 通过 =====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(2); });
