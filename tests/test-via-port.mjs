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

async function createPage({ oldConfig = null, config = null, translationCache = null, failSecondUntilRetry = false, malformedBatch = false, delay = 0, singleDelay = 0, themeColor = "", bodyHtml = "", pageUrl = "" } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const content = bodyHtml || `<main><h1>A useful title</h1><p>Hello world.</p><p>Second paragraph.</p><pre><code>const ignored = true;</code></pre><ul><li>List item</li></ul><table><tr><td>Table cell</td></tr></table></main>`;
  const documentHtml = `<!doctype html><html><head><title>Reading Test</title></head><body>${content}</body></html>`;
  if (pageUrl) {
    await page.route(pageUrl, (route) => route.fulfill({ status:200, contentType:"text/html", body:documentHtml }));
    await page.goto(pageUrl);
  } else await page.setContent(documentHtml);
  if (themeColor) await page.evaluate((value) => { const meta=document.createElement("meta"); meta.name="theme-color"; meta.content=value; document.head.appendChild(meta); }, themeColor);
  await page.evaluate(({ oldConfig, config, translationCache, failSecondUntilRetry, malformedBatch, delay, singleDelay }) => {
    const store = {};
    if (oldConfig) store.read_frog_via_config_v1 = oldConfig;
    if (config) store.read_frog_via_config_v2 = config;
    if (translationCache) store.read_frog_via_translation_cache_v1 = translationCache;
    window.__store = store;
    window.__requestCount = 0;
    window.__requestedTexts = [];
    window.__menus = {};
    window.__secondFailures = 0;
    window.__forceStatus = 0;
    window.__requestInFlight = 0;
    window.__maxRequestInFlight = 0;
    window.GM_getValue = (key, fallback) => key in store ? store[key] : fallback;
    window.GM_setValue = (key, value) => { store[key] = value; };
    window.GM_addStyle = (css) => { const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style); };
    window.GM_registerMenuCommand = (label, handler) => { window.__menus[label] = handler; };
    window.GM_xmlhttpRequest = (options) => {
      window.__requestCount++;
      window.__requestInFlight++;
      window.__maxRequestInFlight = Math.max(window.__maxRequestInFlight, window.__requestInFlight);
      window.__lastGmUrl = options.url;
      let finished = false;
      const finish = (callback, value) => {
        if (finished) return;
        finished = true;
        window.__requestInFlight--;
        callback?.(value);
      };
      let cancelled = false;
      const handle = { abort() { if (!cancelled) { cancelled = true; finish(options.onabort, {}); } } };
      const body = JSON.parse(options.data);
      const microsoft = options.url.includes("edge.microsoft.com");
      const inputs = microsoft ? body : JSON.parse(body.messages[1].content);
      if (!microsoft) window.__lastSystemPrompt = body.messages[0].content;
      window.__requestedTexts.push(...inputs);
      setTimeout(() => {
        if (cancelled) return;
        if (window.__forceStatus) {
          const status = window.__forceStatus;
          finish(options.onerror, { status, statusText:"Forced Error", responseText:"test error" });
          return;
        }
        // 请求层会对 429 最多重试三次；四次均失败后才显示段落级重试入口。
        if (failSecondUntilRetry && inputs.some((x) => x.includes("Second")) && window.__secondFailures < 4) {
          window.__secondFailures++;
          finish(options.onerror, { status: 429, statusText: "Too Many Requests", responseText: "rate limited" });
          return;
        }
        const translations = inputs.map((x) => `译：${x}`);
        finish(options.onload, {
          status: 200,
          responseText: microsoft
            ? JSON.stringify(translations.map((text) => ({ translations: [{ text }] })))
            : JSON.stringify({ choices: [{ message: { content: malformedBatch && inputs.length > 1 ? "invalid batch" : JSON.stringify(translations) } }] }),
        });
      }, (inputs.length === 1 && singleDelay) || delay || 5);
      return handle;
    };
  }, { oldConfig, config, translationCache, failSecondUntilRetry, malformedBatch, delay, singleDelay });
  await page.addScriptTag({ content: script });
  return page;
}

// 双语翻译正文及可点击文字，同时不把工具栏/元数据容器整体当成段落。
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
  await startWithFrog(page);
  await page.waitForFunction(() => document.querySelectorAll(".markdown-body .rf-via-translation:not([data-rf-error])").length >= 5);
  await page.waitForFunction(() => document.querySelectorAll("#repo-toolbar button .rf-via-translation,#repo-meta a .rf-via-translation").length === 2);
  assert.equal(await page.locator("#repo-toolbar > .rf-via-translation,#repo-meta > .rf-via-translation").count(), 0);
  assert.equal(await page.locator("#repo-toolbar button .rf-via-translation,#repo-meta a .rf-via-translation").count(), 2);
  await page.locator("#repo-meta a").hover();
  assert.equal(await page.locator("#repo-meta a .rf-via-translation").evaluate((node) => getComputedStyle(node).textDecorationLine), "underline");
  assert.equal(await page.locator("main > .rf-via-translation").count(), 0);
  assert.equal(await page.locator("#flex-copy > .rf-via-translation").count(), 0);
  assert.equal(await page.locator("#flex-copy p > .rf-via-translation").count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), await page.evaluate(() => document.documentElement.clientWidth));
  const requested = (await page.evaluate(() => window.__requestedTexts)).join(" ");
  assert.doesNotMatch(requested, /163 lines|9\.66 KB/);
  assert.match(requested, /More|History|Preview|Blame/);
  assert.match(requested, /Better reading experience|cross-platform reading tool/);
  if (process.env.RF_QA_LAYOUT) await page.screenshot({ path:process.env.RF_QA_LAYOUT, fullPage:true });
  await page.close();
}

// 通用处理导航、新闻卡片、加载按钮和页脚链接：只替换文字，保留控件结构与事件。
{
  const bodyHtml = `
    <header><nav><a id="world-link" href="#world"><svg aria-hidden="true"></svg><span>World News</span></a></nav></header>
    <main><section>
      <a id="story-link" href="#story"><span class="icon" aria-hidden="true">●</span><strong>Interactive headline inside a news card</strong></a>
      <button id="load-more" type="button"><span>Load more articles</span></button>
    </section></main>
    <footer><a id="about-link" href="#about">About this publisher</a></footer>`;
  const page = await createPage({ config:baseConfig({ mode:"translation" }), bodyHtml });
  await page.evaluate(() => {
    window.__clicks = { story:0, load:0 };
    document.querySelector("#story-link").addEventListener("click", (event) => { event.preventDefault(); window.__clicks.story++; });
    document.querySelector("#load-more").addEventListener("click", () => {
      window.__clicks.load++;
      const link=document.createElement("a"); link.id="dynamic-story"; link.href="#dynamic";
      link.textContent="New interactive headline loaded after scrolling";
      document.querySelector("main section").appendChild(link);
    });
  });
  await startWithFrog(page);
  await page.waitForFunction(() =>
    document.querySelector("#world-link").textContent.includes("译：World News") &&
    document.querySelector("#story-link").textContent.includes("译：Interactive headline") &&
    document.querySelector("#load-more").textContent.includes("译：Load more articles") &&
    document.querySelector("#about-link").textContent.includes("译：About this publisher")
  );
  assert.equal(await page.locator("#story-link .icon").count(), 1);
  assert.equal(await page.locator("#story-link").getAttribute("href"), "#story");
  await page.locator("#story-link").click();
  await page.locator("#load-more").click();
  assert.deepEqual(await page.evaluate(() => window.__clicks), { story:1, load:1 });
  await page.waitForFunction(() => document.querySelector("#dynamic-story").textContent.includes("译：New interactive headline"));
  await invokeMenu(page, "恢复原文");
  assert.equal(await page.locator(".rf-via-source-segment").count(), 0);
  assert.equal(await page.locator("#world-link").textContent(), "World News");
  assert.equal(await page.locator("#story-link").textContent(), "●Interactive headline inside a news card");
  assert.equal(await page.locator("#load-more").textContent(), "Load more articles");
  assert.equal(await page.locator("#about-link").textContent(), "About this publisher");
  assert.equal(await page.locator("#dynamic-story").textContent(), "New interactive headline loaded after scrolling");
  await page.close();
}

// 含图片的新闻卡片不能整体替换，只翻译其文字区域并保留 picture/img。
{
  const bodyHtml = `<main><ul><li id="media-card">
    <div class="media"><picture><source srcset="cover.webp"><img src="cover.jpg" alt="News cover"></picture></div>
    <div class="copy"><h3 class="card-headline"><span>Technology</span><strong>A headline beside an important photograph</strong></h3><time>4h ago</time></div>
  </li></ul></main>`;
  const page = await createPage({ config:baseConfig({ mode:"translation" }), bodyHtml });
  const originalCard = await page.locator("#media-card").innerHTML();
  await startWithFrog(page);
  await page.waitForFunction(() => document.querySelector("#media-card").textContent.includes("译："));
  assert.equal(await page.locator("#media-card picture").count(), 1);
  assert.equal(await page.locator("#media-card img").getAttribute("src"), "cover.jpg");
  assert.equal(await page.locator("#media-card source").getAttribute("srcset"), "cover.webp");
  await invokeMenu(page, "恢复原文");
  assert.equal(await page.locator("#media-card").innerHTML(), originalCard);
  await page.close();
}

// 长文中的普通文字和链接候选必须按阅读位置混排，链接不能被 500 条上限挤出队列。
{
  const paragraphs = Array.from({ length:255 }, (_, index) =>
    `<p>Readable prefix number ${index} with <a id="term-${index}" href="#term-${index}">interactive concept ${index}</a> followed by explanatory text.</p>`
  ).join("");
  const page = await createPage({ config:baseConfig({ mode:"translation", batchSize:5, concurrency:2 }), bodyHtml:`<main>${paragraphs}</main>` });
  await startWithFrog(page);
  await page.waitForFunction(() => document.querySelector("#term-0").textContent.includes("译：interactive concept 0"));
  const firstLink = page.locator("#term-0");
  await firstLink.hover();
  assert.equal(await firstLink.locator(".rf-via-interactive-segment").evaluate((node) => getComputedStyle(node).textDecorationLine), "underline");
  assert.equal(await firstLink.getAttribute("href"), "#term-0");
  await page.close();
}

// 正文容器之外的相邻文章标题区也应翻译，并保留署名中的头像/作者组件。
{
  const bodyHtml = `<div class="article">
    <div class="story-header">
      <div class="article_title">A summit headline placed before the article body</div>
      <div class="article_subtitle">A descriptive standfirst belongs to the same story</div>
      <span class="byline">By First Reporter and <span class="author-popover"><a href="#author"><img src="author.png" alt="Author"></a></span> Second Reporter in Beijing</span>
      <span class="pub_time">Published: September 11, 2026</span>
    </div>
    <div class="article_content"><p>The main article body starts in a separate sibling container and contains enough readable text.</p></div>
  </div>`;
  const page = await createPage({ config:baseConfig({ mode:"translation" }), bodyHtml });
  const originalArticle = await page.locator(".article").innerHTML();
  await startWithFrog(page);
  await page.waitForFunction(() =>
    document.querySelector(".article_title").textContent.includes("译：A summit headline") &&
    document.querySelector(".article_subtitle").textContent.includes("译：A descriptive standfirst") &&
    document.querySelector(".pub_time").textContent.includes("译：Published")
  );
  const requested = (await page.evaluate(() => window.__requestedTexts)).join(" ");
  assert.match(requested, /By First Reporter|Second Reporter in Beijing/);
  assert.equal(await page.locator(".author-popover img").getAttribute("src"), "author.png");
  await invokeMenu(page, "恢复原文");
  assert.equal(await page.locator(".article").innerHTML(), originalArticle);
  await page.close();
}

// 多 article 首页应扫描整个 main，不能让右侧信息流遮蔽同级卡片的简介和作者。
{
  const bodyHtml = `<main>
    <section id="story-grid"><div class="content-card">
      <img src="phone.jpg" alt="Phone">
      <a href="#phone">A linked card headline</a>
      <p id="card-summary">Cameras do not need to be placed in every product.</p>
      <div><span><span id="card-author">John Example</span></span></div>
    </div></section>
    <div id="quick-posts">
      <article><p id="quick-one">A first quick post that is long enough to form a semantic article root.</p></article>
      <article><p id="quick-two">A second quick post that would previously monopolize the reading roots.</p></article>
    </div>
  </main>`;
  const page = await createPage({ config:baseConfig({ mode:"translation" }), bodyHtml });
  await startWithFrog(page);
  await page.waitForFunction(() =>
    document.querySelector("#card-summary").textContent.includes("译：Cameras") &&
    document.querySelector("#card-author").textContent.includes("译：John Example") &&
    document.querySelector("#quick-one").textContent.includes("译：A first quick post") &&
    document.querySelector("#quick-two").textContent.includes("译：A second quick post")
  );
  assert.equal(await page.locator("#story-grid img").getAttribute("src"), "phone.jpg");
  const requested = (await page.evaluate(() => window.__requestedTexts)).join(" ");
  assert.match(requested, /A first quick post|A second quick post/);
  await invokeMenu(page, "恢复原文");
  assert.equal(await page.locator("#card-summary").textContent(), "Cameras do not need to be placed in every product.");
  assert.equal(await page.locator("#card-author").textContent(), "John Example");
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
    autoTranslateHosts: [],
    ...overrides,
  };
}

async function summonFrog(page) {
  const frog = page.locator("#rf-via-host").locator("#frog");
  assert.equal(await frog.evaluate((node) => node.classList.contains("tucked")), true);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#rf-via-host").shadowRoot.querySelector("#frog")).boxShadow === "none");
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

// 启动翻译时先显示加载态；用户若立刻停止，尚未开始的扫描不能再发请求。
{
  const page = await createPage({ config:baseConfig() });
  const beforeScan = await page.evaluate(() => {
    window.__menus["翻译当前网页"]();
    const frog = document.querySelector("#rf-via-host").shadowRoot.querySelector("#frog");
    const state = { busy:frog.classList.contains("busy"), requests:window.__requestCount };
    window.__menus["停止翻译"]();
    return state;
  });
  assert.deepEqual(beforeScan, { busy:true, requests:0 });
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => window.__requestCount), 0);
  await page.close();
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
  assert.deepEqual(stored.autoTranslateHosts, []);
  await page.close();
}

// 为当前 hostname 开启后自动翻译所有路径，并在设置中明确显示精确生效的域名。
{
  const page = await createPage({
    pageUrl:"https://news.example.test/world/story-1",
    config:baseConfig({ autoTranslateHosts:["NEWS.EXAMPLE.TEST", "news.example.test", ""] }),
  });
  await page.waitForFunction(() => window.__requestCount > 0 && document.querySelectorAll(".rf-via-translation:not([data-rf-error])").length > 0);
  await invokeMenu(page, "打开 Read Frog 设置");
  const host = page.locator("#rf-via-host");
  assert.equal(await host.locator("#auto-site").isChecked(), true);
  assert.equal(await host.locator("#auto-site-host").textContent(), "news.example.test");
  assert.deepEqual(await page.evaluate(() => window.__store.read_frog_via_config_v2.autoTranslateHosts), ["news.example.test"]);
  await host.locator("#auto-site").uncheck();
  await host.locator("#save").click();
  assert.deepEqual(await page.evaluate(() => window.__store.read_frog_via_config_v2.autoTranslateHosts), []);
  await page.close();
}

// 同一配置不会误作用于其他 hostname；AI 配置无效时也不会自动弹窗或发起请求。
{
  const page = await createPage({
    pageUrl:"https://other.example.test/article",
    config:baseConfig({ autoTranslateHosts:["news.example.test"] }),
  });
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.__requestCount), 0);
  await invokeMenu(page, "打开 Read Frog 设置");
  assert.equal(await page.locator("#rf-via-host").locator("#auto-site").isChecked(), false);
  await page.close();

  const invalidPage = await createPage({
    pageUrl:"https://news.example.test/private",
    config:baseConfig({ service:"custom", endpoint:"https://gateway.example/v1", apiKey:"", model:"model", autoTranslateHosts:["news.example.test"] }),
  });
  await invalidPage.waitForTimeout(650);
  assert.equal(await invalidPage.evaluate(() => window.__requestCount), 0);
  assert.equal(await invalidPage.locator("#rf-via-host").locator("#settings").evaluate((node) => node.classList.contains("open")), false);
  await invalidPage.close();
}

// 在设置中首次开启后立即翻译当前页，同时持久化站点规则。
{
  const page = await createPage({ pageUrl:"https://reading.example.test/article/2", config:baseConfig() });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__requestCount), 0);
  await invokeMenu(page, "打开 Read Frog 设置");
  const host = page.locator("#rf-via-host");
  await host.locator("#auto-site").check();
  await host.locator("#save").click();
  await page.waitForFunction(() => window.__requestCount > 0);
  assert.deepEqual(await page.evaluate(() => window.__store.read_frog_via_config_v2.autoTranslateHosts), ["reading.example.test"]);
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

// 通用覆盖表单标签、控件可见属性、导航/页脚文字，以及老式块级与行内混排内容。
{
  const bodyHtml = `<header><p id="header-copy">Account access and support</p></header>
  <nav><p id="nav-heading">Network, SIM and plans</p></nav>
  <form id="legacy-form" onsubmit="return false">
    <h1 id="login-title">Log in</h1>
    <label id="member-label" for="member-input">Mobile number, member name or email address</label>
    <input id="member-input" type="text" placeholder="Enter your member name">
    <label id="student-label"><input id="student-radio" type="radio" name="kind">Student</label>
    <input id="submit-input" type="submit" value="Submit">
    <table><tbody><tr><td><span id="legacy-copy">
      <p><img id="legacy-image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="width:16px;height:16px"></p>
      <p id="country-name">United States</p><br>
      Searching for books with a corresponding <a id="product-link" href="#product">Accelerated Reader 360<sup>®</sup></a>
      quiz is easy with this book finder. Students, teachers, parents, and librarians can search in English or Spanish.<br><br>
      Please tell us who you are:
    </span></td></tr></tbody></table>
  </form>
  <footer><p id="footer-heading">Manage your account</p><p id="footer-legal">This service is authorised and regulated for eligible permanent residents.</p></footer>`;
  const page = await createPage({ config:baseConfig({ mode:"translation", batchSize:5 }), bodyHtml });
  await page.evaluate(() => {
    window.__productClicks=0;
    document.querySelector("#product-link").addEventListener("click", (event) => { event.preventDefault(); window.__productClicks++; });
  });
  await startWithFrog(page);
  await page.waitForFunction(() =>
    document.querySelector("#login-title").textContent.startsWith("译：") &&
    document.querySelector("#member-label").textContent.startsWith("译：") &&
    document.querySelector("#member-input").placeholder.startsWith("译：") &&
    document.querySelector("#submit-input").value.startsWith("译：") &&
    document.querySelector("#footer-heading").textContent.startsWith("译：") &&
    document.querySelector("#legacy-copy").textContent.includes("译：Searching for books")
  );
  assert.equal(await page.locator("#legacy-image").count(), 1);
  assert.equal(await page.locator("#student-radio").count(), 1);
  const mixedText = (await page.locator("#legacy-copy").textContent()).replace(/\s+/g, " ");
  assert.match(mixedText, /corresponding\s+译：Accelerated Reader/);
  assert.match(mixedText, /360®\s+译：quiz is easy/);
  await page.locator("#product-link").click();
  assert.equal(await page.evaluate(() => window.__productClicks), 1);
  await invokeMenu(page, "恢复原文");
  assert.equal(await page.locator("#login-title").textContent(), "Log in");
  assert.equal(await page.locator("#member-label").textContent(), "Mobile number, member name or email address");
  assert.equal(await page.locator("#member-input").getAttribute("placeholder"), "Enter your member name");
  assert.equal(await page.locator("#submit-input").getAttribute("value"), "Submit");
  assert.equal(await page.locator("#student-label").textContent(), "Student");
  assert.equal(await page.locator("#legacy-copy .rf-via-source-segment").count(), 0);
  await page.close();
}

// 目标为中文时，本地跳过纯中文和纯数字，混合语言仍交给 AI，并要求保留已有中文。
{
  const bodyHtml = `<main>
    <p id="chinese-only">这是已经写好的中文界面文字。</p>
    <p id="mixed-language">当前功能 uses English words and 中文说明。</p>
    <p id="english-only">This sentence still needs a complete translation.</p>
    <p id="numbers-only">2026 · 09 · 11</p>
  </main>`;
  const page = await createPage({
    bodyHtml,
    config:baseConfig({ service:"custom", endpoint:"https://gateway.example/v1", apiKey:"speed-secret", model:"fast-model", targetLanguage:"zh-Hans", mode:"translation", batchSize:5 }),
  });
  await startWithFrog(page);
  await page.waitForFunction(() => document.querySelector("#english-only").textContent.startsWith("译："));
  const requested = await page.evaluate(() => window.__requestedTexts);
  assert.equal(requested.includes("这是已经写好的中文界面文字。"), false);
  assert.equal(requested.includes("2026 · 09 · 11"), false);
  assert.equal(requested.includes("当前功能 uses English words and 中文说明。"), true);
  assert.equal(requested.includes("This sentence still needs a complete translation."), true);
  assert.equal(await page.locator("#chinese-only").textContent(), "这是已经写好的中文界面文字。");
  assert.match(await page.evaluate(() => window.__lastSystemPrompt), /keep that part unchanged/);
  await page.close();
}

// 保留一次批量请求，同时按阅读顺序逐条显示译文，避免整批同时跳出。
{
  const bodyHtml = `<main>
    <p id="reveal-0">First progressive reveal paragraph.</p>
    <p id="reveal-1">Second progressive reveal paragraph.</p>
    <p id="reveal-2">Third progressive reveal paragraph.</p>
    <p id="reveal-3">Fourth progressive reveal paragraph.</p>
  </main>`;
  const page = await createPage({
    bodyHtml,
    config:baseConfig({ service:"custom", endpoint:"https://gateway.example/v1", apiKey:"key", model:"model", mode:"translation", batchSize:4, concurrency:2 }),
  });
  await page.evaluate(() => {
    window.__revealTimes = [];
    const seen = new Set();
    new MutationObserver(() => {
      for (let index=0; index<4; index++) {
        const id=`reveal-${index}`;
        if (!seen.has(id) && document.querySelector(`#${id}`).textContent.startsWith("译：")) {
          seen.add(id);
          window.__revealTimes.push({ id, time:performance.now() });
        }
      }
    }).observe(document.querySelector("main"), { childList:true, subtree:true, characterData:true });
  });
  await startWithFrog(page);
  await page.waitForFunction(() => window.__revealTimes.length === 4);
  const reveals = await page.evaluate(() => window.__revealTimes);
  assert.deepEqual(reveals.map((item) => item.id).sort(), ["reveal-0","reveal-1","reveal-2","reveal-3"]);
  assert.ok(reveals.slice(1).every((item,index) => item.time - reveals[index].time >= 30));
  assert.equal(await page.evaluate(() => window.__requestCount), 1);
  await page.close();
}

// AI 批量格式异常时使用受控的两路并行单段补救，避免五段完全串行。
{
  const bodyHtml = `<main>
    <p>First fallback paragraph needs translation.</p>
    <p>Second fallback paragraph needs translation.</p>
    <p>Third fallback paragraph needs translation.</p>
    <p>Fourth fallback paragraph needs translation.</p>
  </main>`;
  const page = await createPage({
    bodyHtml, malformedBatch:true, singleDelay:80,
    config:baseConfig({ service:"custom", endpoint:"https://gateway.example/v1", apiKey:"key", model:"model", mode:"translation", batchSize:4, concurrency:2 }),
  });
  await startWithFrog(page);
  await page.waitForFunction(() => Array.from(document.querySelectorAll("p")).every((node) => node.textContent.startsWith("译：")));
  assert.equal(await page.evaluate(() => window.__requestCount), 5);
  assert.equal(await page.evaluate(() => window.__maxRequestInFlight), 2);
  await page.close();
}

// 持久缓存跨页面复用，并确认序列化内容不包含 API Key。
{
  const bodyHtml = `<main><p id="cached-text">A unique persistent cache sentence.</p></main>`;
  const first = await createPage({
    bodyHtml,
    config:baseConfig({ service:"custom", endpoint:"https://gateway.example/v1?token=endpoint-secret", apiKey:"first-secret-key", model:"cache-model", mode:"translation" }),
  });
  await startWithFrog(first);
  await first.waitForFunction(() => document.querySelector("#cached-text").textContent.startsWith("译："));
  await first.waitForFunction(() => Array.isArray(window.__store.read_frog_via_translation_cache_v1) && window.__store.read_frog_via_translation_cache_v1.length > 0);
  const storedCache = await first.evaluate(() => window.__store.read_frog_via_translation_cache_v1);
  assert.equal(JSON.stringify(storedCache).includes("first-secret-key"), false);
  assert.equal(JSON.stringify(storedCache).includes("endpoint-secret"), false);
  await first.close();

  const second = await createPage({
    bodyHtml, translationCache:storedCache,
    config:baseConfig({ service:"custom", endpoint:"https://gateway.example/v1?token=endpoint-secret", apiKey:"second-secret-key", model:"cache-model", mode:"translation" }),
  });
  await summonFrog(second);
  await second.locator("#rf-via-host").locator("#frog").click();
  await second.waitForFunction(() => document.querySelector("#cached-text").textContent.startsWith("译："));
  assert.equal(await second.evaluate(() => window.__requestCount), 0);
  await second.close();
}

// 单批失败后继续整页任务，并允许只重试失败段落。
{
  const page = await createPage({ config: baseConfig({ batchSize:1 }), failSecondUntilRetry:true });
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

// 阻塞 head 中的外部脚本，验证页面尚无 body、DOMContentLoaded 尚未触发时青蛙已出现。
async function createEarlyPage(automatic) {
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  let releaseScript;
  const heldScript = new Promise((resolve) => { releaseScript = resolve; });
  const url = "https://startup.example.test/article";
  await page.route("https://startup.example.test/hold.js", async (route) => {
    await heldScript;
    await route.fulfill({ status:200, contentType:"application/javascript", body:"window.__heldScriptDone = true;" });
  });
  await page.route(url, (route) => route.fulfill({
    status:200, contentType:"text/html",
    body:'<!doctype html><html><head><script src="/hold.js"></script></head><body><main><h1>Early reading title</h1><p>Early reading paragraph.</p></main></body></html>',
  }));
  const config = baseConfig({ autoTranslateHosts:automatic ? ["startup.example.test"] : [] });
  const mocks = `
    window.__initHadRoot = !!document.documentElement;
    window.__requestCount = 0;
    window.GM_getValue = (key, fallback) => key === "read_frog_via_config_v2" ? ${JSON.stringify(config)} : fallback;
    window.GM_setValue = () => {};
    window.GM_addStyle = (css) => { const style = document.createElement("style"); style.textContent = css; (document.head || document.documentElement).appendChild(style); };
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = (options) => {
      window.__requestCount++;
      const texts = JSON.parse(options.data);
      setTimeout(() => options.onload({ status:200, responseText:JSON.stringify(texts.map((text) => ({ translations:[{ text:"译：" + text }] }))) }), 0);
      return { abort() {} };
    };
  `;
  await page.addInitScript({ content:mocks + "\n" + script });
  await page.goto(url, { waitUntil:"commit" });
  await page.waitForFunction(() => {
    const host = document.querySelector("#rf-via-host");
    return host && host.getAttribute("data-rf-startup") === "ready" && !document.body && document.readyState === "loading";
  }, null, { timeout:5000 });
  assert.equal(await page.locator("#rf-via-host").evaluate((node) => node.parentElement.tagName), "HTML");
  return { page, releaseScript };
}

{
  const { page, releaseScript } = await createEarlyPage(false);
  assert.equal(await page.evaluate(() => window.__initHadRoot), false);
  assert.equal(await page.locator("#rf-via-host").locator("#frog").count(), 1);
  assert.equal(await page.evaluate(() => window.__requestCount), 0);
  const frog = page.locator("#rf-via-host").locator("#frog");
  await frog.click({ force:true });
  await frog.click({ force:true });
  assert.equal(await frog.evaluate((node) => node.classList.contains("busy")), true);
  assert.equal(await page.evaluate(() => window.__requestCount), 0);
  releaseScript();
  await page.waitForLoadState("load");
  await page.waitForFunction(() => window.__requestCount > 0);
  await page.waitForFunction(() => document.querySelector("#rf-via-host").parentElement === document.body);
  await page.addScriptTag({ content:script });
  assert.equal(await page.locator("#rf-via-host").count(), 1);
  await page.evaluate(() => {
    const replacement = document.createElement("html");
    replacement.innerHTML = "<head><title>Replacement</title></head><body><main><p>New content.</p></main></body>";
    document.documentElement.replaceWith(replacement);
  });
  await page.waitForFunction(() => document.querySelectorAll("#rf-via-host").length === 1);
  assert.equal(await page.locator("#rf-via-host").evaluate((node) => node.parentElement.tagName), "BODY");
  assert.equal(await page.locator("#rf-via-host").locator("#frog").count(), 1);
  await page.evaluate(() => document.querySelector("#rf-via-host").remove());
  await page.waitForFunction(() => document.querySelector("#rf-via-host")?.parentElement === document.body);
  await page.locator("#rf-via-host").locator("#frog").click({ force:true });
  assert.equal(await page.locator("#rf-via-host").locator("#frog").evaluate((node) => node.classList.contains("tucked")), false);
  await page.close();
}

{
  const { page, releaseScript } = await createEarlyPage(false);
  const frog = page.locator("#rf-via-host").locator("#frog");
  await frog.click({ force:true });
  await frog.click({ force:true });
  await frog.click({ force:true });
  releaseScript();
  await page.waitForLoadState("load");
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__requestCount), 0);
  await page.close();
}

{
  const { page, releaseScript } = await createEarlyPage(true);
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => window.__requestCount), 0);
  releaseScript();
  await page.waitForLoadState("load");
  await page.waitForFunction(() => window.__requestCount > 0);
  assert.equal(await page.locator("#rf-via-host").count(), 1);
  await page.close();
}

// 部分网站会隐藏 html 下的直接 div；脚本宿主必须覆盖这种页面级样式。
{
  const page = await createPage({
    config:baseConfig(),
    bodyHtml:'<style>html > div { display:none!important }</style><main><p>Visible reading text.</p></main>',
  });
  const host = page.locator("#rf-via-host");
  assert.equal(await host.evaluate((node) => getComputedStyle(node).display), "block");
  assert.ok((await host.locator("#frog").boundingBox()).width >= 40);
  await page.close();
}

await browser.close();
console.log("Read Frog Via 1.2.1 tests: ok");
