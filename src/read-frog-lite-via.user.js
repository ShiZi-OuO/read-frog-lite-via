// ==UserScript==
// @name         Read Frog Lite for Via
// @namespace    https://github.com/ShiZi-OuO/read-frog-lite-via
// @version      1.2.1
// @description  为 Via 优化的移动端网页翻译：渐进式翻译、原文切换、自动翻译与多服务支持
// @author       Read Frog contributors; Modified for Via Browser by shizi
// @license      GPL-3.0-only
// @match        http://*/*
// @match        https://*/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      *
// ==/UserScript==

/*
 * Lightweight userscript based on Read Frog.
 *
 * Upstream:
 * https://github.com/mengxi-ream/read-frog
 *
 * Modified for Via Browser.
 * This is not an official Read Frog release.
 *
 * Licensed under GNU GPL v3.0.
 */

(function () {
  "use strict";

  if (window.top !== window.self || document.getElementById("rf-via-host") || document.__rfViaBooting) return;
  document.__rfViaBooting = true;

  // Via 在 document-end 注入时通常已有 body；保留早期 DOM 兜底，
  // 宿主最终挂在 body 下，避免网页针对 html 直系子节点的隐藏规则。
  var startupAt = window.performance && performance.now ? performance.now() : 0;
  var host = document.createElement("div");
  host.id = "rf-via-host";
  host.style.cssText = "display:block!important;visibility:visible!important;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;z-index:2147483647!important;pointer-events:none!important;";
  var root = host.attachShadow ? host.attachShadow({ mode:"open" }) : host;
  var readyObserver = null;
  var bodyReadyHandler = null;
  var booted = false;
  function startupStage(stage) {
    // 仅记录启动阶段和相对时间，不记录网址、正文、配置或 API Key。
    host.setAttribute("data-rf-startup", stage);
    if (startupAt) host.setAttribute("data-rf-start-ms", String(Math.round(startupAt)));
  }
  function ensureHost() {
    var target = document.body || document.documentElement;
    if (target && host.parentNode !== target) target.appendChild(host);
  }
  function bootWhenReady() {
    if (booted || !document.documentElement) return;
    booted = true;
    if (readyObserver) { readyObserver.disconnect(); readyObserver = null; }
    document.removeEventListener("readystatechange", bootWhenReady);
    ensureHost();
    startupStage("shell");
    root.innerHTML = `
      <style>
        :host{all:initial;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;pointer-events:none!important}
        #frog-dock{position:fixed;right:0;top:72vh;width:70px;height:70px;pointer-events:none}
        #frog{position:absolute;right:10px;top:10px;width:50px;height:50px;padding:0;border:0;border-radius:50%;background:linear-gradient(145deg,#70a989,#4d6656);color:#fff;opacity:.46;transform:translateX(35px);pointer-events:auto}
        #frog-icon{display:flex;align-items:center;justify-content:center;transform:translateX(-12px) scale(.72)}
        .frog-mark{width:37px;height:37px}.frog-face{fill:#d4eadb}.frog-eye{fill:#183326}
        .frog-smile{fill:none;stroke:#d87969;stroke-width:3;stroke-linecap:round}
        #frog-loader,#frog-status{display:none}
      </style>
      <div id="frog-dock"><button id="frog" class="tucked" aria-label="打开 Read Frog">
        <span id="frog-icon"><svg class="frog-mark" viewBox="0 0 48 48" aria-hidden="true">
          <circle class="frog-face" cx="15" cy="15" r="7"/><circle class="frog-face" cx="33" cy="15" r="7"/>
          <ellipse class="frog-face" cx="24" cy="28" rx="18" ry="14"/>
          <circle class="frog-eye" cx="15" cy="15" r="2.5"/><circle class="frog-eye" cx="33" cy="15" r="2.5"/>
          <circle class="frog-eye" cx="21" cy="25" r="1.2"/><circle class="frog-eye" cx="27" cy="25" r="1.2"/>
          <path class="frog-smile" d="M15 29c2.6 4 6 5.5 9 5.5s6.4-1.5 9-5.5"/>
        </svg></span><span id="frog-loader" aria-hidden="true"></span><span id="frog-status" aria-hidden="true"></span>
      </button></div>`;
    var shellFrog = root.querySelector("#frog");
    // 只观察 document、html 和 body 的直接子节点：既能处理根节点替换、宿主脱离和 body 到来，
    // 又不会在新闻流频繁改写正文时为每一处子节点变化付出额外扫描成本。
    var observedRoot = document.documentElement;
    var observedBody = document.body;
    var remountObserver = new MutationObserver(function () {
      if (document.documentElement !== observedRoot || document.body !== observedBody) {
        remountObserver.disconnect();
        remountObserver.observe(document, { childList:true });
        observedRoot = document.documentElement;
        if (observedRoot) remountObserver.observe(observedRoot, { childList:true });
        observedBody = document.body;
        if (observedBody) remountObserver.observe(observedBody, { childList:true });
      }
      ensureHost();
      if (document.body && bodyReadyHandler) {
        var handler = bodyReadyHandler; bodyReadyHandler = null; handler();
      }
    });
    remountObserver.observe(document, { childList:true });
    remountObserver.observe(observedRoot, { childList:true });
    if (observedBody) remountObserver.observe(observedBody, { childList:true });
    try { initialize(shellFrog); startupStage("ready"); }
    catch (error) {
      startupStage("failed");
      try { console.warn("[Read Frog Via] 启动失败（仅记录错误类型）:", error && error.name || "Error"); } catch (_) {}
    }
  }
  if (document.documentElement) bootWhenReady();
  else {
    readyObserver = new MutationObserver(bootWhenReady);
    readyObserver.observe(document, { childList:true });
    document.addEventListener("readystatechange", bootWhenReady);
  }

  function initialize(shellFrog) {

  // ---------------------------------------------------------------------------
  // 配置与持久化状态
  // ---------------------------------------------------------------------------

  var VERSION = "1.2.1";
  var CONFIG_KEY = "read_frog_via_config_v2";
  var OLD_CONFIG_KEY = "read_frog_via_config_v1";
  var TRANSLATION_CACHE_KEY = "read_frog_via_translation_cache_v1";
  var TRANSLATION_CACHE_LIMIT = 300;
  var TRANSLATION_CACHE_CHAR_LIMIT = 250000;
  var MAX_PARAGRAPHS = 500;         // 每轮扫描最多新增的记录数（分轮处理，不是总量上限）
  var MAX_RECORDS = 20000;          // 内存安全上限，仅用于拦截极端页面
  // 单个元素的文本长度上限（超过则视为"整页容器"跳过，避免把整篇文章当成一段）；
  // 单次请求里每个字符串的长度上限（超长段落会按句子/标点切分后合并，见 splitLongText）。
  var MAX_TEXT_LENGTH = 20000;
  var MAX_CHUNK_LENGTH = 3600;
  var REQUEST_TIMEOUT = 60000;
  var MUTATION_DEBOUNCE = 700;      // 静默多久后开始处理积累的 DOM 变化
  var MUTATION_MAX_WAIT = 2500;     // 页面持续变化时的最大等待上限（防止防抖饥饿）
  var TRANSLATION_CLASS = "rf-via-translation";
  var SOURCE_SEGMENT_CLASS = "rf-via-source-segment";
  var INTERACTIVE_SEGMENT_CLASS = "rf-via-interactive-segment";
  var UI_LABEL_CLASS = "rf-via-ui-label";   // 界面容器内的可读文字标签（工具栏/菜单/标签栏）

  var DEFAULT_CONFIG = {
    schemaVersion: 2,
    service: "microsoft",
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    model: "gpt-4o-mini",
    targetLanguage: "zh-Hans",
    mode: "translation",
    replacementUpgradeApplied: true,
    translationStyle: "annotation",
    batchSize: 5,
    concurrency: 2,
    buttonSide: "right",
    buttonY: 0.72,
    autoTranslateHosts: []
  };

  var LANGUAGES = [
    ["zh-Hans", "简体中文"], ["zh-Hant", "繁體中文"], ["en", "English"],
    ["ja", "日本語"], ["ko", "한국어"], ["fr", "Français"], ["de", "Deutsch"],
    ["es", "Español"], ["ru", "Русский"], ["pt", "Português"], ["it", "Italiano"],
    ["vi", "Tiếng Việt"], ["th", "ไทย"], ["ar", "العربية"]
  ];
  var LANGUAGE_NAMES = {};
  LANGUAGES.forEach(function (item) { LANGUAGE_NAMES[item[0]] = item[1]; });

  function gmGet(key, fallback) {
    try {
      if (typeof GM_getValue === "function") return GM_getValue(key, fallback);
      var raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  }

  function gmSet(key, value) {
    try {
      if (typeof GM_setValue === "function") GM_setValue(key, value);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  // 缓存仅保存翻译条件、原文和译文，不把 API Key 写入缓存键。
  function loadTranslationCache() {
    var stored=gmGet(TRANSLATION_CACHE_KEY, []), cache=new Map(), kept=[], chars=0;
    if (!Array.isArray(stored)) return cache;
    stored.slice(-TRANSLATION_CACHE_LIMIT).reverse().some(function (entry) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "string") return;
      var size=entry[0].length+entry[1].length;
      if (size > 12000) return false;
      if (chars+size > TRANSLATION_CACHE_CHAR_LIMIT) return true;
      kept.push(entry); chars+=size;
      return false;
    });
    kept.reverse().forEach(function (entry) { cache.set(entry[0],entry[1]); });
    return cache;
  }

  function clamp(value, min, max) {
    value = Number(value);
    return Math.max(min, Math.min(max, isFinite(value) ? value : min));
  }

  function isOneOf(value, choices, fallback) {
    return choices.indexOf(value) >= 0 ? value : fallback;
  }

  function normalizeHost(value) {
    return String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  }

  function normalizeHostList(value) {
    var result=[];
    if (!Array.isArray(value)) return result;
    value.forEach(function (item) {
      var hostName=normalizeHost(item);
      if (hostName && result.indexOf(hostName) < 0 && result.length < 100) result.push(hostName);
    });
    return result;
  }

  // 修复格式错误或写入不完整的配置，避免单项异常导致整个脚本无法运行。
  function normalizeConfig(value) {
    var source = value && typeof value === "object" ? value : {};
    return {
      schemaVersion: 2,
      service: isOneOf(source.service, ["microsoft", "deepseek", "openai", "custom"], DEFAULT_CONFIG.service),
      endpoint: String(source.endpoint || DEFAULT_CONFIG.endpoint),
      apiKey: String(source.apiKey || ""),
      model: String(source.model || DEFAULT_CONFIG.model),
      targetLanguage: normalizeLanguage(source.targetLanguage || DEFAULT_CONFIG.targetLanguage),
      mode: isOneOf(source.mode, ["bilingual", "translation"], DEFAULT_CONFIG.mode),
      replacementUpgradeApplied: source.replacementUpgradeApplied === true,
      translationStyle: isOneOf(source.translationStyle, ["annotation", "minimal"], DEFAULT_CONFIG.translationStyle),
      batchSize: clamp(source.batchSize == null ? DEFAULT_CONFIG.batchSize : source.batchSize, 1, 10),
      concurrency: clamp(source.concurrency == null ? DEFAULT_CONFIG.concurrency : source.concurrency, 1, 4),
      buttonSide: isOneOf(source.buttonSide, ["left", "right"], DEFAULT_CONFIG.buttonSide),
      buttonY: clamp(source.buttonY == null ? DEFAULT_CONFIG.buttonY : source.buttonY, .12, .84),
      autoTranslateHosts: normalizeHostList(source.autoTranslateHosts)
    };
  }

  function migrateConfig() {
    var saved = gmGet(CONFIG_KEY, null);
    if (saved && typeof saved === "object") {
      var upgraded = normalizeConfig(Object.assign({}, DEFAULT_CONFIG, saved));
      if (saved.replacementUpgradeApplied !== true) {
        upgraded.mode = "translation";
        upgraded.replacementUpgradeApplied = true;
      }
      return upgraded;
    }
    var old = gmGet(OLD_CONFIG_KEY, null);
    if (!old || typeof old !== "object") return normalizeConfig(DEFAULT_CONFIG);
    var endpoint = String(old.endpoint || DEFAULT_CONFIG.endpoint);
    var service = old.provider === "microsoft" ? "microsoft" : "custom";
    if (/api\.deepseek\.com/i.test(endpoint)) service = "deepseek";
    else if (/api\.openai\.com/i.test(endpoint)) service = "openai";
    return normalizeConfig(Object.assign({}, DEFAULT_CONFIG, {
      service: service,
      endpoint: endpoint,
      apiKey: String(old.apiKey || ""),
      model: String(old.model || DEFAULT_CONFIG.model),
      targetLanguage: normalizeLanguage(old.targetLanguage || DEFAULT_CONFIG.targetLanguage),
      mode: "translation",
      replacementUpgradeApplied: true,
      batchSize: old.batchSize == null ? DEFAULT_CONFIG.batchSize : clamp(old.batchSize, 1, 10),
      concurrency: old.concurrency == null ? DEFAULT_CONFIG.concurrency : clamp(old.concurrency, 1, 4)
    }));
  }

  function normalizeLanguage(value) {
    var raw = String(value || "").trim();
    var aliases = {
      "简体中文":"zh-Hans", "中文":"zh-Hans", "繁体中文":"zh-Hant", "中文繁体":"zh-Hant",
      "english":"en", "英语":"en", "日本語":"ja", "日语":"ja", "한국어":"ko", "韩语":"ko",
      "français":"fr", "法语":"fr", "deutsch":"de", "德语":"de", "español":"es", "西班牙语":"es",
      "русский":"ru", "俄语":"ru", "português":"pt", "葡萄牙语":"pt", "italiano":"it", "意大利语":"it",
      "tiếng việt":"vi", "越南语":"vi", "ไทย":"th", "泰语":"th", "العربية":"ar", "阿拉伯语":"ar"
    };
    return aliases[raw] || aliases[raw.toLowerCase()] || raw || "zh-Hans";
  }

  var config = migrateConfig();
  gmSet(CONFIG_KEY, config);

  function emptyCounters() { return { total:0, success:0, failed:0, skipped:0 }; }
  function isBusyPhase(phase) { return ["scanning", "translating", "stopping"].indexOf(phase == null ? app.phase : phase) >= 0; }

  // 集中管理运行状态，确保取消或恢复操作后，各模块对当前任务的判断始终一致。
  var app = {
    phase: "idle",
    active: false,
    jobId: 0,
    records: new Map(),
    requests: new Set(),
    cache: loadTranslationCache(),
    retryQueue: new Set(),
    counters: emptyCounters(),
    rescanPending: false,
    roundPending: false,
    deferredCandidates: null,
    mutationScope: null,
    mutationTimer: 0,
    mutationFirstAt: 0,
    observer: null
  };
  var cacheWriteTimer = 0;
  var pendingStart = false;

  function pruneTranslationCache() {
    function characterCount() {
      var total=0;
      app.cache.forEach(function (value,key) { total+=key.length+value.length; });
      return total;
    }
    var chars=characterCount();
    while (app.cache.size > TRANSLATION_CACHE_LIMIT || chars > TRANSLATION_CACHE_CHAR_LIMIT) {
      var oldest=app.cache.keys().next();
      if (oldest.done) break;
      var value=app.cache.get(oldest.value) || "";
      chars-=oldest.value.length+value.length;
      app.cache.delete(oldest.value);
    }
  }

  function scheduleCacheWrite() {
    clearTimeout(cacheWriteTimer);
    cacheWriteTimer=setTimeout(function () {
      cacheWriteTimer=0;
      gmSet(TRANSLATION_CACHE_KEY, Array.from(app.cache.entries()));
    }, 180);
  }

  function putTranslationCache(key,value) {
    if (key.length+value.length > 12000) return;
    if (app.cache.has(key)) app.cache.delete(key);
    app.cache.set(key,value);
    pruneTranslationCache();
    scheduleCacheWrite();
  }

  function saveConfig(next) {
    config = normalizeConfig(Object.assign({}, config, next));
    gmSet(CONFIG_KEY, config);
  }

  // ---------------------------------------------------------------------------
  // 隔离的界面外壳与注入网页的译文样式
  // ---------------------------------------------------------------------------

  function addPageStyle(css) {
    if (typeof GM_addStyle === "function") GM_addStyle(css);
    else {
      var style = document.createElement("style");
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  addPageStyle(`
    .${TRANSLATION_CLASS}{
      display:block!important;font:inherit!important;line-height:1.66!important;
      white-space:pre-wrap!important;overflow-wrap:anywhere!important;color:inherit!important
    }
    .${TRANSLATION_CLASS}[data-rf-style='annotation']{
      margin:.32em 0!important;padding:0 0 0 .65em!important;
      border-left:2px solid #2b9a62!important;background:transparent!important;border-radius:0!important
    }
    .${TRANSLATION_CLASS}[data-rf-style='minimal']{
      margin:.2em 0!important;padding:0!important;color:inherit!important;opacity:.88!important
    }
    .${TRANSLATION_CLASS}[data-rf-interactive='1']{
      display:inline!important;margin-left:.32em!important;padding:0!important;
      border:0!important;background:transparent!important;border-radius:0!important;
      line-height:inherit!important;white-space:normal!important;opacity:.86!important
    }
    a:hover .${INTERACTIVE_SEGMENT_CLASS},a:focus-visible .${INTERACTIVE_SEGMENT_CLASS},
    a:hover .${TRANSLATION_CLASS}[data-rf-interactive='1'],a:focus-visible .${TRANSLATION_CLASS}[data-rf-interactive='1']{
      text-decoration-line:underline!important;text-decoration-thickness:from-font!important;
      text-underline-offset:.12em!important
    }
    .${TRANSLATION_CLASS}[data-rf-error='1']{
      margin:.35em 0!important;padding:.25em 0 .25em .65em!important;
      border-left:2px solid #c94c43!important;background:transparent!important;
      color:#9b3029!important;border-radius:0!important
    }
    .rf-via-retry{
      margin-left:.65em!important;padding:.25em .65em!important;
      border:1px solid #c94c43!important;border-radius:999px!important;
      background:transparent!important;color:inherit!important;font:inherit!important
    }
    @media(prefers-color-scheme:dark){
      .${TRANSLATION_CLASS}[data-rf-style='annotation']{border-left-color:#55c58a!important}
      .${TRANSLATION_CLASS}[data-rf-error='1']{color:#ffaaa4!important}
    }
  `);

  var languageOptions = LANGUAGES.map(function (item) { return "<option value='" + item[0] + "'>" + item[1] + "</option>"; }).join("") + "<option value='custom'>其他语言代码…</option>";
  function lineIcon(body, extraClass) { return '<svg class="rf-icon' + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>'; }
  var UI_ICONS = {
    frog:'<svg class="frog-mark" viewBox="0 0 48 48" aria-hidden="true"><circle class="frog-face" cx="15" cy="15" r="7"/><circle class="frog-face" cx="33" cy="15" r="7"/><ellipse class="frog-face" cx="24" cy="28" rx="18" ry="14"/><circle class="frog-eye" cx="15" cy="15" r="2.5"/><circle class="frog-eye" cx="33" cy="15" r="2.5"/><circle class="frog-eye" cx="21" cy="25" r="1.2"/><circle class="frog-eye" cx="27" cy="25" r="1.2"/><path class="frog-smile" d="M15 29c2.6 4 6 5.5 9 5.5s6.4-1.5 9-5.5"/></svg>',
    translate:lineIcon('<path d="M4 7h10M9 4v3m-3 4c2.8-.8 5-2.4 6.4-4.6M7.2 8.5c1 2.1 2.7 3.8 5 5"/><path d="M14 20l3.2-8 3.2 8m-5.3-3h4.2"/>'),
    stop:lineIcon('<rect x="7" y="7" width="10" height="10" rx="2.5"/>'),
    mode:lineIcon('<rect x="4" y="5" width="11" height="13" rx="3"/><path d="M9 9h2m-2 4h3m5-5h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-6"/>'),
    restore:lineIcon('<path d="M5 8v5h5"/><path d="M6.5 12A7 7 0 1 1 8 18"/>'),
    settings:lineIcon('<path d="M4 7h10m4 0h2M4 17h3m4 0h9"/><circle cx="16" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
    close:lineIcon('<path d="M7 7l10 10M17 7 7 17"/>'),
    eye:lineIcon('<path d="M3 12s3.4-5 9-5 9 5 9 5-3.4 5-9 5-9-5-9-5Z"/><circle cx="12" cy="12" r="2.5"/>'),
    eyeOff:lineIcon('<path d="M4 4l16 16M10.5 7.2c.5-.1 1-.2 1.5-.2 5.6 0 9 5 9 5a15 15 0 0 1-2.2 2.7M6.2 6.3C4.1 7.7 3 9.6 3 12c0 0 3.4 5 9 5 1.1 0 2.1-.2 3-.5"/>'),
    clear:lineIcon('<path d="M5 15.5 11.5 9a2 2 0 0 1 2.8 0l4.7 4.7-5.3 5.3H9.5L5 15.5Z"/><path d="m9 12 5 5"/>'),
    check:lineIcon('<path d="m6 12 4 4 8-9"/>','status-icon'),
    warning:lineIcon('<path d="M12 6v7m0 4v.1"/>','status-icon')
  };

  root.innerHTML = `
    <style>
      :host{all:initial;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;pointer-events:none!important;--primary:#4d6656;--on-primary:#fff;--primary-container:#d4eadb;--on-primary-container:#183326;--surface:#fafcf8;--surface-container:#eff3ed;--surface-high:#e7ede7;--outline:#c6d0c7;--ink:#1a211c;--muted:#59645d;--focus-ring:rgba(77,102,86,.15);--leaf:var(--primary);--leaf2:#70a989;font-family:system-ui,"Noto Sans SC","MiSans","Microsoft YaHei",sans-serif;color-scheme:light dark}
      *{box-sizing:border-box}button,input,select{font:inherit}.rf-ui{color:var(--ink);pointer-events:none}.rf-icon{display:block;width:20px;height:20px;flex:0 0 20px}.rf-icon path,.rf-icon rect,.rf-icon circle{vector-effect:non-scaling-stroke}#frog,#frog-actions,#settings{pointer-events:auto}
      /* 悬浮球及其任务结束状态徽标。 */
      #frog-dock{position:fixed;z-index:2147483646;width:70px;height:70px;overflow:visible;pointer-events:none}#frog-dock.side-right{right:0;left:auto}#frog-dock.side-left{left:0;right:auto}
      #frog{position:absolute;top:10px;width:50px;height:50px;border:1px solid rgba(255,255,255,.32);border-radius:50%;background:linear-gradient(150deg,rgba(255,255,255,.16),transparent 44%),linear-gradient(145deg,var(--leaf2),var(--primary));color:var(--on-primary);box-shadow:0 8px 24px rgba(28,68,44,.26);font-size:25px;line-height:50px;padding:0;touch-action:none;user-select:none;-webkit-tap-highlight-color:transparent;transition:transform .34s cubic-bezier(.2,.8,.2,1),opacity .26s ease-out,box-shadow .22s ease;will-change:transform,opacity}#frog-dock.side-right #frog{right:10px;left:auto}#frog-dock.side-left #frog{left:10px;right:auto}
      #frog-icon{display:flex;width:100%;height:100%;align-items:center;justify-content:center;transform:translateX(0) scale(1);transform-origin:center;transition:transform .32s cubic-bezier(.22,1,.36,1);pointer-events:none}.frog-mark{display:block;width:37px;height:37px}.frog-face{fill:var(--primary-container)}.frog-eye{fill:var(--on-primary-container)}.frog-smile{fill:none;stroke:#d87969;stroke-width:3;stroke-linecap:round}#frog-loader{position:absolute;right:-3px;bottom:-3px;width:18px;height:18px;border:2px solid rgba(255,255,255,.92);border-radius:50%;background:#2ca76a;box-shadow:0 2px 7px rgba(14,57,35,.28);opacity:0;transform:scale(.72);transition:opacity .16s ease,transform .2s cubic-bezier(.22,1,.36,1);pointer-events:none}#frog.busy #frog-loader{opacity:1;transform:scale(1)}#frog.busy #frog-loader:after{content:"";position:absolute;inset:2px;border:2px solid rgba(255,255,255,.38);border-top-color:#fff;border-radius:50%;animation:rf-spin .72s linear infinite}#frog-status{position:absolute;inset:-3px;display:flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;opacity:0;transform:translate(0,0) scale(1);box-shadow:0 7px 22px rgba(20,80,49,.28);transition:opacity .12s ease,transform .48s cubic-bezier(.22,1,.36,1),box-shadow .35s ease;pointer-events:none}#frog-status .status-icon{width:30px;height:30px;stroke-width:2.5}#frog-status.show{opacity:1;transform:translate(0,0) scale(1);transition:transform .48s cubic-bezier(.22,1,.36,1),box-shadow .35s ease}#frog-status.ok{background:linear-gradient(145deg,#49c986,#197b4b)}#frog-status.warn{background:linear-gradient(145deg,#efad55,#c66a26)}#frog-status.show.minimized{transform:translate(17px,17px) scale(.34);box-shadow:0 5px 16px rgba(20,70,43,.32)}#frog:active{box-shadow:0 3px 12px rgba(20,80,49,.3)}#frog.tucked{opacity:.46;box-shadow:none}#frog-dock.side-right #frog.tucked{transform:translateX(35px)}#frog-dock.side-left #frog.tucked{transform:translateX(-35px)}#frog-dock.side-right #frog.tucked #frog-icon{transform:translateX(-12px) scale(.72)}#frog-dock.side-left #frog.tucked #frog-icon{transform:translateX(12px) scale(.72)}#frog-dock.side-right #frog.tucked.busy #frog-loader{transform:translateX(-30px) scale(1)}#frog-dock.side-right #frog.tucked #frog-status.show.minimized{transform:translate(-15px,17px) scale(.34)}@keyframes rf-spin{to{transform:rotate(360deg)}}
      /* 长按悬浮球弹出的紧凑操作面板。 */
      #frog-actions{position:absolute;bottom:68px;width:206px;padding:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;border:1px solid rgba(255,255,255,.72);border-radius:26px;background:rgba(250,252,248,.94);box-shadow:0 18px 48px rgba(24,48,33,.18);backdrop-filter:blur(18px);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(14px) scale(.92);transition:opacity .2s ease,transform .34s cubic-bezier(.2,.8,.2,1),visibility 0s linear .34s}#frog-dock.side-right #frog-actions{right:8px;transform-origin:bottom right}#frog-dock.side-left #frog-actions{left:8px;transform-origin:bottom left}#frog-actions.below{bottom:auto;top:68px;transform:translateY(-14px) scale(.92)}#frog-actions.open{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0) scale(1);transition:opacity .18s ease,transform .36s cubic-bezier(.2,.8,.2,1),visibility 0s}#frog-actions button{height:50px;border:0;border-radius:18px;background:var(--surface-container);color:var(--ink);display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;font-weight:720;letter-spacing:.01em;opacity:0;transform:translateY(9px) scale(.96);transition:background .18s ease,opacity .18s ease,transform .3s cubic-bezier(.2,.8,.2,1);-webkit-tap-highlight-color:transparent}#frog-actions button:first-child{background:var(--primary-container);color:var(--on-primary-container)}#frog-actions button:active{background:var(--surface-high);transform:scale(.96)}.action-icon{width:30px;height:30px;flex:0 0 30px;display:grid;place-items:center;border-radius:50%;background:rgba(255,255,255,.64);font-size:16px;font-weight:800}.action-label{white-space:nowrap}#frog-actions.open button{opacity:1;transform:translateY(0) scale(1)}#frog-actions.open button:nth-child(2){transition-delay:.04s}#frog-actions.open button:nth-child(3){transition-delay:.08s}#frog-actions.open button:nth-child(4){transition-delay:.12s}
      /* 底部设置面板。 */
      #backdrop{position:fixed;z-index:2147483646;inset:0;background:rgba(22,29,24,.38);backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .24s ease}#backdrop.open{opacity:1;pointer-events:auto}
      #settings{position:fixed;z-index:2147483647;left:8px;right:8px;bottom:0;max-height:min(88vh,760px);overflow:auto;overscroll-behavior:contain;background:var(--surface);border:1px solid rgba(255,255,255,.7);border-radius:32px 32px 0 0;padding:10px 14px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -20px 60px rgba(20,35,26,.22);transform:translateY(105%);transition:transform .38s cubic-bezier(.2,.8,.2,1)}#settings.open{transform:translateY(0)}
      .grab{width:34px;height:4px;border-radius:99px;background:var(--outline);margin:2px auto 12px}.head{display:flex;justify-content:space-between;align-items:center;min-height:72px;padding:4px 4px 8px 8px}.head-copy{min-width:0}.title{font-size:21px;font-weight:780;letter-spacing:-.025em}.sub{font-size:12px;color:var(--muted);margin-top:3px}.hero-art{position:relative;width:82px;height:58px;flex:0 0 82px;margin-left:auto;margin-right:8px;overflow:hidden;border-radius:22px;background:linear-gradient(155deg,var(--primary-container),var(--surface-high))}.hero-sun{position:absolute;width:17px;height:17px;border-radius:50%;right:12px;top:9px;background:#f3c982}.hero-hill{position:absolute;width:78px;height:42px;border-radius:50%;left:-18px;bottom:-23px;background:var(--leaf2);opacity:.6}.hero-pond{position:absolute;width:48px;height:19px;border-radius:50%;right:-8px;bottom:3px;background:rgba(115,169,183,.48)}.hero-frog{position:absolute;left:29px;bottom:10px;width:25px;height:21px;border-radius:48% 48% 44% 44%;background:var(--primary)}.hero-frog:before,.hero-frog:after{content:"";position:absolute;top:-5px;width:9px;height:9px;border-radius:50%;background:var(--primary)}.hero-frog:before{left:2px}.hero-frog:after{right:2px}.icon-btn{border:0;background:var(--surface-container);border-radius:50%;width:42px;height:42px;color:var(--ink);display:flex;align-items:center;justify-content:center}.icon-btn .rf-icon{width:21px;height:21px}
      .section{margin-top:12px;padding:16px;background:var(--surface-container);border-radius:26px}.section:first-of-type{margin-top:4px}.section-title{font-size:13px;font-weight:780;color:var(--primary);letter-spacing:.025em;margin-bottom:10px}label{display:block;font-size:12px;font-weight:680;color:var(--muted);margin:12px 2px 6px}input,select{width:100%;min-height:50px;border:1px solid transparent;border-radius:18px;background:var(--surface);color:var(--ink);padding:10px 14px;font-size:15px;outline:none;transition:border-color .18s ease,box-shadow .18s ease,background .18s ease}input:focus,select:focus{border-color:var(--primary);background:var(--surface);box-shadow:0 0 0 4px var(--focus-ring)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.site-auto{display:flex;align-items:center;gap:12px;margin:14px 0 0;padding:12px 14px;background:var(--surface);border-radius:20px;cursor:pointer}.site-auto-copy{flex:1;min-width:0}.site-auto-title{font-size:14px;font-weight:760;color:var(--ink)}.site-auto-host{margin-top:3px;font-size:11px;font-weight:560;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.site-auto input{position:absolute;opacity:0;width:1px;min-height:1px;padding:0}.site-auto-switch{position:relative;width:48px;height:28px;flex:0 0 48px;border-radius:999px;background:var(--outline);transition:background .2s ease}.site-auto-switch:after{content:"";position:absolute;left:4px;top:4px;width:20px;height:20px;border-radius:50%;background:var(--surface);box-shadow:0 2px 5px rgba(20,35,26,.22);transition:transform .24s cubic-bezier(.2,.8,.2,1),background .2s ease}.site-auto input:checked+.site-auto-switch{background:var(--primary)}.site-auto input:checked+.site-auto-switch:after{transform:translateX(20px);background:var(--on-primary)}.site-auto input:focus-visible+.site-auto-switch{box-shadow:0 0 0 4px var(--focus-ring)}.key-row{display:flex;gap:8px}.key-row input{flex:1;min-width:0}.key-row button{width:48px;flex:0 0 48px;border:0;border-radius:17px;background:var(--surface-high);color:var(--ink);display:flex;align-items:center;justify-content:center}.key-row button .rf-icon{width:19px;height:19px}.preview{font-size:11px;color:var(--muted);word-break:break-all;margin:8px 2px 0}.hint{font-size:12px;color:var(--muted);line-height:1.6;margin-top:10px}.settings-actions{display:grid;grid-template-columns:1.2fr 1fr;gap:10px;margin:14px 2px 2px}.settings-actions button{min-height:50px;border:0;border-radius:999px;font-weight:760;letter-spacing:.02em}.save{background:var(--primary);color:var(--on-primary);box-shadow:0 8px 20px rgba(28,68,44,.18)}.test{background:var(--primary-container);color:var(--on-primary-container)}#settings-status{font-size:12px;min-height:18px;margin:10px 4px 0;color:var(--muted)}
      @media(prefers-color-scheme:dark){#frog-actions{background:rgba(29,34,30,.95);border-color:rgba(255,255,255,.08)}.action-icon{background:rgba(255,255,255,.1)}#settings{border-color:rgba(255,255,255,.08)}input,select{border-color:transparent}}
      @media(prefers-reduced-motion:reduce){*{transition:none!important}#frog-loader:after{animation:none!important}}
    </style>
    <div class="rf-ui">
      <div id="frog-dock"><button id="frog" aria-label="打开 Read Frog"><span id="frog-icon">${UI_ICONS.frog}</span><span id="frog-loader" aria-hidden="true"></span><span id="frog-status" aria-hidden="true"></span></button><div id="frog-actions" aria-label="Read Frog 功能"><button id="action-translate"><span class="action-icon">${UI_ICONS.translate}</span><span class="action-label">翻译</span></button><button id="action-mode"><span class="action-icon">${UI_ICONS.mode}</span><span class="action-label">译文</span></button><button id="action-restore"><span class="action-icon">${UI_ICONS.restore}</span><span class="action-label">恢复</span></button><button id="action-settings"><span class="action-icon">${UI_ICONS.settings}</span><span class="action-label">设置</span></button></div></div>
      <div id="backdrop"></div>
      <section id="settings" aria-label="Read Frog 设置">
        <div class="grab"></div><div class="head"><div class="head-copy"><div class="title">Read Frog Lite</div><div class="sub">安静、轻盈地阅读 · ${VERSION}</div></div><div class="hero-art" aria-hidden="true"><span class="hero-sun"></span><span class="hero-hill"></span><span class="hero-pond"></span><span class="hero-frog"></span></div><button id="settings-close" class="icon-btn" aria-label="关闭设置">${UI_ICONS.close}</button></div>
        <div class="section"><div class="section-title">阅读偏好</div>
          <label for="language">目标语言</label><select id="language">${languageOptions}</select><input id="custom-language" placeholder="语言名或代码，例如 nl" style="display:none;margin-top:7px">
          <div class="grid"><div><label for="mode">显示模式</label><select id="mode"><option value="bilingual">双语对照</option><option value="translation">直接替换原文</option></select></div><div><label for="translation-style">双语译文样式</label><select id="translation-style"><option value="annotation">细线标记</option><option value="minimal">无样式</option></select></div></div>
          <label class="site-auto" for="auto-site"><span class="site-auto-copy"><span class="site-auto-title">总是自动翻译此网站</span><span id="auto-site-host" class="site-auto-host"></span></span><input id="auto-site" type="checkbox"><span class="site-auto-switch" aria-hidden="true"></span></label>
        </div>
        <div class="section"><div class="section-title">翻译服务</div>
          <label for="service">服务</label><select id="service"><option value="microsoft">Microsoft 免费翻译</option><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="custom">自定义兼容接口</option></select>
          <div id="ai-fields"><label for="api-key">API Key</label><div class="key-row"><input id="api-key" type="password" autocomplete="off" placeholder="输入 API Key"><button id="key-toggle" type="button" title="显示或隐藏" aria-label="显示 API Key">${UI_ICONS.eye}</button><button id="key-clear" type="button" title="清空" aria-label="清空 API Key">${UI_ICONS.clear}</button></div>
            <label for="model">模型</label><input id="model" list="model-list" placeholder="模型名称"><datalist id="model-list"></datalist>
            <div id="custom-endpoint-wrap"><label for="endpoint">兼容接口地址</label><input id="endpoint" inputmode="url" placeholder="https://.../v1"></div><div class="preview">实际请求：<span id="endpoint-preview"></span></div>
          </div><div class="hint">Microsoft 无需 Key。API Key 只保存在 Via 脚本存储中；网页正文会发送到所选翻译服务。</div>
        </div>
        <div class="section"><div class="section-title">性能</div><div class="grid"><div><label for="batch">每批段落</label><input id="batch" type="number" min="1" max="10"></div><div><label for="concurrency">并发请求</label><input id="concurrency" type="number" min="1" max="4"></div></div></div>
        <div class="settings-actions"><button id="save" class="save">保存设置</button><button id="test" class="test">测试服务</button></div><div id="settings-status"></div>
      </section>
    </div>`;
  // 完整界面接管最早显示的同一个按钮，避免重新绘制时出现两个青蛙或闪白。
  var fullFrog = root.querySelector("#frog");
  fullFrog.parentNode.replaceChild(shellFrog, fullFrog);

  function $(id) { return root.querySelector("#" + id); }
  var frogDock = $("frog-dock");
  var frog = $("frog");
  var frogStatus = $("frog-status");
  var frogActions = $("frog-actions");
  var settings = $("settings");
  var backdrop = $("backdrop");
  var settingsStatus = $("settings-status");
  var tuckTimer = 0;
  var statusMorphTimer = 0;
  var statusTuckTimer = 0;
  var longPressTimer = 0;
  var frogSummoned = false;
  var readingTouch = false;
  var readingTouchMoved = false;
  var userScrollUntil = 0;
  var lastTouchAt = 0;

  // 根据网页主题色生成克制的 Material You 色板；没有主题色时使用默认绿色，
  // 保持青蛙工具的视觉辨识度。
  function readThemeRgb(value) {
    if (!value) return null;
    var probe = document.createElement("span");
    probe.style.position = "fixed"; probe.style.visibility = "hidden"; probe.style.color = value;
    document.documentElement.appendChild(probe);
    var match = getComputedStyle(probe).color.match(/[\d.]+/g); probe.remove();
    return match && match.length >= 3 ? [Number(match[0]), Number(match[1]), Number(match[2])] : null;
  }

  function rgbHue(rgb) {
    var r=rgb[0]/255, g=rgb[1]/255, b=rgb[2]/255, max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min, h=150;
    if (d > .08) {
      if (max === r) h=60*((g-b)/d%6);
      else if (max === g) h=60*((b-r)/d+2);
      else h=60*((r-g)/d+4);
      if (h < 0) h += 360;
    }
    return Math.round(h);
  }

  function tone(h,s,l,a) { return (a == null ? "hsl(" : "hsla(") + h + "," + s + "%," + l + "%" + (a == null ? ")" : "," + a + ")"); }

  function applyDynamicPalette() {
    var meta=document.querySelector('meta[name="theme-color"]');
    var rgb=readThemeRgb(meta && meta.getAttribute("content")) || [78,108,89];
    var h=rgbHue(rgb), dark=window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var palette = dark ? {
      "--primary":tone(h,34,76), "--on-primary":tone(h,34,17), "--primary-container":tone(h,24,28), "--on-primary-container":tone(h,34,88),
      "--surface":tone(h,10,10), "--surface-container":tone(h,11,15), "--surface-high":tone(h,12,20), "--outline":tone(h,10,40),
      "--ink":tone(h,12,91), "--muted":tone(h,9,72), "--leaf2":tone(h,30,61), "--focus-ring":tone(h,38,72,.2)
    } : {
      "--primary":tone(h,31,39), "--on-primary":"#fff", "--primary-container":tone(h,32,89), "--on-primary-container":tone(h,30,18),
      "--surface":tone(h,16,98), "--surface-container":tone(h,16,95), "--surface-high":tone(h,15,92), "--outline":tone(h,11,79),
      "--ink":tone(h,12,14), "--muted":tone(h,8,39), "--leaf2":tone(h,30,62), "--focus-ring":tone(h,34,42,.15)
    };
    Object.keys(palette).forEach(function (name) { host.style.setProperty(name, palette[name]); });
  }

  function languageLabel(code) { return LANGUAGE_NAMES[code] || code; }

  function currentHost() { return normalizeHost(location.hostname); }

  function autoTranslateEnabled(cfg) {
    var hostName=currentHost();
    return !!hostName && cfg.autoTranslateHosts.indexOf(hostName) >= 0;
  }

  // ---------------------------------------------------------------------------
  // 设置表单与接口地址标准化
  // ---------------------------------------------------------------------------

  function resolvedEndpoint(cfg) {
    if (cfg.service === "deepseek") return "https://api.deepseek.com/chat/completions";
    if (cfg.service === "openai") return "https://api.openai.com/v1/chat/completions";
    return normalizeChatEndpoint(cfg.endpoint);
  }

  function normalizeChatEndpoint(input) {
    var url = new URL(String(input || "").trim());
    var path = url.pathname.replace(/\/+$/, "");
    if (/\/chat\/completions$/i.test(path)) url.pathname = path;
    if (!path || path === "/") url.pathname = url.hostname.toLowerCase() === "api.deepseek.com" ? "/chat/completions" : "/v1/chat/completions";
    else if (!/\/chat\/completions$/i.test(path)) url.pathname = path + "/chat/completions";
    return url.toString().replace(/\/$/, "");
  }

  function defaultModel(service) {
    if (service === "deepseek") return "deepseek-v4-flash";
    if (service === "openai") return "gpt-4o-mini";
    return config.model || "gpt-4o-mini";
  }

  function updateServiceFields(resetModel) {
    var service = $("service").value;
    $("ai-fields").style.display = service === "microsoft" ? "none" : "block";
    $("custom-endpoint-wrap").style.display = service === "custom" ? "block" : "none";
    var models = service === "deepseek" ? ["deepseek-v4-flash","deepseek-v4-pro"] : service === "openai" ? ["gpt-4o-mini","gpt-4.1-mini"] : [];
    $("model-list").innerHTML = models.map(function (m) { return "<option value='" + m + "'>"; }).join("");
    if (resetModel) $("model").value = defaultModel(service);
    updateEndpointPreview();
  }

  function updateEndpointPreview() {
    var draft = readForm();
    try { $("endpoint-preview").textContent = draft.service === "microsoft" ? "无需配置" : resolvedEndpoint(draft); }
    catch (_) { $("endpoint-preview").textContent = "地址格式不正确"; }
  }

  function setApiKeyVisible(visible) {
    $("api-key").type = visible ? "text" : "password";
    $("key-toggle").innerHTML = visible ? UI_ICONS.eyeOff : UI_ICONS.eye;
    $("key-toggle").setAttribute("aria-label", visible ? "隐藏 API Key" : "显示 API Key");
  }

  function fillForm() {
    $("service").value = config.service;
    var known = !!LANGUAGE_NAMES[config.targetLanguage];
    $("language").value = known ? config.targetLanguage : "custom";
    $("custom-language").value = known ? "" : config.targetLanguage;
    $("custom-language").style.display = known ? "none" : "block";
    $("mode").value = config.mode;
    $("translation-style").value = config.translationStyle;
    $("api-key").value = config.apiKey;
    $("model").value = config.model;
    $("endpoint").value = config.endpoint;
    $("batch").value = config.batchSize;
    $("concurrency").value = config.concurrency;
    $("auto-site").checked = autoTranslateEnabled(config);
    $("auto-site-host").textContent = currentHost() || "当前页面不可设置";
    $("auto-site").disabled = !currentHost();
    setApiKeyVisible(false);
    updateServiceFields(false);
  }

  function readForm() {
    var language = $("language").value === "custom" ? $("custom-language").value.trim() : $("language").value;
    var autoHosts=config.autoTranslateHosts.slice();
    var hostName=currentHost(), hostIndex=autoHosts.indexOf(hostName);
    if (hostName && $("auto-site").checked && hostIndex < 0) autoHosts.push(hostName);
    if (hostName && !$("auto-site").checked && hostIndex >= 0) autoHosts.splice(hostIndex,1);
    var next = {
      service: $("service").value,
      endpoint: $("endpoint").value.trim(),
      apiKey: $("api-key").value.trim(),
      model: $("model").value.trim(),
      targetLanguage: normalizeLanguage(language),
      mode: $("mode").value,
      translationStyle: $("translation-style").value,
      batchSize: clamp($("batch").value, 1, 10),
      concurrency: clamp($("concurrency").value, 1, 4),
      autoTranslateHosts: autoHosts
    };
    return Object.assign({}, config, next);
  }

  function validateConfig(cfg) {
    if (!cfg.targetLanguage) throw new Error("请选择或填写目标语言");
    if (cfg.service === "microsoft") return;
    if (!cfg.apiKey) throw new Error("请填写 API Key");
    if (!cfg.model) throw new Error("请填写模型名称");
    var endpoint;
    var url;
    try { endpoint = resolvedEndpoint(cfg); url = new URL(endpoint); }
    catch (_) { throw new Error("接口地址格式不正确"); }
    var local = ["localhost","127.0.0.1","10.0.2.2"].indexOf(url.hostname) >= 0;
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("接口必须使用 HTTPS，本机地址除外");
  }

  // ---------------------------------------------------------------------------
  // 统一请求层与翻译服务适配
  // ---------------------------------------------------------------------------

  function httpError(status, body, retryAfter) {
    var messages = {
      401:"API Key 无效或已过期", 403:"接口拒绝访问，请检查权限或地区限制",
      404:"接口路径不存在，请检查服务和地址", 429:"请求过于频繁或额度不足，请稍后重试"
    };
    var message = messages[status] || (status >= 500 ? "服务暂时不可用，请稍后重试" : "接口返回 HTTP " + status);
    var error = new Error(message + (body ? " · " + String(body).slice(0, 120) : ""));
    error.kind = "http"; error.status = status;
    var retryAfterMs = parseRetryAfter(retryAfter);
    if (retryAfterMs != null) error.retryAfterMs = retryAfterMs;
    return error;
  }

  function requestError(message, kind) {
    var error = new Error(message);
    error.kind = kind;
    return error;
  }

  function parseRetryAfter(value) {
    if (value == null) return null;
    var text = String(value).trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) return Math.min(60000, Number(text) * 1000);
    var date = Date.parse(text);
    if (!isNaN(date)) return Math.max(0, Math.min(60000, date - Date.now()));
    return null;
  }

  function requestRaw(url, headers, body, jobId) {
    var handle = null;
    var settled = false;
    var timeoutTimer = 0;
    var promise = new Promise(function (resolve, reject) {
      function finish(fn, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        if (handle) app.requests.delete(handle);
        fn(value);
      }
      function done(status, text, retryAfter) {
        status = Number(status || 0);
        if (status < 200 || status >= 300) return finish(reject, httpError(status, text, retryAfter));
        finish(resolve, String(text || ""));
      }
      if (typeof GM_xmlhttpRequest === "function") {
        try {
          handle = GM_xmlhttpRequest({
            method:"POST", url:url, headers:headers, data:body, timeout:REQUEST_TIMEOUT,
            onload:function (r) { done(r.status, r.responseText, headerValue(r.responseHeaders, "retry-after")); },
            onerror:function (r) {
              if (Number(r && r.status) > 0) return done(r.status, r.responseText, headerValue(r.responseHeaders, "retry-after"));
              finish(reject, requestError("无法连接服务。请检查网络、域名、证书或 Android WebView", "network"));
            },
            ontimeout:function () { finish(reject, requestError("请求超时，请稍后重试或降低并发数", "timeout")); },
            onabort:function () { finish(reject, requestError("请求已取消", "abort")); }
          });
          if (handle && typeof handle.abort === "function") app.requests.add(handle);
          if (jobId != null && jobId !== app.jobId && handle && handle.abort) handle.abort();
        } catch (error) { finish(reject, error); }
      } else {
        var controller = typeof AbortController === "function" ? new AbortController() : null;
        handle = controller;
        if (handle) app.requests.add(handle);
        timeoutTimer = setTimeout(function () {
          finish(reject, requestError("请求超时，请稍后重试或降低并发数", "timeout"));
          if (controller) controller.abort();
        }, REQUEST_TIMEOUT);
        fetch(url, { method:"POST", headers:headers, body:body, signal:controller ? controller.signal : undefined })
          .then(function (r) {
            var retryAfter = null;
            try { retryAfter = r.headers && r.headers.get ? r.headers.get("retry-after") : null; } catch (_) {}
            return r.text().then(function (text) { done(r.status, text, retryAfter); });
          })
          .catch(function (original) {
            var aborted = original && original.name === "AbortError";
            finish(reject, requestError(aborted ? "请求已取消" : "网络请求失败，页面可能受到跨域限制", aborted ? "abort" : "network"));
          });
      }
    });
    return promise;
  }

  function headerValue(headers, name) {
    if (!headers) return null;
    if (typeof headers === "string") {
      var match = new RegExp("(?:^|\\n)" + name + "\\s*:\\s*([^\\n]+)", "i").exec(headers);
      return match ? match[1].trim() : null;
    }
    if (typeof headers.get === "function") return headers.get(name);
    var lower = name.toLowerCase();
    for (var key in headers) if (String(key).toLowerCase() === lower) return headers[key];
    return null;
  }

  var RETRY_STATUSES = [429, 500, 502, 503, 504];
  var MAX_RETRIES = 3;
  var RETRY_BASE_DELAY = 500;
  var RETRY_MAX_DELAY = 4000;

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  // 网络类错误做指数退避 + 抖动重试；有 Retry-After 时优先尊重它。绝不无限重试。
  async function requestWithRetry(url, headers, body, jobId) {
    var attempt = 0;
    for (;;) {
      try {
        return await requestRaw(url, headers, body, jobId);
      } catch (error) {
        if (jobId != null && jobId !== app.jobId) throw error;
        var retriable = error && (error.kind === "timeout" || error.kind === "network" ||
          (error.kind === "http" && RETRY_STATUSES.indexOf(error.status) >= 0));
        if (!retriable || attempt >= MAX_RETRIES) throw error;
        var delay = Math.min(RETRY_MAX_DELAY, RETRY_BASE_DELAY * Math.pow(2, attempt));
        delay = Math.round(delay * (0.75 + Math.random() * 0.5));
        if (error.retryAfterMs != null) delay = Math.max(delay, Math.min(RETRY_MAX_DELAY, error.retryAfterMs));
        attempt++;
        await sleep(delay);
        if (jobId != null && jobId !== app.jobId) throw requestError("请求已取消", "abort");
      }
    }
  }

  function escapeHtml(text) { return String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function decodeHtml(text) { var area = document.createElement("textarea"); area.innerHTML = text; return area.value; }

  async function microsoftTranslate(texts, cfg, jobId) {
    var to = normalizeLanguage(cfg.targetLanguage);
    if (!/^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(to)) throw new Error("Microsoft 无法识别目标语言，请使用语言代码");
    var url = "https://edge.microsoft.com/translate/translatetext?from=&to=" + encodeURIComponent(to) + "&isEnterpriseClient=false";
    var raw = await requestWithRetry(url, { "Content-Type":"application/json" }, JSON.stringify(texts.map(escapeHtml)), jobId);
    var result;
    try { result = JSON.parse(raw); } catch (_) { var parseError = new Error("Microsoft 返回了无法解析的数据"); parseError.kind = "format"; throw parseError; }
    if (!Array.isArray(result) || result.length !== texts.length) { var shapeError = new Error("Microsoft 返回的段落数量不一致"); shapeError.kind = "format"; throw shapeError; }
    return result.map(function (item) {
      var value = item && item.translations && item.translations[0] && item.translations[0].text;
      if (typeof value !== "string") { var error = new Error("Microsoft 响应缺少译文"); error.kind = "format"; throw error; }
      return decodeHtml(value);
    });
  }

  function translationMessages(texts, cfg) {
    var target = languageLabel(cfg.targetLanguage);
    // system 消息必须完全由脚本自己构造：页面可控内容（title 等）不能进入协议层，
    // 否则网页可以借 title 改写"只返回 JSON 数组"这类约束（提示注入）。
    // user 消息保持纯 JSON 数组，协议简单且解析稳定。
    var system = "You are a professional " + target + " translator. Translate naturally and accurately. If a string already contains " + target + " text, keep that part unchanged and translate only the remaining source-language content. Preserve meaning, tone, names, code, URLs and numbers. Return only valid JSON: an array of exactly " + texts.length + " translated strings in the same order. No Markdown or explanations.";
    return [{ role:"system", content:system }, { role:"user", content:JSON.stringify(texts) }];
  }

  async function aiTranslate(texts, cfg, jobId) {
    var messages = translationMessages(texts, cfg);
    var body = JSON.stringify({ model:cfg.model, messages:messages, temperature:0.2, stream:false });
    var raw = await requestWithRetry(resolvedEndpoint(cfg), { "Content-Type":"application/json", "Authorization":"Bearer " + cfg.apiKey }, body, jobId);
    var content;
    try {
      var json = JSON.parse(raw);
      content = json && json.choices && json.choices[0] && (json.choices[0].message ? json.choices[0].message.content : json.choices[0].text);
      if (typeof content !== "string") throw new Error("missing content");
    } catch (_) { var responseError = new Error("接口响应格式不兼容 Chat Completions"); responseError.kind = "format"; throw responseError; }
    try {
      var cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      var first = cleaned.indexOf("["); var last = cleaned.lastIndexOf("]");
      if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
      var parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed) || parsed.length !== texts.length || parsed.some(function (x) { return typeof x !== "string"; })) throw new Error("shape");
      return parsed;
    } catch (_) { var outputError = new Error("模型没有按要求返回对应数量的译文"); outputError.kind = "format"; throw outputError; }
  }

  // 语言判定改为"白名单"：只有能确认文本属于目标语言字符体系时才跳过。
  // 之前用 `!(hasHan||hasLatin||…)` 判断"不含任何已知体系 → 已是目标语言"，
  // 会让希伯来文、希腊文、天城文等未列出的体系被整体跳过（漏译），因此不再做这种反向推断。
  // need：目标语言必须出现的字符体系；allow：可与目标语言共存的体系（如日文里的汉字）。
  var TARGET_SCRIPT_RANGES = {
    zh: { need:["han"], allow:["han"] },
    ja: { need:["kana"], allow:["kana","han"] },
    ko: { need:["hangul"], allow:["hangul","han"] },
    ar: { need:["arabic"], allow:["arabic"] },
    fa: { need:["arabic"], allow:["arabic"] },
    ur: { need:["arabic"], allow:["arabic"] },
    he: { need:["hebrew"], allow:["hebrew"] },
    iw: { need:["hebrew"], allow:["hebrew"] },
    ru: { need:["cyrillic"], allow:["cyrillic"] },
    uk: { need:["cyrillic"], allow:["cyrillic"] },
    bg: { need:["cyrillic"], allow:["cyrillic"] },
    sr: { need:["cyrillic"], allow:["cyrillic"] },
    th: { need:["thai"], allow:["thai"] },
    el: { need:["greek"], allow:["greek"] },
    hi: { need:["devanagari"], allow:["devanagari"] },
    mr: { need:["devanagari"], allow:["devanagari"] },
    ne: { need:["devanagari"], allow:["devanagari"] }
  };
  var ALL_SCRIPTS = ["latin","han","kana","hangul","cyrillic","arabic","hebrew","greek","devanagari","thai"];
  // 拉丁字母语言的常用虚词：只有虚词占比很高时才认为"已经是目标语言"，避免把英语误判成法语等。
  var LATIN_STOPWORDS = {
    en: ["the","and","of","to","in","is","that","for","it","with","as","was","on","are","this","by","be","from","or","an","at","not"],
    fr: ["le","la","les","des","une","un","et","est","que","qui","pour","dans","sur","pas","avec","plus","au","ce","sont","aux","du","en","il","elle"],
    de: ["der","die","das","und","ist","nicht","mit","für","auf","den","dem","ein","eine","zu","sich","auch","als","aber","wird","von","im","des","sind"],
    es: ["el","la","los","las","de","que","y","en","un","una","es","por","con","para","no","se","del","al","como","más","pero","sus","le"],
    pt: ["o","a","os","as","de","que","e","em","um","uma","é","por","com","para","não","se","do","da","como","mais","mas"],
    it: ["il","la","i","le","di","che","e","in","un","una","è","per","con","non","si","del","della","come","più","ma","gli"]
  };

  function scriptFlags(text) {
    return {
      han: /[\u3400-\u9fff\uf900-\ufaff]/.test(text),
      latin: /[A-Za-z\u00c0-\u024f]/.test(text),
      kana: /[\u3040-\u30ff\u31f0-\u31ff]/.test(text),
      hangul: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(text),
      cyrillic: /[\u0400-\u052f]/.test(text),
      arabic: /[\u0600-\u06ff\u0750-\u077f]/.test(text),
      hebrew: /[\u0590-\u05ff]/.test(text),
      greek: /[\u0370-\u03ff\u1f00-\u1fff]/.test(text),
      devanagari: /[\u0900-\u097f]/.test(text),
      thai: /[\u0e00-\u0e7f]/.test(text)
    };
  }

  // 是否存在"真正需要翻译的文字"：拉丁字母、数字与各语言字符体系。
  // emoji、符号、标点、全角符号形状的字符不算（避免为 😀 或 ＨＥＬＬＯ 这种内容付翻译费）。
  var TRANSLATABLE_LETTER_RE = /[0-9A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u052f\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/;
  function hasTranslatableLetters(text) { return TRANSLATABLE_LETTER_RE.test(String(text || "")); }

  function looksLikeLatinTarget(text, base) {
    var stopwords = LATIN_STOPWORDS[base];
    if (!stopwords) return false;
    var words = String(text).toLowerCase().match(/[a-z\u00c0-\u024f']+/g);
    if (!words || words.length < 5) return false;
    var hits = 0;
    words.forEach(function (word) { if (stopwords.indexOf(word) >= 0) hits++; });
    return hits / words.length >= 0.34;
  }

  function isAlreadyTargetText(text, targetLanguage) {
    text=String(text || "").trim();
    if (!text) return true;
    // 没有可翻译的文字（纯数字/符号/emoji/全角符号）不必消耗额度。
    if (!hasTranslatableLetters(text)) return true;
    var flags = scriptFlags(text);
    var base = normalizeLanguage(targetLanguage).toLowerCase().split("-")[0];
    var rule = TARGET_SCRIPT_RANGES[base];
    if (rule) {
      var hasNeeded = true;
      rule.need.forEach(function (key) { if (!flags[key]) hasNeeded = false; });
      if (!hasNeeded) return false;
      var hasForeign = false;
      ALL_SCRIPTS.forEach(function (key) {
        if (rule.allow.indexOf(key) >= 0) return;
        if (flags[key]) hasForeign = true;
      });
      return !hasForeign;
    }
    if (LATIN_STOPWORDS[base]) {
      for (var i = 0; i < ALL_SCRIPTS.length; i++) if (ALL_SCRIPTS[i] !== "latin" && flags[ALL_SCRIPTS[i]]) return false;
      return looksLikeLatinTarget(text, base);
    }
    // 未收录的目标语言：一律送去翻译（宁可多翻，也不要整页漏译）。
    return false;
  }

  function translationCacheKey(text,cfg) {
    var endpoint=cfg.service === "microsoft" ? "microsoft" : resolvedEndpoint(cfg), hash=5381;
    // 自定义地址可能在查询参数中携带令牌，只保存不可读的作用域摘要。
    for (var i=0;i<endpoint.length;i++) hash=((hash<<5)+hash)^endpoint.charCodeAt(i);
    return [cfg.service,(hash>>>0).toString(36),cfg.model,cfg.targetLanguage,text].join("\n");
  }

  // 非自然语言文本不值得送去翻译：URL、邮箱、纯数字、价格、日期、版本号、十六进制/寄存器地址、
  // 百分比与"数字+单位"。判定按整段匹配，因此 "This device uses 1.2 kg of material." 仍会被翻译。
  var NON_TRANSLATABLE_PATTERNS = [
    /^(?:https?:\/\/|www\.)\S+$/i,
    /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/,
    /^0x[0-9a-f]+(?:\s+[0-9a-f]+)*$/i,
    /^v?\d+(?:\.\d+){1,3}(?:[-+][\w.]+)?$/i,
    /^[-+]?[\d\uFF10-\uFF19][\d\s.,:/\-\u2013\u2014%‰°$¥€£₩·•|]*$/,
    // 括号包裹的纯数字/日期，例如 "(2024)"、"[12]"、"（三）"除外
    /^[([{（【]\s*[-+]?[\d\uFF10-\uFF19][\d\s.,:/\-\u2013\u2014%‰°$¥€£₩·•|]*\s*[)\]）】]$/,
    /^[-+]?[\d.,]+\s?(?:kg|g|mg|lb|oz|km|m|cm|mm|um|nm|ml|l|cl|dl|s|ms|us|ns|h|min|kb|mb|gb|tb|kbps|mbps|hz|khz|mhz|ghz|v|mv|kv|ma|a|w|kw|wh|kwh|°c|°f|px|em|rem|dpi|rpm|db|dbm|bar|kpa|mpa|psi|fps|ppi)$/i,
    /^[$¥€£₩]\s?[\d.,]+$/,
    /^[#@][\w.\-]{2,}$/
  ];
  function isNonTranslatableText(text) {
    var value = String(text == null ? "" : text).trim();
    if (!value) return true;
    for (var i = 0; i < NON_TRANSLATABLE_PATTERNS.length; i++) {
      if (NON_TRANSLATABLE_PATTERNS[i].test(value)) return true;
    }
    return false;
  }

  // 批量响应格式异常时最多使用两条补救通道，缩短等待但不制造失控并发。
  async function retryAiIndividually(texts,cfg,jobId) {
    var values=new Array(texts.length), cursor=0;
    async function worker() {
      while (cursor < texts.length) {
        if (jobId != null && jobId !== app.jobId) throw requestError("请求已取消", "abort");
        var index=cursor++;
        values[index]=(await aiTranslate([texts[index]],cfg,jobId))[0];
      }
    }
    var workers=[], count=Math.max(1,Math.min(2,cfg.concurrency,texts.length));
    for (var i=0;i<count;i++) workers.push(worker());
    await Promise.all(workers);
    return values;
  }

  // in-flight 去重：同一 (服务/模型/目标语言/原文) 正在请求中时，后续调用直接复用同一个 Promise，
  // 避免并发车道或同一批次内的重复文本被重复计费。
  var inflightTranslations = new Map();

  // 超长段落切分：优先在段落/句子/标点/空白处切开，绝不在 Unicode 中间截断
  // （代理对、ZWJ、变体选择符、组合记号都要保护），切分结果按原顺序可无损拼回。
  function safeHardCut(value, limit) {
    var cut = Math.min(limit, value.length);
    var high = value.charCodeAt(cut - 1);
    if (high >= 0xD800 && high <= 0xDBFF) cut--;                 // 不要把代理对切开
    var guard = 0;
    while (cut > 1 && guard++ < 12) {
      var prev = value.charCodeAt(cut - 1);
      var next = value.charCodeAt(cut);
      var combining = (next >= 0x0300 && next <= 0x036F) || next === 0xFE0F || next === 0xFE0E;
      if (prev === 0x200D || next === 0x200D || combining) { cut--; continue; }
      break;
    }
    return cut > 0 ? cut : Math.min(limit, value.length);
  }

  function findSplitPoint(window) {
    var min = Math.floor(window.length * 0.5);
    var patterns = [/\n{2,}/g, /[.!?。！？；;]["'”』」)]?\s/g, /[,，、:：]\s/g, /\s+/g];
    for (var p = 0; p < patterns.length; p++) {
      var re = patterns[p], best = -1, match;
      re.lastIndex = 0;
      while ((match = re.exec(window))) {
        var end = match.index + match[0].length;
        if (end > best) best = end;
      }
      if (best >= min) return best;
    }
    return -1;
  }

  // 返回 [{ core, sep }]：core 是要发送的文本，sep 是它后面原本的空白（拼回时补上）。
  function splitLongText(text) {
    var value = String(text == null ? "" : text);
    if (value.length <= MAX_CHUNK_LENGTH) return [{ core: value, sep: "" }];
    var parts = [];
    var rest = value;
    while (rest.length > MAX_CHUNK_LENGTH) {
      var window = rest.slice(0, MAX_CHUNK_LENGTH);
      var cut = findSplitPoint(window);
      if (cut < 0) cut = safeHardCut(rest, MAX_CHUNK_LENGTH);
      var piece = rest.slice(0, cut);
      rest = rest.slice(cut);
      var trailing = (piece.match(/\s+$/) || [""])[0];
      parts.push({ core: trailing ? piece.slice(0, piece.length - trailing.length) : piece, sep: trailing });
    }
    if (rest) {
      var tail = (rest.match(/^\s+/) || [""])[0];
      var core = tail ? rest.slice(tail.length) : rest;
      if (parts.length) parts[parts.length - 1].sep += tail;
      if (core) parts.push({ core: core, sep: "" });
    }
    return parts.length ? parts : [{ core: value, sep: "" }];
  }

  // 把超长文本展开成多个字符串发出去，收到译文后按原顺序（含原空白）拼回。
  async function requestTranslations(texts, cfg, jobId) {
    var plans = texts.map(splitLongText);
    var flat = [];
    plans.forEach(function (parts) {
      parts.forEach(function (part) { flat.push(part.core); });
    });
    var providerCall = function (list) {
      if (cfg.service === "microsoft") return microsoftTranslate(list, cfg, jobId);
      return aiTranslate(list, cfg, jobId).catch(function (error) {
        if (error.kind !== "format" || list.length === 1) throw error;
        return retryAiIndividually(list, cfg, jobId);
      });
    };
    var translated = await providerCall(flat);
    var cursor = 0;
    return plans.map(function (parts) {
      var buffer = "";
      parts.forEach(function (part, index) {
        var value = translated[cursor++];
        buffer += value == null ? part.core : String(value);
        if (index < parts.length - 1) buffer += part.sep;
      });
      return buffer;
    });
  }

  function registerInflight(keys, factory) {
    var batchPromise = factory();
    var perKey = keys.map(function (key, index) {
      var single = batchPromise.then(function (list) { return list[index]; });
      single.catch(function () {});
      inflightTranslations.set(key, single);
      return single;
    });
    var cleanup = function () {
      keys.forEach(function (key, index) {
        if (inflightTranslations.get(key) === perKey[index]) inflightTranslations.delete(key);
      });
    };
    batchPromise.then(cleanup, cleanup);
    return batchPromise;
  }

  async function translateProvider(texts, cfg, jobId, bypassCache) {
    var keys = texts.map(function (text) { return translationCacheKey(text,cfg); });
    var values = new Array(texts.length);
    // key -> 需要该译文的原始下标（同一批次内相同原文只请求一次）
    var slots = new Map();

    // 按段复用缓存；即使一个批次只有部分内容命中缓存，也不重复消耗其翻译额度。
    texts.forEach(function (text, index) {
      if (!bypassCache && (isAlreadyTargetText(text,cfg.targetLanguage) || isNonTranslatableText(text))) values[index] = text;
      else if (!bypassCache && app.cache.has(keys[index])) {
        values[index] = app.cache.get(keys[index]);
        // 命中时移到末尾，使容量淘汰优先保留近期使用的内容。
        app.cache.delete(keys[index]); app.cache.set(keys[index],values[index]); scheduleCacheWrite();
      }
      else {
        var list = slots.get(keys[index]);
        if (list) list.push(index); else slots.set(keys[index], [index]);
      }
    });
    if (!slots.size) return values;

    function assign(key, value) {
      var indexes = slots.get(key) || [];
      indexes.forEach(function (index) {
        values[index] = value;
        if (!bypassCache) putTranslationCache(keys[index], value);
      });
    }

    // 已在请求中的文本：等待同一个 Promise，不再另发一次。
    var waiters = [];
    var toSend = [];
    slots.forEach(function (indexes, key) {
      var pending = inflightTranslations.get(key);
      if (pending) waiters.push(pending.then(function (value) { return { key:key, value:value }; }));
      else toSend.push({ key:key, text:texts[indexes[0]] });
    });

    // 关键顺序（并发去重的核心）：
    //   1. 先把自己要发的请求登记进 in-flight 表；
    //   2. 再去 await 其它车道已在途的文本。
    // 反过来的话，"等待其它车道"的这段时间就是一个空窗：此刻同一文本既不在 in-flight 表里、
    // 也还没写进缓存，另一条车道会判定为 cache miss 并重复发起同一个请求（实测会重复计费）。
    var batchPromise = null;
    if (toSend.length) {
      var payload = toSend.map(function (item) { return item.text; });
      // 结果先写入正式缓存，再由 registerInflight 从 in-flight 表移除，
      // 避免出现"缓存与 in-flight 都没有"的微任务窗口。
      batchPromise = registerInflight(toSend.map(function (item) { return item.key; }), function () {
        return requestTranslations(payload, cfg, jobId).then(function (list) {
          toSend.forEach(function (item, index) {
            if (!bypassCache) putTranslationCache(item.key, list[index]);
          });
          return list;
        });
      });
    }

    if (waiters.length) {
      (await Promise.all(waiters)).forEach(function (item) { assign(item.key, item.value); });
    }
    if (batchPromise) {
      var translated = await batchPromise;
      toSend.forEach(function (item, index) {
        values[slots.get(item.key)[0]] = translated[index];
        assign(item.key, translated[index]);
      });
    }
    return values;
  }

  // ---------------------------------------------------------------------------
  // 阅读正文定位与段落筛选
  // ---------------------------------------------------------------------------

  function normalizedText(element) { return (element.innerText || element.textContent || "").replace(/\s+/g," ").trim(); }
  function isVisible(element) {
    var style = getComputedStyle(element); var rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }
  // 所有"用户可编辑"判定都走这里，避免各处写法不一致导致草稿被翻译或上传。
  // contenteditable 的 ""、"true"、"plaintext-only" 以及裸属性（getAttribute 返回 ""）都视为可编辑；
  // "false" 会中断继承；祖先可编辑同样生效；document.designMode === "on" 时整页可编辑。
  function isEditableElement(element) {
    if (!element || element.nodeType !== 1) return false;
    try {
      if (document.designMode && String(document.designMode).toLowerCase() === "on") return true;
    } catch (_) {}
    var node = element;
    while (node && node.nodeType === 1) {
      if (node.isContentEditable === true) return true;
      if (node.getAttribute) {
        var raw = node.getAttribute("contenteditable");
        if (raw != null) {
          // 与 Chromium 一致：只有显式 "false" 表示不可编辑，其余写法都表示可编辑。
          if (String(raw).toLowerCase() === "false") return false;
          return true;
        }
      }
      if (node.tagName === "BODY" || node.tagName === "HTML") break;
      node = node.parentElement;
    }
    return false;
  }

  // 会被整块排除的祖先：脚本、媒体、控件本体、编辑区、隐藏区。
  var EXCLUDED_SUBTREE_SELECTOR = "script,style,noscript,svg,canvas,video,audio,textarea,input,select,button,pre,code,[aria-hidden='true'],#rf-via-host,." + TRANSLATION_CLASS;
  // 只排除元素自身：界面容器（工具栏/菜单/标签页/弹窗/自定义按钮）不该吞掉里面的可读文字。
  var EXCLUDED_SELF_SELECTOR = "dialog,[role='toolbar'],[role='tablist'],[role='menu'],[role='menubar'],[role='button']";

  // header/nav/footer/form 只是页面结构，不应成为整块禁区。真正危险的是脚本、媒体、编辑区与控件本体；
  // 结构区域中的普通可见文字仍按叶级候选处理，避免登录页、导航标题和页脚说明漏译。
  function isExcluded(element) {
    if (isEditableElement(element)) return true;
    if (element.closest(EXCLUDED_SUBTREE_SELECTOR)) return true;
    return !!element.matches(EXCLUDED_SELF_SELECTOR);
  }

  // 链接、按钮等控件只翻译可见文字节点，不能替换控件本身，否则会丢失图标、事件或跳转能力。
  function isUnsafeInteractiveSegment(element) {
    if (isEditableElement(element)) return true;
    return !!element.closest("script,style,noscript,svg,canvas,video,audio,textarea,input,select,pre,code,[aria-hidden='true'],#rf-via-host,." + TRANSLATION_CLASS);
  }

  function innermostRoots(nodes) {
    return nodes.filter(function (node,index) {
      return nodes.indexOf(node) === index && !nodes.some(function (other) { return other !== node && node.contains(other); });
    });
  }

  function visibleContentRoots(selector, minimum) {
    return innermostRoots(Array.prototype.slice.call(document.querySelectorAll(selector)).filter(function (node) {
      return isVisible(node) && normalizedText(node).length >= minimum;
    }));
  }

  function readingRoots() {
    // 与 Read Frog 上游一致，从文档内容根开始按实际布局递归，不再猜测某个 article/main 才是正文。
    return [document.body];
  }

  function articleCoverage(articleRoots, mainRoots) {
    var articleText=articleRoots.reduce(function (sum,node) { return sum + normalizedText(node).length; },0);
    var mainText=mainRoots.reduce(function (sum,node) { return sum + normalizedText(node).length; },0);
    return mainText ? Math.min(1,articleText / mainText) : 1;
  }

  // 有些新闻站把标题、摘要和作者区放在正文节点的前一个兄弟节点中。
  function articleLeadRoots(bodyRoots) {
    var leads=[];
    bodyRoots.forEach(function (bodyRoot) {
      var sibling=bodyRoot.previousElementSibling, checked=0;
      while (sibling && checked++ < 3) {
        var marker=((typeof sibling.className === "string" ? sibling.className : "") + " " + (sibling.id || "")).toLowerCase();
        var semantic=/(article|post|story|entry)[\s_-]*(head|top|title|meta)/.test(marker) ||
          !!sibling.querySelector("h1,[itemprop='headline'],[class*='article_title'],[class*='story-title']");
        var text=normalizedText(sibling);
        if (semantic && isVisible(sibling) && text.length >= 2 && text.length <= MAX_TEXT_LENGTH) leads.push(sibling);
        sibling=sibling.previousElementSibling;
      }
    });
    return innermostRoots(leads);
  }

  // 关键词分两类：
  //   data   —— 面包屑/分页/侧栏/元数据/统计：连里面的叶子文字一起跳过（数字与元数据不值得翻译）
  //   chrome —— 工具栏/菜单/标签栏/控件栏：只跳过容器本身，里面的文字标签保留给读者
  var DATA_MARKER_RE = /(^|[\s_-])(breadcrumb|pagination|sidebar|metadata|meta-row|stats?)([\s_-]|$)/;
  var CHROME_MARKER_RE = /(^|[\s_-])(toolbar|navbar|navigation|tabs?|controls?|actions?|command|menu)([\s_-]|$)/;

  function markerKind(start, root) {
    var cursor=start;
    while (cursor && cursor !== root && cursor !== document.body) {
      var marker=((typeof cursor.className === "string" ? cursor.className : "") + " " + (cursor.id || "") + " " + (cursor.getAttribute("aria-label") || "")).toLowerCase();
      if (DATA_MARKER_RE.test(marker)) return "data";
      if (CHROME_MARKER_RE.test(marker)) return "chrome";
      cursor=cursor.parentElement;
    }
    return null;
  }

  function interfaceMarker(element, root) { return !!markerKind(element, root); }

  // 关键词命中只是"弱信号"：id/class 里出现 control/stats/menu 之类的词，不代表里面不是正文。
  function looksLikeProse(text) {
    var value = String(text || "").trim();
    if (value.length >= 120) return true;
    if (value.length >= 60 && /[.!?。！？；;：:]["'”』」)]?\s*$/.test(value)) return true;
    if (value.length >= 80 && value.split(/\s+/).length >= 12) return true;
    return false;
  }

  // 叶子文字节点（如 <span>Share this article</span>）不该因为自己或所在工具栏的名字被跳过；
  // 界面判定应该落到真正的控件/元数据容器上，而不是大范围祖先子树。
  function isLeafTextElement(element) {
    for (var i = 0; i < element.children.length; i++) {
      var child = element.children[i];
      if (child.children.length > 0) return false;
      if ((child.textContent || "").trim().length >= 2) return false;
    }
    return true;
  }

  function isInterfaceElement(element, root) {
    var container = element.children.length > 0 && !isLeafTextElement(element);
    var kind = markerKind(container ? element : element.parentElement, root);
    if (!kind) return false;
    if (kind === "chrome" && !container) return false;      // 工具栏里的文字标签仍然翻译
    if (container && looksLikeProse(normalizedText(element))) return false;
    return true;
  }

  function interactiveDensity(element, text) {
    var controls=element.querySelectorAll("a,button,input,select,textarea,[role='button'],[role='link']");
    if (!controls.length) return 0;
    var interactiveText=0;
    Array.prototype.forEach.call(controls,function (node) { interactiveText += normalizedText(node).length; });
    return Math.min(1, interactiveText / Math.max(1,text.length));
  }

  function isLikelyInterface(element, root) {
    if (isInterfaceElement(element,root)) return true;
    var text=normalizedText(element), density=interactiveDensity(element,text);
    if (density > .72 && text.length < 220) return true;
    var parent=element.parentElement;
    if (parent) {
      var layout=getComputedStyle(parent).display;
      if ((layout === "flex" || layout === "inline-flex" || layout === "grid" || layout === "inline-grid") && text.length < 80 && element.tagName === "DIV") return true;
    }
    return false;
  }

  function proseLikeDiv(element, root) {
    if (element.querySelector("p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd") || element.children.length > 3) return false;
    var text=normalizedText(element);
    if (text.length < 36 || isLikelyInterface(element,root)) return false;
    return text.length >= 80 || /[.!?。！？；;:]\s*$/.test(text);
  }

  // 视口外与 1px 裁剪的"仅辅助技术可见"文本（sr-only / position:left:-9999px）不必消耗翻译额度。
  // 只对极端坐标生效，正常页面里滚动到视口外的正文不受影响。
  function isParkedOffscreen(element) {
    var inline = element.style || {};
    var left = parseFloat(inline.left);
    var width = parseFloat(inline.width);
    var height = parseFloat(inline.height);
    if (isFinite(left) && left <= -1000) return true;
    if ((isFinite(width) && width <= 1) || (isFinite(height) && height <= 1)) return true;
    var rect = element.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return true;
    if (rect.right < -1000 || rect.left > innerWidth + 1000 || rect.bottom < -2000) return true;
    return false;
  }

  // 保守的广告容器识别：把 class/id 按空白与 -/_ 拆成记号，只匹配完整记号，避免误伤
  // "adapt"、"badge"、"download"、"add-to-cart" 这类词。
  // 强记号几乎只可能是广告位；弱记号（Sponsored 之类）也可能是需要翻译的标签，只跳过容器。
  var AD_STRONG_TOKENS = { ad:1, ads:1, advert:1, adverts:1, adsbygoogle:1, advertisement:1, advertisements:1, adslot:1 };
  var AD_WEAK_TOKENS = { sponsor:1, sponsored:1 };
  function adTokensOf(element) {
    var raw = [];
    if (typeof element.className === "string") raw = raw.concat(element.className.toLowerCase().split(/\s+/));
    if (element.id) raw.push(String(element.id).toLowerCase());
    var tokens = [];
    raw.forEach(function (value) {
      String(value).split(/[\s\-_]+/).forEach(function (part) { if (part) tokens.push(part); });
    });
    return tokens;
  }
  function isAdContainer(element) {
    var tokens = adTokensOf(element);
    var strong = false, weak = false;
    for (var i = 0; i < tokens.length; i++) {
      if (AD_STRONG_TOKENS[tokens[i]]) strong = true;
      if (AD_WEAK_TOKENS[tokens[i]]) weak = true;
    }
    if (strong) return true;
    if (weak) return !isLeafTextElement(element);
    return false;
  }

  function cardMetadataLike(element, root) {
    if (element.children.length || element.closest("p,h1,h2,h3,h4,h5,h6,a,button,[role='link'],[role='button']")) return false;
    if (!element.closest("article,li,[class*='card'],[class*='story'],[class*='post']")) return false;
    var text=normalizedText(element);
    return text.length >= 2 && text.length <= 120 && /[A-Za-z\u00c0-\uffff]/.test(text) && !isLikelyInterface(element,root);
  }

  function isInlineSegmentNode(node) {
    if (node.nodeType === 3) return true;
    if (node.nodeType !== 1 || node.classList.contains(SOURCE_SEGMENT_CLASS)) return false;
    return /^(A|SPAN|EM|STRONG|B|I|U|SMALL|SUB|SUP|FONT|MARK|TIME|CITE|Q)$/.test(node.tagName);
  }

  function directTextRuns(container) {
    var runs=[];
    var current=[];
    function flush() {
      if (current.length) runs.push(current);
      current=[];
    }
    Array.prototype.forEach.call(container.childNodes,function (node) {
      if (node.nodeType === 1 && node.tagName === "BR") { flush(); return; }
      if (isInlineSegmentNode(node)) current.push(node);
      else flush();
    });
    flush();
    return runs;
  }

  // 一些旧式新闻页用连续 BR 分段，正文只是 div 的直接文本节点。
  // 将这些文本段临时包进 span，才能复用现有翻译、切换与精确恢复流程。
  function wrapBreakSeparatedText(roots) {
    roots.forEach(function (root) {
      var containers=[];
      if (root.matches && root.matches("div,section,article,main")) containers.push(root);
      Array.prototype.forEach.call(root.querySelectorAll("div,section,article,main"),function (element) { containers.push(element); });
      containers.forEach(function (container) {
        var directBreaks=0;
        var hasWrappedSegment=false;
        Array.prototype.forEach.call(container.children,function (child) {
          if (child.tagName === "BR") directBreaks++;
          if (child.classList.contains(SOURCE_SEGMENT_CLASS)) hasWrappedSegment=true;
        });
        if (hasWrappedSegment || directBreaks < 2) return;
        if (isExcluded(container) || !isVisible(container) || isLikelyInterface(container,root)) return;
        var runs=directTextRuns(container).filter(function (nodes) {
          var text=nodes.map(function (node) { return node.textContent || ""; }).join("").replace(/\s+/g," ").trim();
          return text.length >= 2 && text.length <= MAX_TEXT_LENGTH && /[A-Za-z0-9\u00c0-\uffff]/.test(text);
        });
        var total=runs.reduce(function (sum,nodes) { return sum + nodes.map(function (node) { return node.textContent || ""; }).join("").trim().length; },0);
        if (runs.length < 2 || total < 80 || interactiveDensity(container,normalizedText(container)) > .35) return;
        runs.forEach(function (nodes) {
          var wrapper=document.createElement("span");
          wrapper.className=SOURCE_SEGMENT_CLASS;
          nodes[0].parentNode.insertBefore(wrapper,nodes[0]);
          nodes.forEach(function (node) { wrapper.appendChild(node); });
        });
      });
    });
  }

  function wrapInteractiveText(roots) {
    var wrappers=[];
    var controls=[];
    (roots || [document.body]).forEach(function (root) {
      if (!root) return;
      if (root.matches && root.matches("a,button,[role='link'],[role='button']")) controls.push(root);
      Array.prototype.forEach.call(root.querySelectorAll("a,button,[role='link'],[role='button']"), function (node) { controls.push(node); });
    });
    Array.prototype.forEach.call(controls,function (control) {
      if (!isVisible(control) || control.closest("#rf-via-host,." + TRANSLATION_CLASS)) return;
      if (isEditableElement(control)) return;
      function visit(node) {
        if (node.nodeType === 3) {
          if (isEditableElement(node.parentElement)) return;
          var text=(node.nodeValue || "").replace(/\s+/g," ").trim();
          if (text.length < 2 || text.length > MAX_TEXT_LENGTH || !/[A-Za-z0-9\u00c0-\uffff]/.test(text)) return;
          var wrapper=document.createElement("span");
          wrapper.className=SOURCE_SEGMENT_CLASS + " " + INTERACTIVE_SEGMENT_CLASS;
          node.parentNode.insertBefore(wrapper,node);
          wrapper.appendChild(node);
          wrappers.push(wrapper);
          return;
        }
        if (node.nodeType !== 1 || node.classList.contains(SOURCE_SEGMENT_CLASS) ||
            node.classList.contains(TRANSLATION_CLASS) || node.classList.contains(UI_LABEL_CLASS) ||
            /^(SCRIPT|STYLE|NOSCRIPT|SVG|CANVAS|VIDEO|AUDIO|TEXTAREA|INPUT|SELECT|PRE|CODE)$/.test(node.tagName) ||
            node.getAttribute("aria-hidden") === "true" || isEditableElement(node)) return;
        Array.prototype.slice.call(node.childNodes).forEach(visit);
      }
      Array.prototype.slice.call(control.childNodes).forEach(visit);
    });
    return wrappers;
  }

  function hasProtectedContent(element) {
    return !!element.querySelector("img,picture,video,audio,svg,canvas,iframe,object,embed,a,button,input,select,textarea,[role='link'],[role='button']");
  }

  var LAYOUT_FORCE_BLOCK_TAGS = new Set([
    "BODY","H1","H2","H3","H4","H5","H6","BR","FORM","SELECT","BUTTON","LABEL",
    "UL","OL","LI","BLOCKQUOTE","PRE","ARTICLE","SECTION","FIGURE","FIGCAPTION","HEADER",
    "FOOTER","MAIN","NAV"
  ]);
  var LAYOUT_SKIP_TAGS = new Set([
    "HEAD","TITLE","HR","INPUT","TEXTAREA","IMG","VIDEO","AUDIO","CANVAS","SOURCE","TRACK",
    "META","SCRIPT","NOSCRIPT","STYLE","LINK","RT","RP","PRE","CODE","SVG","MATH"
  ]);

  function isInlineDisplay(display) {
    display=String(display || "").trim().toLowerCase();
    return display.indexOf("inline") === 0 || display === "contents" || display.indexOf("ruby") === 0;
  }

  function usesIconFont(style) {
    var family=String(style.fontFamily || "").split(",")[0].replace(/[\"']/g,"").trim().toLowerCase();
    return family === "google symbols" || family === "fontawesome" ||
      family.indexOf("material icons") === 0 || family.indexOf("material symbols") === 0 ||
      family.indexOf("font awesome") === 0;
  }

  function layoutInfo(element) {
    if (LAYOUT_SKIP_TAGS.has(element.tagName) || element.hidden || element.getAttribute("aria-hidden") === "true" ||
        isEditableElement(element) || element.closest("#rf-via-host,." + TRANSLATION_CLASS)) return null;
    var style=getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || usesIconFont(style)) return null;
    return { inline:!LAYOUT_FORCE_BLOCK_TAGS.has(element.tagName) && isInlineDisplay(style.display) };
  }

  // 移植上游的布局遍历思想：块节点负责一段，行内节点与文字归入最近的块级段落。
  function layoutParagraphCandidates(root) {
    var result=[];
    function wrapTextNode(node) {
      var text=(node.nodeValue || "").replace(/\s+/g," ").trim();
      if (text.length < 2 || !/[A-Za-z0-9\u00c0-\uffff]/.test(text)) return;
      var wrapper=document.createElement("span");
      wrapper.className=SOURCE_SEGMENT_CLASS;
      node.parentNode.insertBefore(wrapper,node);
      wrapper.appendChild(node);
      result.push(wrapper);
    }
    function visit(element) {
      var info=layoutInfo(element);
      if (!info) return { hasText:false, inline:false };
      if (element.classList.contains(SOURCE_SEGMENT_CLASS)) {
        return { hasText:normalizedText(element).length > 0, inline:true };
      }
      var hasInlineContent=false, hasBlockContent=false;
      var childResults=[];
      Array.prototype.slice.call(element.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          var textPresent=!!(child.nodeValue || "").trim();
          if (textPresent) hasInlineContent=true;
          childResults.push({ node:child, hasText:textPresent, inline:true });
          return;
        }
        if (child.nodeType !== 1) return;
        var childInfo=visit(child);
        childResults.push({ node:child, hasText:childInfo.hasText, inline:childInfo.inline });
        if (!childInfo.hasText) return;
        if (childInfo.inline) hasInlineContent=true;
        else hasBlockContent=true;
      });
      var hasText=hasInlineContent || hasBlockContent;
      if (!info.inline && hasInlineContent && !hasBlockContent && normalizedText(element).length >= 2) result.push(element);
      else if (hasInlineContent && hasBlockContent) {
        // 与上游 translateWalkedElement 的连续行内运行一致：不能丢掉块节点之间的署名、日期或裸文本。
        // 老式页面也可能在 span 内混放 p、br、图片和长段裸文本，此时同样只包装安全的行内片段。
        childResults.forEach(function (child) {
          if (!child.hasText || !child.inline) return;
          if (child.node.nodeType === 3) wrapTextNode(child.node);
          // 可点击节点必须继续走逐文字节点包装，不能整体替换，否则图片、图标和事件会被清掉。
          else if (!child.node.matches("a,button,[role='link'],[role='button']") && normalizedText(child.node).length >= 2) result.push(child.node);
        });
      }
      return { hasText:hasText, inline:info.inline && !hasBlockContent };
    }
    visit(root);
    return result;
  }

  // 复合标题或署名区域可能同时含图片、图标、作者卡片和多层文字，逐个包装文字以保留这些组件。
  function wrapDirectProtectedText(element) {
    if (config.mode !== "translation" || (!hasProtectedContent(element) && !element.children.length)) return;
    function visit(node) {
      if (node.nodeType === 3) {
        var parent=node.parentElement;
        if (!parent || !isVisible(parent) || parent.closest("a,button,[role='link'],[role='button']") || isEditableElement(parent)) return;
        var text=(node.nodeValue || "").replace(/\s+/g," ").trim();
        if (text.length < 2 || text.length > MAX_TEXT_LENGTH || !/[A-Za-z0-9\u00c0-\uffff]/.test(text)) return;
        var wrapper=document.createElement("span");
        wrapper.className=SOURCE_SEGMENT_CLASS;
        node.parentNode.insertBefore(wrapper,node);
        wrapper.appendChild(node);
        return;
      }
      if (node.nodeType !== 1 || node.classList.contains(SOURCE_SEGMENT_CLASS) ||
          /^(SCRIPT|STYLE|NOSCRIPT|SVG|PICTURE|SOURCE|IMG|CANVAS|VIDEO|AUDIO|IFRAME|OBJECT|EMBED|INPUT|SELECT|TEXTAREA)$/.test(node.tagName) ||
          node.getAttribute("aria-hidden") === "true" || isEditableElement(node)) return;
      Array.prototype.slice.call(node.childNodes).forEach(visit);
    }
    Array.prototype.slice.call(element.childNodes).forEach(visit);
  }

  // 工具栏/菜单/标签栏这类"界面容器"本身不翻译，但里面的文字标签是读者要读的内容，
  // 因此单独收集它们的浅层文字叶子（用 UI_LABEL_CLASS 标记，按行内译文渲染）。
  function chromeLabelCandidates(roots) {
    var out = [];
    var SELECTOR = "[role='toolbar'],[role='menu'],[role='menubar'],[role='tablist']";
    roots.forEach(function (root) {
      var containers = [];
      if (root.matches && root.matches(SELECTOR)) containers.push(root);
      Array.prototype.forEach.call(root.querySelectorAll(SELECTOR), function (node) { containers.push(node); });
      containers.forEach(function (container) {
        if (!isVisible(container)) return;
        Array.prototype.forEach.call(container.querySelectorAll("span,p,div,li,label,strong,em,small"), function (node) {
          if (node.children.length > 0) return;
          if (node.closest("a,button,[role='link'],[role='button'],." + TRANSLATION_CLASS + ",." + SOURCE_SEGMENT_CLASS)) return;
          var text = (node.textContent || "").replace(/\s+/g," ").trim();
          if (text.length < 2 || text.length > 160) return;
          node.classList.add(UI_LABEL_CLASS);
          out.push(node);
        });
      });
    });
    return out;
  }

  function candidateElements(roots) {
    var result=[];
    var seen=new Set();
    function add(element) {
      if (!seen.has(element)) { seen.add(element); result.push(element); }
    }
    wrapBreakSeparatedText(roots);
    roots.forEach(function (root) {
      var layoutCandidates=layoutParagraphCandidates(root);
      if (config.mode === "translation") layoutCandidates.forEach(wrapDirectProtectedText);
      layoutCandidates.forEach(function (element) {
        // 若已拆出安全文字段，父容器不能再入队，否则仅译文模式会清空其图片、链接或嵌套结构。
        if (config.mode !== "translation" || !element.querySelector("." + SOURCE_SEGMENT_CLASS)) add(element);
      });
      Array.prototype.forEach.call(root.querySelectorAll("." + SOURCE_SEGMENT_CLASS),add);
    });
    // 页面导航、新闻卡片和页脚常把文字直接放在可点击控件中；放在正文候选之后，保证正文优先。
    wrapInteractiveText(roots).forEach(add);
    roots.forEach(function (root) {
      if (root.classList && root.classList.contains(INTERACTIVE_SEGMENT_CLASS)) add(root);
      Array.prototype.forEach.call(root.querySelectorAll("." + INTERACTIVE_SEGMENT_CLASS),add);
    });
    chromeLabelCandidates(roots).forEach(add);
    return result;
  }

  // input 的可见按钮文字和输入提示不在文本节点中，必须按属性翻译。
  // 文本框的当前 value 可能是用户输入，绝不读取或发送；只处理 placeholder 与按钮类 value。
  function controlAttributeInfo(element) {
    if (!element || !isVisible(element) || isEditableElement(element) || element.closest("[aria-hidden='true'],#rf-via-host")) return null;
    if (element.tagName === "TEXTAREA") {
      var textareaPlaceholder=element.getAttribute("placeholder");
      return textareaPlaceholder && textareaPlaceholder.trim().length >= 2
        ? { name:"placeholder", text:textareaPlaceholder.trim() } : null;
    }
    if (element.tagName !== "INPUT") return null;
    var type=(element.getAttribute("type") || "text").toLowerCase();
    if (type === "button" || type === "submit" || type === "reset") {
      var buttonValue=element.getAttribute("value") || element.value || "";
      return buttonValue.trim().length >= 2 ? { name:"value", text:buttonValue.trim() } : null;
    }
    if (/^(hidden|checkbox|radio|file|image|range|color|date|datetime-local|month|time|week)$/.test(type)) return null;
    var placeholder=element.getAttribute("placeholder");
    return placeholder && placeholder.trim().length >= 2 ? { name:"placeholder", text:placeholder.trim() } : null;
  }

  function rootForElement(element, roots) {
    for (var i=0; i<roots.length; i++) {
      if (roots[i] === element || roots[i].contains(element)) return roots[i];
    }
    return document.body;
  }

  function discardDetachedRecords() {
    app.records.forEach(function (record, element) {
      if (element.isConnected) return;
      app.retryQueue.delete(record);
      app.records.delete(element);
    });
  }

  function elementPriority(element) {
    var rect = element.getBoundingClientRect();
    if (rect.bottom >= 0 && rect.top <= innerHeight) return Math.abs(rect.top - innerHeight * .3);
    if (rect.top > innerHeight) return innerHeight + rect.top;
    return innerHeight * 3 + Math.abs(rect.bottom);
  }

  function priority(record) { return elementPriority(record.element); }

  function documentOrder(a,b) {
    if (a === b) return 0;
    var position=a.compareDocumentPosition(b);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  // 读取"当前原文"：把脚本自己插入的译文节点排除掉，避免把译文误当原文。
  // 只替换原文（translation 模式）时元素内容就是译文，调用方会同时与 record.translation 比较。
  function elementSourceText(element) {
    var clone = element.cloneNode(true);
    if (clone.querySelectorAll) {
      Array.prototype.forEach.call(clone.querySelectorAll("." + TRANSLATION_CLASS), function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
    }
    return (clone.textContent || "").replace(/\s+/g," ").trim();
  }

  function recordSourceSnapshot(record) {
    var element = record.element;
    if (!element || !element.isConnected) return "";
    if (record.attributeName) {
      var value = element.getAttribute(record.attributeName);
      return value == null ? "" : String(value);
    }
    return elementSourceText(element);
  }

  // 页面改写节点内容后，旧译文必须视为失效：与原文、也与"我们写进去的译文"比较一次。
  function recordSourceChanged(record) {
    if (record.status === "pending" || record.status === "running") return false;
    var current = recordSourceSnapshot(record);
    if (!current) return false;
    if (current === record.text) return false;
    if (record.translation && current === record.translation) return false;
    return true;
  }

  // 丢弃过期渲染，但绝不把旧原文写回页面（页面可能已经替换了内容）。
  function resetRecordSource(record) {
    if (record.node && record.node.parentNode) record.node.parentNode.removeChild(record.node);
    record.node = null;
    record.originalFragment = null;
    record.renderedText = null;
    record.translation = "";
    record.error = null;
    record.status = "pending";
    app.retryQueue.delete(record);
  }

  // 扫描范围：mutation 能告诉我们是哪棵子树变了，就只扫那棵子树；
  // 只有范围无法确定（首次扫描、变更点过多、变更点已脱离文档）时才回落为全页扫描。
  function scopeRootFor(element) {
    var node = element, depth = 0;
    while (node && node !== document.body && node.nodeType === 1 && depth++ < 6) {
      var display = "";
      try { display = getComputedStyle(node).display || ""; } catch (_) {}
      if (display && display.indexOf("inline") !== 0 && display !== "contents") return node;
      node = node.parentElement;
    }
    return element;
  }

  function minimizeRootList(list) {
    if (!list.length) return [];
    if (list.length > 40) return null;
    // 保留"最小的根"：若 A 包含 B，只扫 B，避免一个新增段落就把整个容器重新走一遍。
    var minimized = [];
    list.forEach(function (element) {
      for (var i = minimized.length - 1; i >= 0; i--) {
        if (minimized[i].contains(element)) return;
        if (element.contains(minimized[i])) minimized.splice(i, 1);
      }
      minimized.push(element);
    });
    return minimized;
  }

  function minimizeScanRoots(scope) {
    if (!scope || !scope.size) return [];
    var list = [];
    scope.forEach(function (element) {
      if (!element || element.nodeType !== 1 || !element.isConnected) return;
      var root = scopeRootFor(element);
      if (!root || root === document.documentElement || !root.isConnected) return;
      if (list.indexOf(root) < 0) list.push(root);
    });
    return minimizeRootList(list);
  }

  // null 表示"必须全页扫描"；否则返回合并后的最小根集合。
  function combineScanRoots(a, b) {
    if (a === null || b === null) return null;
    var all = (a || []).concat(b || []);
    if (!all.length) return [];
    return minimizeRootList(all);
  }

  function scanNewRecords(scopeRoots) {
    discardDetachedRecords();
    var added = [], newRecords = 0;
    // 空数组是"明确没有需要扫描的子树"，不是"回退到全页扫描"。
    if (scopeRoots && scopeRoots.length === 0) { app.roundPending = false; return added; }
    var roots = scopeRoots && scopeRoots.length ? scopeRoots : readingRoots();
    app.roundPending = false;
    var candidates;
    if (app.deferredCandidates && app.deferredCandidates.length) {
      // 继续处理上一轮因"每轮上限"而留下的候选队列：不必再走一遍全页。
      candidates = app.deferredCandidates.splice(0, MAX_PARAGRAPHS);
      if (app.deferredCandidates.length) app.roundPending = true;
      else app.deferredCandidates = null;
    } else {
      app.deferredCandidates = null;
      candidates = candidateElements(roots);
      // 块级候选先入队、交互段后入队：这样"容器已被记录"的覆盖判定才能生效，
      // 否则容器与其内部链接会被各翻译一次（同一句话重复渲染 + 重复计费）。
      candidates.sort(function (a,b) {
        var ai = a.classList.contains(INTERACTIVE_SEGMENT_CLASS) ? 1 : 0;
        var bi = b.classList.contains(INTERACTIVE_SEGMENT_CLASS) ? 1 : 0;
        if (ai !== bi) return ai - bi;
        var distance=elementPriority(a)-elementPriority(b);
        return Math.abs(distance) > 1 ? distance : documentOrder(a,b);
      });
    }
    candidates.some(function (element, index) {
      // 内存安全上限（极端页面），以及"每轮最多新记录数"：达到后者只是本轮暂停，
      // 剩余候选进入队列，后续轮次继续处理（不再像旧的 MAX_PARAGRAPHS 那样永久丢弃）。
      if (app.records.size >= MAX_RECORDS) return true;
      if (newRecords >= MAX_PARAGRAPHS) {
        app.roundPending = true;
        app.deferredCandidates = candidates.slice(index);
        return true;
      }
      var root=rootForElement(element, roots);
      var interactive=element.classList.contains(INTERACTIVE_SEGMENT_CLASS) || element.classList.contains(UI_LABEL_CLASS);
      if ((interactive ? isUnsafeInteractiveSegment(element) : isExcluded(element)) ||
          (!interactive && isInterfaceElement(element,root)) || !isVisible(element) ||
          isParkedOffscreen(element) || isAdContainer(element) ||
          (!interactive && config.mode === "translation" && hasProtectedContent(element)) ||
          (element.matches("li") && element.querySelector("li"))) return false;
      var existing = app.records.get(element);
      if (existing) {
        // 元素已被记录，但原文可能已被页面改写：失效重排，而不是永远显示旧译文。
        if (!recordSourceChanged(existing)) return false;
        resetRecordSource(existing);
        var refreshed = element.classList.contains(SOURCE_SEGMENT_CLASS)
          ? (element.textContent || "").replace(/\s+/g," ").trim()
          : elementSourceText(element);
        if (refreshed.length < 2 || !/[A-Za-z0-9\u00c0-\uffff]/.test(refreshed)) return false;
        if (existing.attributeName) {
          existing.text = String(element.getAttribute(existing.attributeName) || "").trim();
          existing.originalAttributeValue = element.getAttribute(existing.attributeName);
          existing.originalControlValue = element.value;
        } else {
          existing.text = refreshed;
        }
        added.push(existing);
        return false;
      }
      var covered=false;
      app.records.forEach(function (record) {
        if (!covered && record.element !== element && record.element.contains(element)) covered=true;
      });
      if (covered) return false;
      // 容器里已经存在子元素的译文时不能再把整容器当新段落：否则"原文"里会混进译文，
      // 译文节点里出现两个标记，等于把译文又翻了一遍。
      if (!interactive && element.querySelector("." + TRANSLATION_CLASS)) return false;
      // inline 元素的 innerText 在部分 Chromium/WebView 中会扩展到整行兄弟节点；包装段必须只读自身文本。
      var text = element.classList.contains(SOURCE_SEGMENT_CLASS)
        ? (element.textContent || "").replace(/\s+/g," ").trim()
        : normalizedText(element);
      if (text.length < 2 || text.length > MAX_TEXT_LENGTH || !/[A-Za-z0-9\u00c0-\uffff]/.test(text)) return false;
      var rawText=element.textContent || "";
      var synthetic=element.classList.contains(SOURCE_SEGMENT_CLASS);
      var record = { element:element, text:text, status:"pending", translation:"", node:null, error:null, originalFragment:null,
        synthetic:synthetic, interactive:interactive,
        leadingSpace:(interactive || synthetic) ? (rawText.match(/^\s*/) || [""])[0] : "",
        trailingSpace:(interactive || synthetic) ? (rawText.match(/\s*$/) || [""])[0] : "",
        placement:interactive ? "after" : bilingualPlacement(element) };
      app.records.set(element, record); added.push(record); newRecords++;
      return false;
    });
    // 表单控件的可见文字来自属性，不能通过替换 DOM 子节点处理。
    // 只处理本次扫描范围内的控件，避免每次 mutation 都全页查询 input/textarea。
    var controlRoots = roots;
    controlRoots.forEach(function (root) {
      var controls = [];
      if (root.matches && root.matches("input,textarea")) controls.push(root);
      Array.prototype.forEach.call(root.querySelectorAll("input,textarea"), function (node) { controls.push(node); });
      Array.prototype.forEach.call(controls, function (element) {
        if (app.records.size >= MAX_RECORDS) return;
        if (newRecords >= MAX_PARAGRAPHS) { app.roundPending = true; return; }
        var existingControl = app.records.get(element);
        if (existingControl) {
          // placeholder / value 被站点改写后同样要重新翻译（否则会一直显示旧提示）。
          if (!recordSourceChanged(existingControl)) return;
          resetRecordSource(existingControl);
          var refreshed = controlAttributeInfo(element);
          if (!refreshed || refreshed.text.length > MAX_TEXT_LENGTH || !/[A-Za-z0-9\u00c0-\uffff]/.test(refreshed.text)) {
            clearRecordRendering(existingControl);
            app.records.delete(element);
            return;
          }
          existingControl.attributeName = refreshed.name;
          existingControl.text = refreshed.text;
          existingControl.originalAttributeValue = element.getAttribute(refreshed.name);
          existingControl.originalControlValue = element.value;
          added.push(existingControl);
          return;
        }
        var attribute=controlAttributeInfo(element);
        if (!attribute || attribute.text.length > MAX_TEXT_LENGTH || !/[A-Za-z0-9\u00c0-\uffff]/.test(attribute.text)) return;
        var record={ element:element, text:attribute.text, status:"pending", translation:"", node:null, error:null,
          originalFragment:null, synthetic:false, interactive:true, leadingSpace:"", trailingSpace:"", placement:"after",
          attributeName:attribute.name, originalAttributeValue:element.getAttribute(attribute.name), originalControlValue:element.value };
        app.records.set(element,record); added.push(record); newRecords++;
      });
    });
    added.sort(function (a,b) { return priority(a) - priority(b); });
    // 兜底：把"上一轮被新任务抢跑"遗留的 pending/running 记录重新纳入本轮。
    // 否则这些记录的原文已经被更新，却再也等不到渲染（页面会永久停在旧译文上）。
    app.records.forEach(function (record) {
      if (added.indexOf(record) >= 0) return;
      if (record.status !== "pending" && record.status !== "running") return;
      if (!record.element.isConnected) return;
      record.status = "pending";
      added.push(record);
    });
    added.sort(function (a,b) { return priority(a) - priority(b); });
    return added;
  }

  // ---------------------------------------------------------------------------
  // 非破坏式译文渲染与原文精确恢复
  // ---------------------------------------------------------------------------

  function makeTranslationNode(record, error) {
    var node = document.createElement(record.interactive || record.placement === "inner-inline" ? "span" : "div");
    node.className = TRANSLATION_CLASS;
    node.dataset.rfStyle = config.translationStyle;
    if (record.interactive) node.dataset.rfInteractive = "1";
    if (error) {
      node.dataset.rfError = "1";
      var message = document.createElement("span"); message.textContent = "翻译失败：" + error.message;
      var retry = document.createElement(record.interactive ? "span" : "button"); retry.className = "rf-via-retry"; retry.textContent = "重试";
      if (record.interactive) { retry.setAttribute("role","button"); retry.setAttribute("tabindex","0"); }
      retry.addEventListener("click", function () { retryRecord(record); });
      node.appendChild(message); node.appendChild(retry);
    } else node.textContent = record.translation;
    return node;
  }

  function useInnerPlacement(element) { return /^(LI|TD|TH|DT|DD)$/.test(element.tagName); }

  function bilingualPlacement(element) {
    if (useInnerPlacement(element)) return "inner-block";
    var parent=element.parentElement, layout=parent ? getComputedStyle(parent).display : "block";
    if (layout === "flex" || layout === "inline-flex" || layout === "grid" || layout === "inline-grid") {
      return /^(P|H1|H2|H3|H4|H5|H6|FIGCAPTION)$/.test(element.tagName) ? "inner-inline" : "inner-block";
    }
    return "after";
  }

  function showSource(record) {
    if (record.attributeName) {
      // 页面可能在我们之后改过属性；只有属性仍是"我们写进去的译文"时才回退，
      // 否则会把站点的新内容覆盖掉。
      var currentAttribute = record.element.getAttribute(record.attributeName);
      var ours = record.translation != null && String(currentAttribute) === String(record.translation);
      if (record.status === "success" && !ours && record.translation) return;
      if (record.originalAttributeValue == null) record.element.removeAttribute(record.attributeName);
      else record.element.setAttribute(record.attributeName,record.originalAttributeValue);
      if (record.attributeName === "value") record.element.value = record.originalControlValue || "";
      return;
    }
    if (record.originalFragment) {
      var current = (record.element.textContent || "").replace(/\s+/g," ").trim();
      var mine = record.renderedText == null ? null : String(record.renderedText).replace(/\s+/g," ").trim();
      if (mine == null || current === mine) {
        while (record.element.firstChild) record.element.removeChild(record.element.firstChild);
        record.element.appendChild(record.originalFragment);
      }
      record.originalFragment = null;
      record.renderedText = null;
    }
  }

  function replaceSource(record) {
    if (record.attributeName) {
      record.element.setAttribute(record.attributeName,record.translation);
      if (record.attributeName === "value") record.element.value = record.translation;
      record.renderedText = record.translation;
      return;
    }
    // 页面已经替换过内容时，旧的原文快照不再可靠，直接以当前内容为新原文。
    if (record.originalFragment) {
      var current = (record.element.textContent || "").replace(/\s+/g," ").trim();
      var mine = record.renderedText == null ? null : String(record.renderedText).replace(/\s+/g," ").trim();
      if (mine != null && current !== mine) record.originalFragment = null;
    }
    var fragment = document.createDocumentFragment();
    while (record.element.firstChild) fragment.appendChild(record.element.firstChild);
    record.originalFragment = fragment;
    record.renderedText = record.leadingSpace + record.translation + record.trailingSpace;
    record.element.textContent = record.renderedText;
  }

  function renderRecord(record) {
    if (!record.element.isConnected) return;
    showSource(record);
    if (record.node) record.node.remove();
    record.node = null;
    if (record.status === "skipped" || record.status === "pending" || record.status === "running") return;
    // 控件属性无法在控件内部安全追加双语节点，两种显示模式都直接替换可见属性，并可完整恢复。
    if (record.status === "success" && (config.mode === "translation" || record.attributeName)) {
      replaceSource(record);
      return;
    }
    record.node = makeTranslationNode(record, record.status === "failed" ? record.error : null);
    if (record.placement === "inner-block" || record.placement === "inner-inline") record.element.appendChild(record.node);
    else record.element.insertAdjacentElement("afterend", record.node);
  }

  function clearRecordRendering(record) {
    showSource(record);
    if (record.node) record.node.remove();
    record.node = null;
  }

  function unwrapSourceSegment(element) {
    if (!element || !element.parentNode) return;
    while (element.firstChild) element.parentNode.insertBefore(element.firstChild,element);
    element.remove();
  }

  function cleanupRecord(record) {
    clearRecordRendering(record);
    if (record.synthetic && record.element.parentNode) {
      unwrapSourceSegment(record.element);
    }
  }
  function sameText(a,b) { return String(a).replace(/\s+/g," ").trim().toLocaleLowerCase() === String(b).replace(/\s+/g," ").trim().toLocaleLowerCase(); }

  function recount() {
    var counters = { total:app.records.size, success:0, failed:0, skipped:0 };
    app.records.forEach(function (record) { if (counters[record.status] != null) counters[record.status]++; });
    app.counters = counters;
  }

  function setPhase(phase) {
    app.phase = phase;
    updateFrogState();
  }

  // ---------------------------------------------------------------------------
  // 悬浮球状态与任务状态提示
  // ---------------------------------------------------------------------------

  function clearTerminalStatus() {
    clearTimeout(statusMorphTimer); clearTimeout(statusTuckTimer);
    frogStatus.classList.remove("show", "minimized", "ok", "warn");
    frogStatus.removeAttribute("data-status"); frogStatus.innerHTML = "";
  }

  function showTerminalStatus(kind) {
    clearTimeout(statusMorphTimer); clearTimeout(statusTuckTimer);
    frogStatus.setAttribute("data-status", kind);
    frogStatus.innerHTML = kind === "ok" ? UI_ICONS.check : UI_ICONS.warning;
    frogStatus.className = "show " + kind;
    statusMorphTimer = setTimeout(function () {
      frogStatus.classList.add("minimized");
      if (kind === "ok" || !frogSummoned) statusTuckTimer = setTimeout(function () { tuckFrog(0); }, 650);
    }, 2000);
  }

  function updateFrogState() {
    frog.classList.remove("complete", "partial", "busy");
    if (app.phase === "complete") { frog.classList.add("complete"); showTerminalStatus("ok"); frog.setAttribute("aria-label", "翻译完成"); }
    else if (app.phase === "partial" || app.phase === "error") { frog.classList.add("partial"); showTerminalStatus("warn"); frog.setAttribute("aria-label", "翻译部分完成"); }
    else if (isBusyPhase()) { clearTerminalStatus(); frog.classList.add("busy"); frog.setAttribute("aria-label", "正在翻译，点击停止"); }
    else { clearTerminalStatus(); frog.setAttribute("aria-label", "打开 Read Frog"); }
    updateActionLabels();
  }

  function updateActionLabels() {
    var busy = isBusyPhase();
    $("action-translate").querySelector(".action-label").textContent = busy ? "停止" : "翻译";
    $("action-translate").querySelector(".action-icon").innerHTML = busy ? UI_ICONS.stop : UI_ICONS.translate;
    $("action-mode").querySelector(".action-label").textContent = config.mode === "bilingual" ? "仅译文" : "双语";
  }

  function closeActions() { frogActions.classList.remove("open"); }
  function openActions() {
    clearTimeout(tuckTimer);
    frogSummoned = true; frog.classList.remove("tucked");
    frogActions.classList.toggle("below", frog.getBoundingClientRect().top < 125);
    frogActions.classList.add("open");
    updateActionLabels();
  }

  function untuckFrog(markSummoned) {
    clearTimeout(tuckTimer);
    frog.classList.remove("tucked");
    if (markSummoned) frogSummoned = true;
  }

  function tuckFrog(delay) {
    clearTimeout(tuckTimer);
    frogSummoned = false; closeActions();
    function applyTuck() {
      if (settings.classList.contains("open")) return;
      frog.classList.add("tucked");
    }
    delay = delay == null ? 1200 : delay;
    if (delay <= 0) applyTuck();
    else tuckTimer = setTimeout(applyTuck, delay);
  }

  function concealForUserScroll() {
    if (!frogSummoned || settings.classList.contains("open") || drag) return;
    tuckFrog(0);
  }

  function handleReadingScroll() {
    if (!(readingTouch && readingTouchMoved) && Date.now() > userScrollUntil) return;
    concealForUserScroll();
  }

  // ---------------------------------------------------------------------------
  // 渐进式翻译队列
  // ---------------------------------------------------------------------------

  async function processRecords(records, jobId) {
    var pending = records.slice();
    // 阅读顺序只在这里排一次，之后 takeBatch 直接从头取，避免每批重排整个队列。
    pending.sort(function (a,b) { return priority(a) - priority(b); });
    var cfg = Object.assign({}, config);
    var readyToReveal = {};
    var nextReveal = 0;
    var assignedCount = 0;
    var lanesFinished = false;
    var wakeReveal = null;

    function notifyReveal() {
      if (!wakeReveal) return;
      var wake = wakeReveal;
      wakeReveal = null;
      wake();
    }

    function waitForReveal() {
      return new Promise(function (resolve) { wakeReveal = resolve; });
    }

    function revealPause() {
      var backlog = assignedCount - nextReveal;
      // 少量结果舒缓出现；长页面积压时自动加速，避免动画拖慢整个任务。
      var delay = backlog > 40 ? 16 : backlog > 12 ? 32 : 55;
      return new Promise(function (resolve) { setTimeout(resolve, delay); });
    }

    function markReady(record, translation, error) {
      readyToReveal[record.revealOrder] = { record:record, translation:translation, error:error };
      notifyReveal();
    }

    // 网络请求继续按批次并发；渲染单独串行，避免译文成批突然跳到页面上。
    async function revealInReadingOrder() {
      while (jobId === app.jobId) {
        if (!Object.prototype.hasOwnProperty.call(readyToReveal,nextReveal)) {
          if (lanesFinished && nextReveal >= assignedCount) return;
          await waitForReveal();
          continue;
        }
        var item = readyToReveal[nextReveal];
        delete readyToReveal[nextReveal++];
        if (item.error) {
          item.record.status = "failed";
          item.record.error = item.error;
        } else {
          item.record.translation = String(item.translation || "").trim();
          item.record.status = !item.record.translation || sameText(item.record.text,item.record.translation) ? "skipped" : "success";
        }
        renderRecord(item.record);
        recount();
        if (item.record.status !== "skipped" && jobId === app.jobId) await revealPause();
      }
    }

    function takeBatch() {
      if (!pending.length) return [];
      // pending 在进入本函数前已按阅读位置排好序；这里不再每批重排
      // （每批重排整个队列是 O(n² log n) 的布局查询，长文页面会因此卡住）。
      var batch = pending.splice(0, cfg.batchSize);
      batch.forEach(function (record) { record.revealOrder = assignedCount++; });
      return batch;
    }
    async function lane() {
      while (jobId === app.jobId && app.phase !== "stopping") {
        var batch = takeBatch(); if (!batch.length) return;
        batch.forEach(function (r) { r.status = "running"; });
        try {
          var values = await translateProvider(batch.map(function (r) { return r.text; }), cfg, jobId);
          if (jobId !== app.jobId) return;
          batch.forEach(function (record,index) {
            markReady(record,values[index],null);
          });
        } catch (error) {
          if (error.kind === "abort" || jobId !== app.jobId) return;
          batch.forEach(function (record) { markReady(record,null,error); });
        }
      }
    }
    var lanes = [];
    var revealTask = revealInReadingOrder();
    for (var i=0; i<Math.min(cfg.concurrency, pending.length || 1); i++) lanes.push(lane());
    await Promise.all(lanes);
    lanesFinished = true;
    notifyReveal();
    await revealTask;
  }

  // 请求执行期间产生的页面变化先合并记录，在当前批次结束后统一处理，
  // 既不会漏掉无限滚动内容，也不会创建相互竞争的翻译任务。
  // initialRoots 为 null 表示全页扫描（首次或需要兜底），否则只扫给定子树；
  // 一轮扫描达到"每轮上限"时会设置 app.roundPending，这里继续下一轮，因此超长页面
  // 会被分成多轮处理并最终全部翻译完，而不是卡在 500 段。
  async function processNewRecords(jobId, initialRoots) {
    var firstPass = true;
    while (jobId === app.jobId && (firstPass || app.rescanPending || app.roundPending)) {
      var continuingRound = !firstPass && app.roundPending;
      // 任务执行期间到达的变化单独累积在 app.mutationScope 里；它必须和首轮的根一起处理，
      // 否则"忙碌期间新增的内容"会在这一次循环里被丢掉（严格递增的页面会永久漏译）。
      var extra = minimizeScanRoots(app.mutationScope);
      app.mutationScope = null;
      var roots;
      if (firstPass) roots = combineScanRoots(initialRoots, extra);
      // 达到"每轮上限"而继续分轮时，剩余候选散布在全页各处，必须继续全页扫描。
      else if (continuingRound) roots = null;
      else roots = extra;
      firstPass = false;
      app.rescanPending = false;
      var added = scanNewRecords(roots);
      if (added.length) await processRecords(added, jobId);
      if (!added.length && !app.rescanPending) break;
    }
  }

  async function startTranslation(onlyRecords) {
    // 正文尚未出现时用户可能先点击。保留一次启动意图，等 body 到来再扫描。
    if (!document.body) {
      if (pendingStart || isBusyPhase()) return;
      try { validateConfig(config); } catch (error) { openSettings(); showSettingsStatus(error.message, true); return; }
      pendingStart = true;
      setPhase("scanning");
      bodyReadyHandler = function () {
        if (!pendingStart) return;
        pendingStart = false;
        app.phase = "idle";
        startTranslation(onlyRecords);
      };
      return;
    }
    if (isBusyPhase()) return;
    try { validateConfig(config); } catch (error) { openSettings(); showSettingsStatus(error.message, true); return; }
    app.active = true; var jobId = ++app.jobId;
    app.deferredCandidates = null;
    startObserver();
    setPhase("scanning");
    var records;
    if (onlyRecords) records = onlyRecords.filter(function (record) { return record.element.isConnected; });
    else {
      scanNewRecords(); records = [];
      app.records.forEach(function (record) {
        if (record.status === "pending" || record.status === "running" || record.status === "failed") {
          record.status = "pending"; records.push(record);
        }
      });
      records.sort(function (a,b) { return priority(a)-priority(b); });
    }
    recount();
    if (!records.length) {
      // 首轮可能已经达到"每轮上限"，剩余候选交给 processNewRecords 继续分轮处理。
      if (app.roundPending) { setPhase("translating"); await processNewRecords(jobId, null); }
      if (jobId !== app.jobId) return;
      recount();
      setPhase(app.counters.failed ? "partial" : "complete");
      return;
    }
    setPhase("translating");
    await processRecords(records, jobId);
    if (jobId !== app.jobId) return;
    await processNewRecords(jobId, null);
    if (jobId !== app.jobId) return;
    recount();
    if (app.counters.failed) setPhase("partial");
    else setPhase("complete");
    if (app.retryQueue.size) {
      var queued = Array.from(app.retryQueue); app.retryQueue.clear();
      await startTranslation(queued);
    }
  }

  function stopTranslation() {
    if (["scanning","translating"].indexOf(app.phase) < 0) return;
    pendingStart = false; bodyReadyHandler = null;
    app.phase = "stopping"; app.jobId++;
    app.requests.forEach(function (handle) { try { if (handle.abort) handle.abort(); } catch (_) {} });
    app.requests.clear();
    app.records.forEach(function (record) { if (record.status === "running") record.status = "pending"; });
    recount(); setPhase("partial");
  }

  function restorePage() {
    pendingStart = false; bodyReadyHandler = null;
    stopTranslation(); app.active = false; app.rescanPending = false; app.roundPending = false; app.deferredCandidates = null; app.mutationScope = null; stopObserver();
    app.records.forEach(cleanupRecord); app.records.clear(); app.counters = emptyCounters();
    // 候选扫描可能包装了尚未进入队列的交互文字，恢复时也必须一并还原。
    Array.prototype.slice.call(document.querySelectorAll("." + SOURCE_SEGMENT_CLASS)).forEach(unwrapSourceSegment);
    Array.prototype.slice.call(document.querySelectorAll("." + UI_LABEL_CLASS)).forEach(function (node) { node.classList.remove(UI_LABEL_CLASS); });
    setPhase("idle");
  }

  async function retryRecord(record) {
    if (!record.element.isConnected) return;
    if (isBusyPhase()) {
      app.retryQueue.add(record); return;
    }
    clearRecordRendering(record); record.status = "pending"; record.error = null;
    var jobId = ++app.jobId; setPhase("translating");
    await processRecords([record], jobId);
    if (jobId !== app.jobId || !app.active) return;
    recount();
    setPhase(record.status === "success" || record.status === "skipped" ? "complete" : "partial");
  }

  // 判断一批 mutation 是否值得重新扫描：
  //   - 纯文本替换（childList 里只有文本节点）、characterData 改写都要算"内容变化"，
  //     否则 textContent/innerText 重写、React/Vue 重渲染都会漏掉；
  //   - 脚本自己插入的译文节点与临时包装 span 必须排除，否则会自触发。
  function mutationIsRelevant(m) {
    if (m.type === "characterData") return !!(m.target && m.target.nodeValue && m.target.nodeValue.trim());
    // 属性变化只看"会影响可翻译文字"的白名单（见 observe 的 attributeFilter）：
    // <details open> 展开、hidden 切换、placeholder/title 改动都算内容变化；class/style 的动画噪声不算。
    if (m.type === "attributes") return true;
    if (m.type !== "childList") return false;
    var added = m.addedNodes;
    for (var i = 0; i < added.length; i++) {
      var node = added[i];
      if (node.nodeType === 3) {
        if (node.nodeValue && node.nodeValue.trim()) return true;
        continue;
      }
      if (node.nodeType !== 1) continue;
      if (node.classList && (node.classList.contains(TRANSLATION_CLASS) || node.classList.contains(SOURCE_SEGMENT_CLASS))) continue;
      return true;
    }
    return false;
  }

  // 记录"哪些子树变了"，用于把扫描范围从整页缩小到真正变化的子树。
  function collectMutationScope(mutations) {
    if (!app.mutationScope) app.mutationScope = new Set();
    function addElement(node) {
      if (!node || node.nodeType !== 1 || !node.isConnected) return;
      if (node.classList && (node.classList.contains(TRANSLATION_CLASS) || node.classList.contains(SOURCE_SEGMENT_CLASS))) return;
      app.mutationScope.add(node);
    }
    mutations.forEach(function (m) {
      if (m.type === "characterData") {
        var target = m.target;
        addElement(target && target.nodeType === 1 ? target : (target && target.parentElement));
        return;
      }
      if (m.type === "attributes") { addElement(m.target); return; }
      if (m.type !== "childList") return;
      // 若这次变更只是"插入了一个元素"，扫描那个元素所在的子树就够了；
      // 只有当被打断的是文本（文本节点插入或 textContent 重写）时，才需要连同其父节点一起扫。
      var hasElementAdd = false, hasTextChange = false;
      Array.prototype.forEach.call(m.addedNodes, function (node) {
        if (node.nodeType === 3) {
          if (node.nodeValue && node.nodeValue.trim()) hasTextChange = true;
          return;
        }
        if (node.nodeType !== 1) return;
        if (node.classList && (node.classList.contains(TRANSLATION_CLASS) || node.classList.contains(SOURCE_SEGMENT_CLASS))) return;
        hasElementAdd = true;
        addElement(node);
      });
      if (hasTextChange || !hasElementAdd) {
        var parent = m.target;
        addElement(parent && parent.nodeType === 1 ? parent : (parent && parent.parentElement));
      }
    });
  }

  // 防抖 + 最大等待：页面持续以快于防抖窗口的节奏变化时，也必须至少每 MUTATION_MAX_WAIT ms
  // 处理一次已积累的变化，否则聊天/直播弹幕/行情类页面会永远等不到扫描（防抖饥饿）。
  function scheduleMutationScan() {
    var now = Date.now();
    if (!app.mutationFirstAt) app.mutationFirstAt = now;
    var waited = now - app.mutationFirstAt;
    var delay = Math.min(MUTATION_DEBOUNCE, Math.max(0, MUTATION_MAX_WAIT - waited));
    clearTimeout(app.mutationTimer);
    app.mutationTimer = setTimeout(async function () {
      app.mutationTimer = 0;
      app.mutationFirstAt = 0;
      if (!app.active) return;
      // 上一個任务还在跑：等它结束再扫，避免用 ++jobId 把正在进行的任务打断。
      if (isBusyPhase()) { app.rescanPending = true; scheduleMutationScan(); return; }
      var roots = minimizeScanRoots(app.mutationScope);
      app.mutationScope = null;
      var jobId = ++app.jobId; setPhase("translating");
      await processNewRecords(jobId, roots);
      if (jobId !== app.jobId || !app.active) return;
      recount();
      setPhase(app.counters.failed ? "partial" : "complete");
    }, Math.max(0, delay));
  }

  function startObserver() {
    if (app.observer || !document.body) return;
    app.observer = new MutationObserver(function (mutations) {
      if (!app.active) return;
      if (!mutations.some(mutationIsRelevant)) return;
      collectMutationScope(mutations);
      // 任务进行中也要安排一次"兜底扫描"：否则忙碌期间到达的变化可能没人接手。
      if (isBusyPhase()) { app.rescanPending = true; scheduleMutationScan(); return; }
      scheduleMutationScan();
    });
    app.observer.observe(document.body, {
      childList:true,
      subtree:true,
      characterData:true,
      attributes:true,
      // 只观察会影响"可翻译文字"的属性，避免 class/style 的动画与选中态噪声。
      attributeFilter:["placeholder","value","open","hidden","aria-hidden","contenteditable","title","alt"]
    });
  }

  function stopObserver() {
    if (app.observer) app.observer.disconnect();
    app.observer = null;
    clearTimeout(app.mutationTimer);
    app.mutationTimer = 0;
    app.mutationFirstAt = 0;
  }

  function applyMode(mode) {
    saveConfig({ mode:mode });
    app.records.forEach(function (record) { if (record.status === "success" || record.status === "failed") renderRecord(record); });
    updateActionLabels();
  }

  // 自动翻译只按当前 hostname 精确匹配。配置无效时保持安静，避免每次打开网站都弹出设置。
  function startAutomaticTranslation() {
    if (!autoTranslateEnabled(config) || isBusyPhase()) return;
    try { validateConfig(config); } catch (_) { return; }
    startTranslation();
  }

  // 每次打开设置都从已保存配置重新填充，未保存的编辑不会影响当前配置。
  function showSettingsStatus(text, error) { settingsStatus.textContent = text; settingsStatus.style.color = error ? "#bd443c" : ""; }
  function openSettings() { frogSummoned=false; closeActions(); untuckFrog(false); fillForm(); showSettingsStatus("", false); settings.classList.add("open"); backdrop.classList.add("open"); }
  function closeSettings() { settings.classList.remove("open"); backdrop.classList.remove("open"); tuckFrog(1000); }

  async function testService() {
    var draft = readForm(); showSettingsStatus("正在连接服务…", false);
    try { validateConfig(draft); var value = (await translateProvider(["Hello, world!"], draft, null, true))[0]; showSettingsStatus("连接成功：" + value, false); }
    catch (error) { showSettingsStatus("测试失败：" + error.message, true); }
  }

  // ---------------------------------------------------------------------------
  // 拖动、贴边、半隐藏与长按交互
  // ---------------------------------------------------------------------------

  function positionFrog() {
    var y = clamp(config.buttonY, .12, .84) * innerHeight;
    var buttonTop = Math.round(clamp(y, 58, innerHeight - 80));
    frogDock.style.top = (buttonTop - 10) + "px";
    frogDock.style.width = "70px"; frogDock.style.height = "70px";
    frogDock.classList.toggle("side-left", config.buttonSide === "left");
    frogDock.classList.toggle("side-right", config.buttonSide === "right");
    frog.style.top = "10px"; frog.style.left = ""; frog.style.right = "";
  }

  var drag = null;
  function dragStart(event) {
    var point = event.touches ? event.touches[0] : event;
    clearTimeout(tuckTimer); clearTimeout(longPressTimer);
    drag = { x:point.clientX, y:point.clientY, startX:point.clientX, startY:point.clientY, moved:false, longPressed:false, wasTucked:frog.classList.contains("tucked") };
    frog.classList.remove("tucked");
    longPressTimer = setTimeout(function () {
      if (!drag || drag.moved) return;
      drag.longPressed = true; openActions();
      try { if (navigator.vibrate) navigator.vibrate(18); } catch (_) {}
    }, 520);
  }
  function dragMove(event) {
    if (!drag) return; var point = event.touches ? event.touches[0] : event;
    if (Math.abs(point.clientX-drag.startX)+Math.abs(point.clientY-drag.startY) > 8) { drag.moved = true; clearTimeout(longPressTimer); closeActions(); }
    if (!drag.moved) return; if (event.cancelable) event.preventDefault();
    frogDock.classList.remove("side-left", "side-right");
    frogDock.style.width = "70px"; frogDock.style.height = "70px";
    frogDock.style.left = clamp(point.clientX-35, -10, innerWidth-60) + "px"; frogDock.style.right = "auto";
    frogDock.style.top = clamp(point.clientY-35, 38, innerHeight-82) + "px";
    frog.style.left = "10px"; frog.style.right = "auto"; frog.style.top = "10px";
  }
  function dragEnd(event) {
    clearTimeout(longPressTimer);
    if (!drag) return; var wasMoved = drag.moved; var wasTucked = drag.wasTucked; var wasLongPressed = drag.longPressed; drag = null;
    if (wasLongPressed) return;
    if (wasMoved) {
      var rect = frog.getBoundingClientRect(); var side = rect.left + rect.width/2 < innerWidth/2 ? "left" : "right";
      saveConfig({ buttonSide:side, buttonY:clamp((rect.top+25)/innerHeight,.12,.84) }); frogDock.style.left=""; frogDock.style.right=""; positionFrog();
      tuckFrog(1400);
    } else {
      if (wasTucked) untuckFrog(true);
      else if (isBusyPhase()) stopTranslation();
      else startTranslation();
    }
  }
  frog.addEventListener("touchstart", function (event) { lastTouchAt=Date.now(); dragStart(event); }, { passive:true }); frog.addEventListener("touchmove", dragMove, { passive:false }); frog.addEventListener("touchend", dragEnd);
  frog.addEventListener("mousedown", function (event) { if (Date.now()-lastTouchAt>700) dragStart(event); }); document.addEventListener("mousemove", dragMove); document.addEventListener("mouseup", dragEnd);
  frog.addEventListener("contextmenu", function (event) { event.preventDefault(); });
  document.addEventListener("click", function (event) { if (frogSummoned && event.target !== host && !host.contains(event.target) && !settings.classList.contains("open")) tuckFrog(700); }, true);
  document.addEventListener("touchstart", function (event) {
    if (event.target === host || host.contains(event.target) || settings.classList.contains("open")) return;
    readingTouch = true; readingTouchMoved = false;
  }, { capture:true, passive:true });
  document.addEventListener("touchmove", function () {
    if (!readingTouch) return;
    readingTouchMoved = true; userScrollUntil = Date.now() + 1200; concealForUserScroll();
  }, { capture:true, passive:true });
  document.addEventListener("touchend", function () { readingTouch = false; }, { capture:true, passive:true });
  window.addEventListener("wheel", function () { userScrollUntil=Date.now()+420; concealForUserScroll(); }, { passive:true });
  window.addEventListener("scroll", handleReadingScroll, { passive:true });
  document.addEventListener("scroll", handleReadingScroll, true);
  window.addEventListener("resize", positionFrog);

  $("action-translate").addEventListener("click", function () {
    closeActions();
    if (isBusyPhase()) stopTranslation();
    else { frogSummoned=true; startTranslation(); }
  });
  $("action-mode").addEventListener("click", function () { applyMode(config.mode === "bilingual" ? "translation" : "bilingual"); });
  $("action-restore").addEventListener("click", function () { closeActions(); restorePage(); tuckFrog(500); });
  $("action-settings").addEventListener("click", openSettings);
  $("settings-close").addEventListener("click", closeSettings); backdrop.addEventListener("click", closeSettings);
  $("service").addEventListener("change", function () { updateServiceFields(true); });
  $("language").addEventListener("change", function () { $("custom-language").style.display = this.value === "custom" ? "block" : "none"; });
  $("endpoint").addEventListener("input", updateEndpointPreview);
  $("key-toggle").addEventListener("click", function () { setApiKeyVisible($("api-key").type === "password"); });
  $("key-clear").addEventListener("click", function () { $("api-key").value = ""; $("api-key").focus(); });
  $("save").addEventListener("click", function () {
    var wasAutomatic=autoTranslateEnabled(config), next = readForm();
    try {
      validateConfig(next); saveConfig(next); applyMode(next.mode); showSettingsStatus("设置已保存", false);
      var startNow=!wasAutomatic && autoTranslateEnabled(config);
      setTimeout(function () { closeSettings(); if (startNow) setTimeout(startAutomaticTranslation,180); }, 450);
    }
    catch (error) { showSettingsStatus(error.message, true); }
  });
  $("test").addEventListener("click", testService);

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("翻译当前网页", function () { startTranslation(); });
    GM_registerMenuCommand("停止翻译", stopTranslation);
    GM_registerMenuCommand("打开 Read Frog 设置", openSettings);
    GM_registerMenuCommand("恢复原文", restorePage);
  }

  applyDynamicPalette();
  if (window.matchMedia) {
    var colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    if (colorScheme.addEventListener) colorScheme.addEventListener("change", applyDynamicPalette);
    else if (colorScheme.addListener) colorScheme.addListener(applyDynamicPalette);
  }
  fillForm(); positionFrog(); updateFrogState(); frog.classList.add("tucked");
  setTimeout(startAutomaticTranslation, 280);
  }
})();
