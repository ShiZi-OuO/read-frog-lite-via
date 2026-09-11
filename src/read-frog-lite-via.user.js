// ==UserScript==
// @name         Read Frog Lite for Via
// @namespace    https://github.com/ShiZi-OuO/read-frog-lite-via
// @version      1.1.0
// @description  为 Via 优化的移动端网页翻译：渐进式翻译、原文切换、自动翻译与多服务支持
// @author       Read Frog contributors; Modified for Via Browser by shizi
// @license      GPL-3.0-only
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
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

  if (window.top !== window.self || document.getElementById("rf-via-host")) return;

  // ---------------------------------------------------------------------------
  // 配置与持久化状态
  // ---------------------------------------------------------------------------

  var VERSION = "1.1.0";
  var CONFIG_KEY = "read_frog_via_config_v2";
  var OLD_CONFIG_KEY = "read_frog_via_config_v1";
  var MAX_PARAGRAPHS = 500;
  var MAX_TEXT_LENGTH = 5000;
  var REQUEST_TIMEOUT = 60000;
  var TRANSLATION_CLASS = "rf-via-translation";
  var SOURCE_SEGMENT_CLASS = "rf-via-source-segment";
  var INTERACTIVE_SEGMENT_CLASS = "rf-via-interactive-segment";

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
    cache: new Map(),
    retryQueue: new Set(),
    counters: emptyCounters(),
    rescanPending: false,
    mutationTimer: 0,
    observer: null
  };

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

  var host = document.createElement("div");
  host.id = "rf-via-host";
  host.style.cssText = "position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;z-index:2147483647!important;pointer-events:none!important;";
  document.documentElement.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode:"open" }) : host;
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

  function httpError(status, body) {
    var messages = {
      401:"API Key 无效或已过期", 403:"接口拒绝访问，请检查权限或地区限制",
      404:"接口路径不存在，请检查服务和地址", 429:"请求过于频繁或额度不足，请稍后重试"
    };
    var message = messages[status] || (status >= 500 ? "服务暂时不可用，请稍后重试" : "接口返回 HTTP " + status);
    var error = new Error(message + (body ? " · " + String(body).slice(0, 120) : ""));
    error.kind = "http"; error.status = status;
    return error;
  }

  function requestError(message, kind) {
    var error = new Error(message);
    error.kind = kind;
    return error;
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
      function done(status, text) {
        status = Number(status || 0);
        if (status < 200 || status >= 300) return finish(reject, httpError(status, text));
        finish(resolve, String(text || ""));
      }
      if (typeof GM_xmlhttpRequest === "function") {
        try {
          handle = GM_xmlhttpRequest({
            method:"POST", url:url, headers:headers, data:body, timeout:REQUEST_TIMEOUT,
            onload:function (r) { done(r.status, r.responseText); },
            onerror:function (r) {
              if (Number(r && r.status) > 0) return done(r.status, r.responseText);
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
          .then(function (r) { return r.text().then(function (text) { done(r.status, text); }); })
          .catch(function (original) {
            var aborted = original && original.name === "AbortError";
            finish(reject, requestError(aborted ? "请求已取消" : "网络请求失败，页面可能受到跨域限制", aborted ? "abort" : "network"));
          });
      }
    });
    return promise;
  }

  function escapeHtml(text) { return String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function decodeHtml(text) { var area = document.createElement("textarea"); area.innerHTML = text; return area.value; }

  async function microsoftTranslate(texts, cfg, jobId) {
    var to = normalizeLanguage(cfg.targetLanguage);
    if (!/^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(to)) throw new Error("Microsoft 无法识别目标语言，请使用语言代码");
    var url = "https://edge.microsoft.com/translate/translatetext?from=&to=" + encodeURIComponent(to) + "&isEnterpriseClient=false";
    var raw = await requestRaw(url, { "Content-Type":"application/json" }, JSON.stringify(texts.map(escapeHtml)), jobId);
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
    var system = "You are a professional " + target + " translator. Translate naturally and accurately. Preserve meaning, tone, names, code, URLs and numbers. Return only valid JSON: an array of exactly " + texts.length + " translated strings in the same order. No Markdown or explanations. Webpage title: " + document.title.slice(0,300);
    return [{ role:"system", content:system }, { role:"user", content:JSON.stringify(texts) }];
  }

  async function aiTranslate(texts, cfg, jobId) {
    var messages = translationMessages(texts, cfg);
    var body = JSON.stringify({ model:cfg.model, messages:messages, temperature:0.2, stream:false });
    var raw = await requestRaw(resolvedEndpoint(cfg), { "Content-Type":"application/json", "Authorization":"Bearer " + cfg.apiKey }, body, jobId);
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

  async function translateProvider(texts, cfg, jobId, bypassCache) {
    var keys = texts.map(function (text) { return [cfg.service,cfg.endpoint,cfg.model,cfg.apiKey,cfg.targetLanguage,text].join("\n"); });
    var values = new Array(texts.length);
    var missingTexts = [];
    var missingIndexes = [];

    // 按段复用缓存；即使一个批次只有部分内容命中缓存，也不重复消耗其翻译额度。
    texts.forEach(function (text, index) {
      if (!bypassCache && app.cache.has(keys[index])) values[index] = app.cache.get(keys[index]);
      else { missingTexts.push(text); missingIndexes.push(index); }
    });
    if (!missingTexts.length) return values;

    var translated;
    if (cfg.service === "microsoft") translated = await microsoftTranslate(missingTexts, cfg, jobId);
    else {
      try { translated = await aiTranslate(missingTexts, cfg, jobId); }
      catch (error) {
        if (error.kind !== "format" || missingTexts.length === 1) throw error;
        translated = [];
        for (var i = 0; i < missingTexts.length; i++) translated.push((await aiTranslate([missingTexts[i]], cfg, jobId))[0]);
      }
    }
    missingIndexes.forEach(function (originalIndex, translatedIndex) {
      values[originalIndex] = translated[translatedIndex];
      if (!bypassCache) app.cache.set(keys[originalIndex], translated[translatedIndex]);
    });
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
  function isExcluded(element) { return !!element.closest("script,style,noscript,svg,canvas,video,audio,textarea,input,select,button,pre,code,[contenteditable='true'],nav,footer,header,aside,form,dialog,[role='navigation'],[role='toolbar'],[role='tablist'],[role='menu'],[role='menubar'],[role='button'],[aria-hidden='true'],#rf-via-host,." + TRANSLATION_CLASS); }

  // 链接、按钮等控件只翻译可见文字节点，不能替换控件本身，否则会丢失图标、事件或跳转能力。
  function isUnsafeInteractiveSegment(element) {
    return !!element.closest("script,style,noscript,svg,canvas,video,audio,textarea,input,select,pre,code,[contenteditable='true'],[aria-hidden='true'],#rf-via-host,." + TRANSLATION_CLASS);
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

  function interfaceMarker(element, root) {
    var cursor=element;
    while (cursor && cursor !== root && cursor !== document.body) {
      var marker=((typeof cursor.className === "string" ? cursor.className : "") + " " + (cursor.id || "") + " " + (cursor.getAttribute("aria-label") || "")).toLowerCase();
      if (/(^|[\s_-])(toolbar|breadcrumb|navbar|navigation|tabs?|controls?|actions?|pagination|sidebar|metadata|meta-row|stats?|command|menu)([\s_-]|$)/.test(marker)) return true;
      cursor=cursor.parentElement;
    }
    return false;
  }

  function interactiveDensity(element, text) {
    var controls=element.querySelectorAll("a,button,input,select,textarea,[role='button'],[role='link']");
    if (!controls.length) return 0;
    var interactiveText=0;
    Array.prototype.forEach.call(controls,function (node) { interactiveText += normalizedText(node).length; });
    return Math.min(1, interactiveText / Math.max(1,text.length));
  }

  function isLikelyInterface(element, root) {
    if (interfaceMarker(element,root)) return true;
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

  function wrapInteractiveText() {
    var wrappers=[];
    var controls=document.querySelectorAll("a,button,[role='link'],[role='button']");
    Array.prototype.forEach.call(controls,function (control) {
      if (!isVisible(control) || control.closest("#rf-via-host,." + TRANSLATION_CLASS)) return;
      function visit(node) {
        if (node.nodeType === 3) {
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
            /^(SCRIPT|STYLE|NOSCRIPT|SVG|CANVAS|VIDEO|AUDIO|TEXTAREA|INPUT|SELECT|PRE|CODE)$/.test(node.tagName) ||
            node.getAttribute("aria-hidden") === "true" || node.getAttribute("contenteditable") === "true") return;
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
        element.isContentEditable || element.closest("#rf-via-host,." + TRANSLATION_CLASS)) return null;
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
      else if (!info.inline && hasInlineContent && hasBlockContent) {
        // 与上游 translateWalkedElement 的连续行内运行一致：不能丢掉块节点之间的署名、日期或裸文本。
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
        if (!parent || !isVisible(parent) || parent.closest("a,button,[role='link'],[role='button']")) return;
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
          node.getAttribute("aria-hidden") === "true") return;
      Array.prototype.slice.call(node.childNodes).forEach(visit);
    }
    Array.prototype.slice.call(element.childNodes).forEach(visit);
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
    wrapInteractiveText().forEach(add);
    Array.prototype.forEach.call(document.querySelectorAll("." + INTERACTIVE_SEGMENT_CLASS),add);
    return result;
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

  function scanNewRecords() {
    discardDetachedRecords();
    var added = [], roots=readingRoots();
    var candidates=candidateElements(roots);
    candidates.sort(function (a,b) {
      var distance=elementPriority(a)-elementPriority(b);
      return Math.abs(distance) > 1 ? distance : documentOrder(a,b);
    });
    candidates.some(function (element) {
      if (app.records.size >= MAX_PARAGRAPHS) return true;
      var root=rootForElement(element, roots);
      var interactive=element.classList.contains(INTERACTIVE_SEGMENT_CLASS);
      if ((interactive ? isUnsafeInteractiveSegment(element) : isExcluded(element)) ||
          (!interactive && interfaceMarker(element,root)) || !isVisible(element) ||
          (!interactive && config.mode === "translation" && hasProtectedContent(element)) ||
          (element.matches("li") && element.querySelector("li"))) return false;
      var existing = app.records.get(element);
      if (existing) return false;
      var covered=false;
      app.records.forEach(function (record) {
        if (!covered && record.element !== element && record.element.contains(element)) covered=true;
      });
      if (covered) return false;
      // inline 元素的 innerText 在部分 Chromium/WebView 中会扩展到整行兄弟节点；包装段必须只读自身文本。
      var text = element.classList.contains(SOURCE_SEGMENT_CLASS)
        ? (element.textContent || "").replace(/\s+/g," ").trim()
        : normalizedText(element);
      if (text.length < 2 || text.length > MAX_TEXT_LENGTH || !/[A-Za-z0-9\u00c0-\uffff]/.test(text)) return false;
      var rawText=element.textContent || "";
      var record = { element:element, text:text, status:"pending", translation:"", node:null, error:null, originalFragment:null,
        synthetic:element.classList.contains(SOURCE_SEGMENT_CLASS), interactive:interactive,
        leadingSpace:interactive ? (rawText.match(/^\s*/) || [""])[0] : "",
        trailingSpace:interactive ? (rawText.match(/\s*$/) || [""])[0] : "",
        placement:interactive ? "after" : bilingualPlacement(element) };
      app.records.set(element, record); added.push(record);
      return false;
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
    if (record.originalFragment) {
      while (record.element.firstChild) record.element.removeChild(record.element.firstChild);
      record.element.appendChild(record.originalFragment);
      record.originalFragment = null;
    }
  }

  function replaceSource(record) {
    var fragment = document.createDocumentFragment();
    while (record.element.firstChild) fragment.appendChild(record.element.firstChild);
    record.originalFragment = fragment;
    record.element.textContent = record.leadingSpace + record.translation + record.trailingSpace;
  }

  function renderRecord(record) {
    if (!record.element.isConnected) return;
    showSource(record);
    if (record.node) record.node.remove();
    record.node = null;
    if (record.status === "skipped" || record.status === "pending" || record.status === "running") return;
    if (record.status === "success" && config.mode === "translation") {
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
    var cfg = Object.assign({}, config);
    function takeBatch() {
      if (!pending.length) return [];
      pending.sort(function (a,b) { return priority(a) - priority(b); });
      return pending.splice(0, cfg.batchSize);
    }
    async function lane() {
      while (jobId === app.jobId && app.phase !== "stopping") {
        var batch = takeBatch(); if (!batch.length) return;
        batch.forEach(function (r) { r.status = "running"; });
        try {
          var values = await translateProvider(batch.map(function (r) { return r.text; }), cfg, jobId);
          if (jobId !== app.jobId) return;
          batch.forEach(function (record,index) {
            record.translation = values[index].trim();
            record.status = !record.translation || sameText(record.text, record.translation) ? "skipped" : "success";
            renderRecord(record);
          });
        } catch (error) {
          if (error.kind === "abort" || jobId !== app.jobId) return;
          batch.forEach(function (record) { record.status = "failed"; record.error = error; renderRecord(record); });
        }
        recount();
      }
    }
    var lanes = [];
    for (var i=0; i<Math.min(cfg.concurrency, pending.length || 1); i++) lanes.push(lane());
    await Promise.all(lanes);
  }

  // 请求执行期间产生的页面变化先合并记录，在当前批次结束后统一处理，
  // 既不会漏掉无限滚动内容，也不会创建相互竞争的翻译任务。
  async function processNewRecords(jobId) {
    var firstPass = true;
    while (jobId === app.jobId && (firstPass || app.rescanPending)) {
      firstPass = false;
      app.rescanPending = false;
      var added = scanNewRecords();
      if (added.length) await processRecords(added, jobId);
    }
  }

  async function startTranslation(onlyRecords) {
    if (isBusyPhase()) return;
    try { validateConfig(config); } catch (error) { openSettings(); showSettingsStatus(error.message, true); return; }
    app.active = true; var jobId = ++app.jobId;
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
    if (!records.length) { setPhase("complete"); return; }
    setPhase("translating");
    await processRecords(records, jobId);
    if (jobId !== app.jobId) return;
    await processNewRecords(jobId);
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
    app.phase = "stopping"; app.jobId++;
    app.requests.forEach(function (handle) { try { if (handle.abort) handle.abort(); } catch (_) {} });
    app.requests.clear();
    app.records.forEach(function (record) { if (record.status === "running") record.status = "pending"; });
    recount(); setPhase("partial");
  }

  function restorePage() {
    stopTranslation(); app.active = false; app.rescanPending = false; stopObserver();
    app.records.forEach(cleanupRecord); app.records.clear(); app.counters = emptyCounters();
    // 候选扫描可能包装了尚未进入队列的交互文字，恢复时也必须一并还原。
    Array.prototype.slice.call(document.querySelectorAll("." + SOURCE_SEGMENT_CLASS)).forEach(unwrapSourceSegment);
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

  function startObserver() {
    if (app.observer || !document.body) return;
    app.observer = new MutationObserver(function (mutations) {
      var relevant = mutations.some(function (m) { return Array.prototype.some.call(m.addedNodes, function (n) { return n.nodeType === 1 && !(n.classList && n.classList.contains(TRANSLATION_CLASS)); }); });
      if (!relevant || !app.active) return;
      if (isBusyPhase()) { app.rescanPending = true; return; }
      clearTimeout(app.mutationTimer);
      app.mutationTimer = setTimeout(async function () {
        app.mutationTimer = 0;
        var added = scanNewRecords(); if (!added.length) return;
        var jobId = ++app.jobId; setPhase("translating"); await processRecords(added, jobId);
        if (jobId !== app.jobId || !app.active) return;
        recount();
        setPhase(app.counters.failed ? "partial" : "complete");
      }, 700);
    });
    app.observer.observe(document.body, { childList:true, subtree:true });
  }

  function stopObserver() { if (app.observer) app.observer.disconnect(); app.observer = null; clearTimeout(app.mutationTimer); app.mutationTimer = 0; }

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
})();
