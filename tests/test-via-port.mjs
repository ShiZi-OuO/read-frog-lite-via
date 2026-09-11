import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const script = fs.readFileSync(new URL("../src/read-frog-lite-via.user.js", import.meta.url), "utf8");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
});

async function createPage({ oldConfig = null, config = null, failSecondOnce = false, delay = 0, themeColor = "", bodyHtml = "" } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const content = bodyHtml || `<main><h1>A useful title</h1><p>Hello world.</p><p>Second paragraph.</p><pre><code>const ignored = true;</code></pre><ul><li>List item</li></ul><table><tr><td>Table cell</td></tr></table></main>`;
  await page.setContent(`<!doctype html><html><head><title>Reading Test</title></head><body>${content}</body></html>`);
  if (themeColor) await page.evaluate((value) => { const meta=document.createElement("meta"); meta.name="theme-color"; meta.content=value; document.head.appendChild(meta); }, themeColor);
  await page.evaluate(({ oldConfig, config, failSecondOnce, delay }) => {
    const store = {};
    if (oldConfig) store.read_frog_via_config_v1 = oldConfig;
    if (config) store.read_frog_via_config_v2 = config;
    window.__store = store;
    window.__requestCount = 0;
    window.__requestedTexts = [];
    window.__clipboard = "";
    window.__menus = {};
    window.__failedSecond = false;
    window.__forceStatus = 0;
    window.GM_getValue = (key, fallback) => key in store ? store[key] : fallback;
    window.GM_setValue = (key, value) => { store[key] = value; };
    window.GM_addStyle = (css) => { const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style); };
    window.GM_setClipboard = (text) => { window.__clipboard = text; };
    window.GM_registerMenuCommand = (label, handler) => { window.__menus[label] = handler; };
    window.GM_xmlhttpRequest = (options) => {
      window.__requestCount++;
      window.__lastGmUrl = options.url;
      let cancelled = false;
      const handle = { abort() { if (!cancelled) { cancelled = true; options.onabort?.({}); } } };
      const body = JSON.parse(options.data);
      const microsoft = options.url.includes("edge.microsoft.com");
      const inputs = microsoft ? body : JSON.parse(body.messages[1].content);
      window.__requestedTexts.push(...inputs);
      setTimeout(() => {
        if (cancelled) return;
        if (window.__forceStatus) {
          const status = window.__forceStatus;
          options.onerror({ status, statusText:"Forced Error", responseText:"test error" });
          return;
        }
        if (failSecondOnce && inputs.some((x) => x.includes("Second")) && !window.__failedSecond) {
          window.__failedSecond = true;
          options.onerror({ status: 429, statusText: "Too Many Requests", responseText: "rate limited" });
          return;
        }
        const translations = inputs.map((x) => `译：${x}`);
        options.onload({
          status: 200,
          responseText: microsoft
            ? JSON.stringify(translations.map((text) => ({ translations: [{ text }] })))
            : JSON.stringify({ choices: [{ message: { content: JSON.stringify(translations) } }] }),
        });
      }, delay || 5);
      return handle;
    };
  }, { oldConfig, config, failSecondOnce, delay });
  await page.addScriptTag({ content: script });
  return page;
}

// 双语翻译仅处理阅读正文，并确保紧凑工具栏和 flex 布局不被撑坏。
{
  const bodyHtml = `<main>
    <div id="repo-toolbar" role="toolbar" style="display:flex;gap:8px"><div>Preview</div><div>Code</div><div>Blame</div><button>More</button></div>
    <div id="repo-meta" class="metadata" style="display:flex;gap:10px"><div>163 lines</div><div>9.66 KB</div><a href="#">History</a></div>
    <article class="markdown-body">
      <h1>Better reading experience</h1>
      <div id="flex-copy" style="display:flex"><p>A sufficiently long paragraph inside a flexible content row should keep its translation inside the paragraph.</p></div>
      <p>This article explains a cross-platform reading tool and its carefully designed behavior for mobile users.</p>
      <ul><li>A detailed feature description that belongs to the article body.</li></ul>
      <table><tbody><tr><td>Compatibility details for supported mobile browsers.</td></tr></tbody></table>
    </article>
  </main>`;
  const page = await createPage({ config:baseConfig(), bodyHtml });
  const toolbarHeight = await page.locator("#repo-toolbar").evaluate((node) => node.getBoundingClientRect().height);
  await startWithFrog(page);
  await page.waitForFunction(() => document.querySelectorAll(".markdown-body .rf-via-translation:not([data-rf-error])").length >= 5);
  assert.equal(await page.locator("#repo-toolbar .rf-via-translation,#repo-meta .rf-via-translation").count(), 0);
  assert.equal(await page.locator("main > .rf-via-translation").count(), 0);
  assert.equal(await page.locator("#flex-copy > .rf-via-translation").count(), 0);
  assert.equal(await page.locator("#flex-copy p > .rf-via-translation").count(), 1);
  assert.equal(await page.locator("#repo-toolbar").evaluate((node) => node.getBoundingClientRect().height), toolbarHeight);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), await page.evaluate(() => document.documentElement.clientWidth));
  const requested = (await page.evaluate(() => window.__requestedTexts)).join(" ");
  assert.doesNotMatch(requested, /Preview|Blame|163 lines|9\.66 KB|History/);
  assert.match(requested, /Better reading experience|cross-platform reading tool/);
  if (process.env.RF_QA_LAYOUT) await page.screenshot({ path:process.env.RF_QA_LAYOUT, fullPage:true });
  await page.close();
}

// 识别使用连续 BR 而不是 P 标签分段的旧式新闻正文，并在恢复时移除临时包装。
{
  const bodyHtml = `<main><div class="article_content"><div class="article_right">
    <p class="picture">A short image caption.</p><br>
    First article paragraph stored directly inside a div instead of a paragraph element.<br><br>
    Second article paragraph follows another pair of line breaks and must be translated independently.<br><br>
    <strong>Article section heading</strong><br><br>
    Final article paragraph confirms that the generic line-break layout remains supported.
  </div></div></main>`;
  const page = await createPage({ config:baseConfig(), bodyHtml });
  const originalHtml = await page.locator(".article_right").innerHTML();
  await startWithFrog(page);
  await page.waitForFunction(() => document.querySelectorAll(".article_right > .rf-via-source-segment").length >= 4);
  await page.waitForFunction(() => document.querySelectorAll(".article_right > .rf-via-translation:not([data-rf-error])").length >= 4);
  const requested = (await page.evaluate(() => window.__requestedTexts)).join(" ");
  assert.match(requested, /First article paragraph stored directly/);
  assert.match(requested, /Second article paragraph follows/);
  assert.match(requested, /Final article paragraph confirms/);
  await invokeMenu(page, "恢复原文");
  assert.equal(await page.locator(".rf-via-source-segment").count(), 0);
  assert.equal(await page.locator(".rf-via-translation").count(), 0);
  assert.equal(await page.locator(".article_right").innerHTML(), originalHtml);
  await page.close();
}

function baseConfig(overrides = {}) {
  return {
    schemaVersion: 2, service: "microsoft", endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: "", model: "gpt-4o-mini", targetLanguage: "zh-Hans", mode: "bilingual",
    translationStyle: "annotation", replacementUpgradeApplied:true, batchSize: 2, concurrency: 2, buttonSide: "right", buttonY: .72,
    ...overrides,
  };
}

async function summonFrog(page) {
  const frog = page.locator("#rf-via-host").locator("#frog");
  assert.equal(await frog.evaluate((node) => node.classList.contains("tucked")), true);
  await page.waitForTimeout(320);
  assert.ok(Number(await frog.evaluate((node) => getComputedStyle(node).opacity)) < .6);
  assert.equal(await frog.evaluate((node) => getComputedStyle(node).boxShadow), "none");
  assert.equal(await frog.evaluate((node) => getComputedStyle(node).clipPath), "none");
  assert.doesNotMatch(await frog.evaluate((node) => getComputedStyle(node).backgroundImage), /radial-gradient/);
  assert.equal(await page.locator("#rf-via-host").locator("#frog-dock").evaluate((node) => getComputedStyle(node).overflow), "visible");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), await page.evaluate(() => document.documentElement.clientWidth));
  assert.equal(await page.locator("#rf-via-host").evaluate((node) => getComputedStyle(node).position), "fixed");
  assert.equal(await page.locator("#rf-via-host").evaluate((node) => node.getBoundingClientRect().width), 0);
  await frog.click();
  assert.equal(await frog.evaluate((node) => node.classList.contains("tucked")), false);
  assert.equal(await page.locator("#rf-via-host").locator("#quick").count(), 0);
  assert.equal(await page.locator("#rf-via-host").locator("#mini-status").count(), 0);
}

async function startWithFrog(page) {
  await summonFrog(page);
  const frog = page.locator("#rf-via-host").locator("#frog");
  await frog.click();
  await page.waitForFunction(() => window.__requestCount > 0);
}

async function invokeMenu(page, label) {
  await page.evaluate((name) => window.__menus[name](), label);
}

// 迁移 v1 配置时保留用户的 DeepSeek Key，并解析出正确请求地址。
{
  const page = await createPage({ themeColor:"#3f51b5", oldConfig: { provider:"openai", endpoint:"https://api.deepseek.com", apiKey:"secret-key", model:"deepseek-v4-flash", targetLanguage:"简体中文", mode:"bilingual", batchSize:5, concurrency:2 } });
  await invokeMenu(page, "打开 Read Frog 设置");
  const host = page.locator("#rf-via-host");
  assert.match(await host.evaluate((node) => getComputedStyle(node).getPropertyValue("--primary")), /231/);
  assert.ok(parseFloat(await host.locator("#settings").evaluate((node) => getComputedStyle(node).borderTopLeftRadius)) >= 30);
  assert.ok(parseFloat(await host.locator(".section").first().evaluate((node) => getComputedStyle(node).borderTopLeftRadius)) >= 24);
  assert.equal(await host.locator(".hero-art").count(), 1);
  assert.equal(await host.locator("#settings-close .rf-icon,#key-toggle .rf-icon,#key-clear .rf-icon").count(), 3);
  assert.equal(await page.locator("#rf-via-host").locator("#service").inputValue(), "deepseek");
  assert.equal(await page.locator("#rf-via-host").locator("#api-key").inputValue(), "secret-key");
  assert.equal(await page.locator("#rf-via-host").locator("#mode").inputValue(), "translation");
  assert.equal(await page.locator("#rf-via-host").locator("#endpoint-preview").textContent(), "https://api.deepseek.com/chat/completions");
  assert.equal(await page.evaluate(() => window.__store.read_frog_via_config_v2.service), "deepseek");
  assert.equal(await page.evaluate(() => window.__store.read_frog_via_config_v2.mode), "translation");
  await host.locator("#key-toggle").click();
  assert.equal(await host.locator("#api-key").getAttribute("type"), "text");
  await host.locator("#settings-close").click();
  await invokeMenu(page, "打开 Read Frog 设置");
  assert.equal(await host.locator("#api-key").getAttribute("type"), "password");
  if (process.env.RF_QA_SCREENSHOT) { await page.waitForTimeout(320); await page.screenshot({ path: process.env.RF_QA_SCREENSHOT, fullPage:false }); }
  await page.close();
}

// 修复异常的 v2 配置值，同时保留有效的用户文本字段。
{
  const page = await createPage({ config: {
    ...baseConfig(), service:"unknown", mode:"broken", translationStyle:"loud",
    batchSize:99, concurrency:-3, buttonSide:"middle", buttonY:9,
    apiKey:"kept-key", model:"kept-model", targetLanguage:"nl",
  } });
  const stored = await page.evaluate(() => window.__store.read_frog_via_config_v2);
  assert.equal(stored.service, "microsoft");
  assert.equal(stored.mode, "translation");
  assert.equal(stored.translationStyle, "annotation");
  assert.equal(stored.batchSize, 10);
  assert.equal(stored.concurrency, 1);
  assert.equal(stored.buttonSide, "right");
  assert.equal(stored.buttonY, .84);
  assert.equal(stored.apiKey, "kept-key");
  assert.equal(stored.model, "kept-model");
  assert.equal(stored.targetLanguage, "nl");
  await page.close();
}

// 翻译语义正文、跳过代码，切换模式时不重复请求，并能精确恢复原文。
{
  const page = await createPage({ config: baseConfig() });
  await startWithFrog(page);
  await page.waitForFunction(() => document.querySelectorAll(".rf-via-translation:not([data-rf-error])").length >= 5);
  await page.waitForFunction(() => document.querySelector("#rf-via-host").shadowRoot.querySelector("#frog-status").dataset.status === "ok");
  assert.equal(await page.locator("pre .rf-via-translation").count(), 0);
  assert.equal(await page.locator(".rf-via-translation").first().evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
  const calls = await page.evaluate(() => window.__requestCount);
  await invokeMenu(page, "打开 Read Frog 设置");
  await page.locator("#rf-via-host").locator("#mode").selectOption("translation");
  await page.locator("#rf-via-host").locator("#save").click();
  await page.waitForFunction(() => document.querySelectorAll(".rf-via-translation:not([data-rf-error])").length === 0 && document.querySelector("p").textContent.startsWith("译："));
  assert.equal(await page.evaluate(() => window.__requestCount), calls);
  await invokeMenu(page, "恢复原文");
  assert.equal(await page.locator(".rf-via-translation").count(), 0);
  assert.equal(await page.locator(".rf-via-source-hidden,.rf-via-fragment-hidden,.rf-via-text-wrap").count(), 0);
  assert.equal(await page.locator("li").textContent(), "List item");
  await page.close();
}

// 单批失败后继续整页任务，并允许只重试失败段落。
{
  const page = await createPage({ config: baseConfig({ batchSize:1 }), failSecondOnce:true });
  await startWithFrog(page);
  await page.waitForFunction(() => document.querySelectorAll(".rf-via-translation[data-rf-error='1']").length === 1);
  await page.waitForFunction(() => document.querySelectorAll(".rf-via-translation:not([data-rf-error])").length >= 4);
  assert.ok(await page.locator(".rf-via-translation:not([data-rf-error])").count() >= 4);
  const failed = page.locator(".rf-via-translation[data-rf-error='1']");
  assert.match(await failed.textContent(), /请求过于频繁/);
  await failed.locator(".rf-via-retry").click();
  await page.waitForFunction(() => document.querySelectorAll(".rf-via-translation[data-rf-error='1']").length === 0 && document.querySelectorAll(".rf-via-translation:not([data-rf-error])").length >= 5);
  assert.match(await page.locator("p").nth(1).locator("xpath=following-sibling::*[1]").textContent(), /^译：Second/);
  await page.close();
}

// 翻译首次任务完成后追加的无限滚动或 SPA 内容。
{
  const page = await createPage({ config: baseConfig() });
  await startWithFrog(page);
  await page.waitForFunction(() => document.querySelectorAll(".rf-via-translation").length >= 5);
  await page.evaluate(() => { const p=document.createElement("p"); p.id="dynamic"; p.textContent="Fresh dynamic content."; document.querySelector("main").appendChild(p); });
  await page.waitForFunction(() => document.querySelector("#dynamic + .rf-via-translation")?.textContent.includes("Fresh dynamic"), null, { timeout:5000 });
  await page.close();
}

// 已取消的动态内容任务不能在稍后覆盖恢复原文后的空闲状态。
{
  const page = await createPage({ config: baseConfig({ batchSize:1, concurrency:1 }), delay:180 });
  await startWithFrog(page);
  await page.waitForFunction(() => document.querySelector("#rf-via-host").shadowRoot.querySelector("#frog-status").dataset.status === "ok", null, { timeout:5000 });
  await page.evaluate(() => {
    const p=document.createElement("p"); p.id="cancel-dynamic"; p.textContent="Dynamic content cancelled during its request.";
    document.querySelector("main").appendChild(p);
  });
  await page.waitForFunction(() => window.__requestedTexts.some((text) => text.includes("Dynamic content cancelled")), null, { timeout:5000 });
  await invokeMenu(page, "恢复原文");
  await page.waitForTimeout(260);
  const frog = page.locator("#rf-via-host").locator("#frog");
  assert.equal(await frog.evaluate((node) => node.classList.contains("complete") || node.classList.contains("partial") || node.classList.contains("busy")), false);
  assert.equal(await page.locator(".rf-via-translation").count(), 0);
  assert.equal(await page.locator("#cancel-dynamic").textContent(), "Dynamic content cancelled during its request.");
  await page.close();
}

// 处理第一批新增内容时，不得漏掉随后到达的第二次页面变化。
{
  const page = await createPage({ config: baseConfig({ batchSize:1, concurrency:1 }), delay:100 });
  await startWithFrog(page);
  await page.evaluate(() => {
    const p=document.createElement("p"); p.id="during-one"; p.textContent="First content added during translation.";
    document.querySelector("main").appendChild(p);
  });
  await page.waitForFunction(() => window.__requestedTexts.some((text) => text.includes("First content added")), null, { timeout:5000 });
  await page.evaluate(() => {
    const p=document.createElement("p"); p.id="during-two"; p.textContent="Second content added while the late batch is active.";
    document.querySelector("main").appendChild(p);
  });
  await page.waitForFunction(() => document.querySelector("#during-two + .rf-via-translation")?.textContent.includes("Second content added"), null, { timeout:5000 });
  await page.close();
}

// 新旧内容混合批次按段复用缓存，不重复翻译已缓存内容。
{
  const page = await createPage({ config: baseConfig({ batchSize:2, concurrency:1 }) });
  await startWithFrog(page);
  await page.waitForFunction(() => document.querySelectorAll(".rf-via-translation:not([data-rf-error])").length >= 5);
  const callsBefore = await page.evaluate(() => window.__requestCount);
  await page.evaluate(() => {
    const duplicate=document.createElement("p"); duplicate.id="cached-copy"; duplicate.textContent="Hello world.";
    const fresh=document.createElement("p"); fresh.id="fresh-copy"; fresh.textContent="A newly discovered paragraph.";
    document.querySelector("main").append(duplicate, fresh);
  });
  await page.waitForFunction(() => document.querySelector("#fresh-copy + .rf-via-translation")?.textContent.includes("newly discovered"), null, { timeout:5000 });
  assert.equal(await page.evaluate(() => window.__requestCount), callsBefore + 1);
  assert.equal(await page.evaluate(() => window.__requestedTexts.filter((text) => text === "Hello world.").length), 1);
  await page.close();
}

// 取消正在执行的 GM 请求，并能继续翻译未完成段落。
{
  const page = await createPage({ config: baseConfig({ batchSize:1, concurrency:1 }), delay:250 });
  await startWithFrog(page);
  await page.waitForTimeout(30);
  await page.locator("#rf-via-host").locator("#frog").click();
  await page.waitForFunction(() => document.querySelector("#rf-via-host").shadowRoot.querySelector("#frog").classList.contains("partial"));
  await page.locator("#rf-via-host").locator("#frog").click();
  await page.waitForFunction(() => document.querySelectorAll(".rf-via-translation:not([data-rf-error])").length >= 5, null, { timeout:5000 });
  await page.close();
}

// 拖动悬浮球后自动贴到屏幕另一侧。
{
  const page = await createPage({ config: baseConfig() });
  const frog = page.locator("#rf-via-host").locator("#frog");
  const box = await frog.boundingBox();
  await page.mouse.move(box.x+25, box.y+25); await page.mouse.down(); await page.mouse.move(25, 300, { steps:5 }); await page.mouse.up();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__store.read_frog_via_config_v2.buttonSide), "left");
  await page.close();
}

// 第一次点击呼出悬浮球，第二次点击才开始翻译。
{
  const page = await createPage({ config: baseConfig(), delay:250 });
  await summonFrog(page);
  const frog = page.locator("#rf-via-host").locator("#frog");
  assert.equal(await frog.locator("#frog-icon .frog-mark").count(), 1);
  assert.equal(await page.evaluate(() => window.__requestCount), 0);
  await frog.click();
  await page.waitForFunction(() => document.querySelector("#rf-via-host").shadowRoot.querySelector("#frog").classList.contains("busy"));
  assert.equal(await frog.evaluate((node) => node.classList.contains("tucked")), false);
  assert.ok(await page.evaluate(() => window.__requestCount) > 0);
  await page.waitForTimeout(180);
  assert.ok(Number(await frog.locator("#frog-loader").evaluate((node) => getComputedStyle(node).opacity)) > .9);
  const ringAnimation = await frog.locator("#frog-loader").evaluate((node) => getComputedStyle(node, "::after").animationName);
  const ringFrameA = await frog.locator("#frog-loader").evaluate((node) => getComputedStyle(node, "::after").transform);
  await page.waitForTimeout(70);
  const ringFrameB = await frog.locator("#frog-loader").evaluate((node) => getComputedStyle(node, "::after").transform);
  assert.equal(ringAnimation, "rf-spin");
  assert.notEqual(ringFrameA, ringFrameB);
  if (process.env.RF_QA_SPINNER) await page.screenshot({ path:process.env.RF_QA_SPINNER, fullPage:false });
  await page.close();
}

// 翻译期间悬浮球半隐藏时，左右两侧的加载圈都完整留在屏幕内。
for (const buttonSide of ["right", "left"]) {
  const page = await createPage({ config:baseConfig({ buttonSide, batchSize:1, concurrency:1 }), delay:500 });
  await startWithFrog(page);
  await page.evaluate(() => window.dispatchEvent(new WheelEvent("wheel", { deltaY:120 })));
  const frog = page.locator("#rf-via-host").locator("#frog");
  const loader = frog.locator("#frog-loader");
  await page.waitForFunction(() => document.querySelector("#rf-via-host").shadowRoot.querySelector("#frog").classList.contains("tucked"));
  await page.waitForTimeout(200);
  assert.ok(Number(await loader.evaluate((node) => getComputedStyle(node).opacity)) > .9);
  const loaderBox = await loader.boundingBox();
  const viewportWidth = await page.evaluate(() => innerWidth);
  assert.ok(loaderBox.x >= 0, `${buttonSide} loader left=${loaderBox.x}`);
  assert.ok(loaderBox.x + loaderBox.width <= viewportWidth, `${buttonSide} loader right=${loaderBox.x + loaderBox.width}`);
  await page.close();
}

// 忽略布局变化产生的滚动事件；用户主动滚动后保持半隐藏。
{
  const page = await createPage({ config: baseConfig() });
  const frog = page.locator("#rf-via-host").locator("#frog");
  await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  await page.waitForTimeout(280);
  assert.equal(await frog.evaluate((node) => node.classList.contains("tucked")), true);

  await summonFrog(page);
  await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  await page.waitForTimeout(30);
  assert.equal(await frog.evaluate((node) => node.classList.contains("tucked")), false);
  await page.evaluate(() => window.dispatchEvent(new WheelEvent("wheel", { deltaY:120 })));
  await page.waitForTimeout(30);
  assert.equal(await frog.evaluate((node) => node.classList.contains("tucked")), true);
  await page.waitForTimeout(330);
  assert.equal(await frog.evaluate((node) => node.classList.contains("tucked")), true);
  await frog.click();
  assert.equal(await frog.evaluate((node) => node.classList.contains("tucked")), false);
  await page.close();
}

// 停止或部分完成的警告在两秒后缩小为常驻右下角徽标。
{
  const page = await createPage({ config: baseConfig({ batchSize:1, concurrency:1 }), delay:250 });
  await startWithFrog(page);
  const frog = page.locator("#rf-via-host").locator("#frog");
  await frog.click();
  const status = frog.locator("#frog-status");
  await page.waitForFunction(() => document.querySelector("#rf-via-host").shadowRoot.querySelector("#frog-status").dataset.status === "warn");
  assert.equal(await status.evaluate((node) => node.classList.contains("show")), true);
  assert.equal(await status.evaluate((node) => node.classList.contains("minimized")), false);
  const fullFrogBox = await frog.boundingBox(); const fullStatusBox = await status.boundingBox();
  assert.ok(fullStatusBox.width >= fullFrogBox.width + 3);
  assert.ok(fullStatusBox.x <= fullFrogBox.x - 1);
  assert.ok(fullStatusBox.y <= fullFrogBox.y - 1);
  if (process.env.RF_QA_STATUS_FULL) await page.screenshot({ path:process.env.RF_QA_STATUS_FULL, fullPage:false });
  await page.waitForTimeout(1800);
  assert.equal(await status.evaluate((node) => node.classList.contains("minimized")), false);
  await page.waitForTimeout(300);
  assert.equal(await status.evaluate((node) => node.classList.contains("minimized")), true);
  assert.equal(await frog.locator("#frog-icon .frog-mark").count(), 1);
  assert.equal(await frog.evaluate((node) => node.classList.contains("tucked")), false);
  if (process.env.RF_QA_STATUS_BADGE) await page.screenshot({ path:process.env.RF_QA_STATUS_BADGE, fullPage:false });
  await page.close();
}

// 完成状态缩小为对勾徽标，随后悬浮球自动恢复半隐藏。
{
  const page = await createPage({ config: baseConfig() });
  await startWithFrog(page);
  await page.waitForFunction(() => document.querySelector("#rf-via-host").shadowRoot.querySelector("#frog-status").dataset.status === "ok");
  const completedFrog = page.locator("#rf-via-host").locator("#frog");
  const completedStatus = completedFrog.locator("#frog-status");
  assert.equal(await completedStatus.locator("svg.status-icon").count(), 1);
  assert.equal(await completedStatus.evaluate((node) => node.classList.contains("minimized")), false);
  assert.equal(await completedFrog.evaluate((node) => node.classList.contains("busy")), false);
  await page.waitForTimeout(220);
  assert.ok(Number(await completedFrog.locator("#frog-loader").evaluate((node) => getComputedStyle(node).opacity)) < .1);
  assert.equal(await completedFrog.evaluate((node) => node.classList.contains("tucked")), false);
  assert.equal(await page.locator("#rf-via-host").locator("#mini-status").count(), 0);
  await page.waitForTimeout(1900);
  assert.equal(await completedStatus.evaluate((node) => node.classList.contains("minimized")), true);
  await page.waitForTimeout(700);
  assert.equal(await completedFrog.evaluate((node) => node.classList.contains("tucked")), true);
  await page.close();
}

// 长按打开紧凑操作面板，不得误触发翻译。
{
  const page = await createPage({ config: baseConfig() });
  const frog = page.locator("#rf-via-host").locator("#frog");
  const box = await frog.boundingBox();
  await page.mouse.move(box.x+12, box.y+25); await page.mouse.down(); await page.waitForTimeout(570);
  const actions = page.locator("#rf-via-host").locator("#frog-actions");
  await page.waitForFunction(() => document.querySelector("#rf-via-host").shadowRoot.querySelector("#frog-actions").classList.contains("open"));
  await page.mouse.up(); await page.waitForTimeout(160);
  assert.equal(await page.evaluate(() => window.__requestCount), 0);
  assert.ok(Number(await actions.evaluate((node) => getComputedStyle(node).opacity)) > .9);
  assert.equal(await actions.locator("button").count(), 4);
  assert.equal(await actions.locator(".action-icon .rf-icon").count(), 4);
  const frogBox = await frog.boundingBox(); const actionsBox = await actions.boundingBox();
  assert.ok(actionsBox.y + actionsBox.height <= frogBox.y + 2);
  if (process.env.RF_QA_ACTIONS) await page.screenshot({ path:process.env.RF_QA_ACTIONS, fullPage:false });
  await actions.locator("#action-mode").click();
  assert.equal(await page.evaluate(() => window.__store.read_frog_via_config_v2.mode), "translation");
  await actions.locator("#action-settings").click();
  await page.locator("#rf-via-host").locator("#settings").waitFor({ state:"visible" });
  await page.close();
}

// 将 Via onerror 返回的 HTTP 状态转换为明确、可操作的提示。
{
  const page = await createPage({ config: baseConfig({ service:"custom", endpoint:"https://gateway.example/v1", apiKey:"key", model:"model" }) });
  await invokeMenu(page, "打开 Read Frog 设置");
  const cases = [[401,"API Key 无效"],[403,"接口拒绝访问"],[404,"接口路径不存在"],[429,"请求过于频繁"],[500,"服务暂时不可用"]];
  for (const [status, message] of cases) {
    await page.evaluate((value) => { window.__forceStatus = value; }, status);
    await page.locator("#rf-via-host").locator("#test").click();
    await page.waitForFunction((text) => document.querySelector("#rf-via-host").shadowRoot.querySelector("#settings-status").textContent.includes(text), message);
  }
  await page.close();
}

// 标准化自定义接口后缀，并用中文提示非法地址。
{
  const page = await createPage({ config: baseConfig({ service:"custom", endpoint:"https://gateway.example/v1", apiKey:"key", model:"model" }) });
  await invokeMenu(page, "打开 Read Frog 设置");
  const host = page.locator("#rf-via-host");
  await host.locator("#endpoint").fill("https://gateway.example/v1/chat/completions/?token=1");
  assert.equal(await host.locator("#endpoint-preview").textContent(), "https://gateway.example/v1/chat/completions?token=1");
  await host.locator("#endpoint").fill("not a url");
  await host.locator("#test").click();
  await page.waitForFunction(() => document.querySelector("#rf-via-host").shadowRoot.querySelector("#settings-status").textContent.includes("接口地址格式不正确"));
  await page.close();
}

// 支持划词翻译并复制译文。
{
  const page = await createPage({ config: baseConfig() });
  await page.evaluate(() => {
    const range=document.createRange(); const node=document.querySelector("p").firstChild;
    range.selectNodeContents(node); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles:true }));
  });
  const selection = page.locator("#rf-via-host").locator("#selection");
  await selection.waitFor({ state:"visible" });
  assert.equal(await selection.locator(".sel-actions .rf-icon").count(), 4);
  await page.locator("#rf-via-host").locator("#sel-translate").click();
  await page.waitForFunction(() => document.querySelector("#rf-via-host").shadowRoot.querySelector("#sel-result").textContent.startsWith("译："));
  await page.locator("#rf-via-host").locator("#sel-copy").click();
  assert.equal(await page.evaluate(() => window.__clipboard), "译：Hello world.");
  await page.close();
}

await browser.close();
console.log("Read Frog Via 1.0.1 tests: ok");
