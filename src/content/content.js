/*
 * BilibiliToys 内容脚本。
 *
 * SPDX-License-Identifier: MIT
 * 版权所有 (c) 2026 BilibiliToys 贡献者
 *
 * 功能行为来自对 Better Bilibili 2026.02.13 与 Bilibili Player Extension
 * 3.0.2 CRX 包的审阅结果。下面的实现是 BilibiliToys 的模块化重写，
 * 带有注释，并不是直接复制压缩后的原始脚本。
 */

(function () {
  "use strict";

  const CONFIG = globalThis.BilibiliToysConfig;
  const PAGE_AGENT_ID = "bilibili-toys-page-agent";
  const PAGE_CONFIG_EVENT = "BilibiliToysPageConfig";
  const RUNTIME_STYLE_ID = "bilibili-toys-dynamic-style";
  const OBSERVER_DEBOUNCE_MS = 350;

  /*
   * 内容脚本维护的运行时状态。这些值刻意限定在当前标签页内：
   * 设置保存在 chrome.storage 中，而 DOM 观察器和防抖计时器需要随页面重新创建。
   */
  let config = CONFIG.normalizeConfig();
  let domObserver = null;
  let scanTimer = 0;
  let currentUrl = location.href;
  let lastVideo = null;
  let overlayTimers = new Map();
  let videoScaleIndex = 2;
  let appliedDanmakuOffKey = "";
  let appliedViewModeKey = "";
  let smartLightObserver = null;
  let smartLightTarget = null;
  let homeInitialScanDone = false;
  let playInitialScanDone = false;
  let lastCaptionText = "";

  const VIDEO_SCALES = [0.5, 0.75, 1];

  /*
   * B 站首页、搜索页和不同播放器版本的类名会变化。
   * 每组选择器都从最具体到兜底项排序，以兼容新旧播放器布局。
   */
  const selectors = {
    video: [
      "#bilibiliPlayer video",
      "#bilibili-player video",
      ".bilibili-player video",
      ".player-container video",
      "#bofqi video",
      "[aria-label=\"哔哩哔哩播放器\"] video",
      ".bpx-player-video-wrap video",
      "#bilibiliPlayer bwp-video",
      "#bilibili-player bwp-video",
      ".bilibili-player bwp-video",
      ".player-container bwp-video",
      "video"
    ],
    card: [
      ".bili-video-card",
      ".feed-card",
      ".card-box",
      ".bili-live-card",
      ".floor-single-card"
    ],
    homeContainer: [
      ".feed2 > div > .container",
      ".bili-feed4-layout",
      ".bili-grid",
      ".container",
      "main"
    ],
    authorLink: [
      "a.bili-video-card__info--owner",
      ".bili-video-card__info--author",
      ".upname a",
      "a[href*='space.bilibili.com']",
      "a[href*='mid=']"
    ],
    titleLink: [
      "h3 a",
      ".bili-video-card__info--tit a",
      ".title a",
      "a[href*='/video/']"
    ],
    danmakuButton: [
      ".bpx-player-dm-switch input[type='checkbox']",
      ".bpx-player-dm-switch",
      ".bilibili-player-video-danmaku-switch input[type='checkbox']",
      ".bilibili-player-video-btn-danmaku"
    ],
    fullscreenButton: [
      ".bpx-player-ctrl-full",
      ".bilibili-player-video-btn-fullscreen"
    ],
    webFullscreenButton: [
      ".bpx-player-ctrl-web",
      ".bilibili-player-video-web-fullscreen",
      ".bilibili-player-video-btn-web-fullscreen"
    ],
    wideButton: [
      ".bpx-player-ctrl-wide",
      ".bilibili-player-video-btn-widescreen"
    ],
    playButton: [
      ".bpx-player-ctrl-play",
      ".bilibili-player-video-btn-start"
    ],
    muteButton: [
      ".bpx-player-ctrl-volume",
      ".bilibili-player-video-btn-volume"
    ],
    nextButton: [
      ".bpx-player-ctrl-next",
      ".bilibili-player-video-btn-next"
    ],
    lightButton: [
      ".bpx-player-ctrl-light",
      ".bpx-player-ctrl-light-off",
      ".bilibili-player-video-btn-light",
      "[aria-label*='关灯']",
      "[aria-label*='开灯']",
      "[title*='关灯']",
      "[title*='开灯']"
    ],
    subtitleButton: [
      ".bpx-player-ctrl-subtitle",
      ".bpx-player-ctrl-subtitle-close-switch",
      "[aria-label*='字幕']",
      "[title*='字幕']"
    ],
    subtitleCloseSwitch: [
      ".bpx-player-ctrl-subtitle-close-switch"
    ],
    subtitleLanguageItem: [
      ".bpx-player-ctrl-subtitle-major .bpx-player-ctrl-subtitle-language-item"
    ],
    playerContainer: [
      "#bilibili-player",
      ".player-container",
      "#bofqi",
      ".bpx-player-container",
      ".bilibili-player"
    ]
  };

  function moduleOn(name) {
    return Boolean(config.enabled && config.modules && config.modules[name]);
  }

  /*
   * 功能检查同时看模块总开关和具体开关。
   * 这是保证每个功能都能独立关闭的核心规则。
   */
  function featureOn(moduleName, path) {
    return moduleOn(moduleName) && Boolean(CONFIG.getByPath(config, path));
  }

  function isPlayerPage() {
    return location.hostname === "www.bilibili.com" && /^\/(video|bangumi|cheese|list)\//.test(location.pathname);
  }

  /*
   * 向后台 worker 发送带类型的请求。并非所有扩展界面都能可靠访问 IndexedDB，
   * 因此黑名单操作统一通过 chrome.runtime 消息完成。
   */
  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        if (!response || !response.ok) {
          reject(new Error(response && response.error ? response.error : "BilibiliToys message failed"));
          return;
        }

        resolve(response.data);
      });
    });
  }

  /*
   * 查询辅助函数用于减少重复的兜底选择器循环。
   * B 站不同页面类型暴露的 DOM 结构不同，因此这里会频繁使用。
   */
  function queryAny(list, root) {
    const scope = root || document;

    for (const selector of list) {
      const node = scope.querySelector(selector);
      if (node) {
        return node;
      }
    }

    return null;
  }

  function queryAll(list, root) {
    const scope = root || document;
    return list.flatMap((selector) => Array.from(scope.querySelectorAll(selector)));
  }

  /*
   * 收集节点上所有可用的标签文本。播放器按钮常通过 title 或 aria-label
   * 暴露状态，而不是通过可见文本。
   */
  function getLabel(node) {
    if (!node) {
      return "";
    }

    return [
      node.getAttribute("aria-label"),
      node.getAttribute("title"),
      node.getAttribute("data-title"),
      node.getAttribute("data-tooltip"),
      node.textContent
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  /*
   * 模拟用户点击前先触发 hover 事件。部分 B 站控件只有在 hover 后
   * 才会挂载内部菜单或更新激活状态。
   */
  function clickElement(node) {
    if (!node) {
      return false;
    }

    const target = node.closest("button,[role='button'],label,.bpx-player-ctrl-btn,[class*='bpx-player-ctrl'],[class*='bilibili-player-video-btn']") || node;

    if (isNavigatingAnchor(target)) {
      return false;
    }

    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    target.click();
    return true;
  }

  function isNavigatingAnchor(node) {
    const anchor = node instanceof Element ? node.closest("a[href]") : null;

    if (!anchor) {
      return false;
    }

    return !anchor.matches("[role='button'],.bpx-player-ctrl-btn,[class*='bpx-player-ctrl'],[class*='bilibili-player-video-btn']");
  }

  /*
   * 通过中文文本和选择器兜底查找播放器按钮。
   * 即使具体控件类名变化，快捷键动作也能尽量保持可用。
   */
  function findButton(texts, fallbackSelectors) {
    const candidates = [
      ...queryAll(fallbackSelectors || []),
      ...Array.from(document.querySelectorAll("button,[role='button'],[title],[aria-label],[data-title],[data-tooltip]"))
    ].filter((node) => !isNavigatingAnchor(node));

    return candidates.find((node) => {
      const label = getLabel(node);
      return texts.some((text) => label.includes(text));
    });
  }

  function findVideo() {
    const videos = queryAll(selectors.video);

    return videos.find((video) => {
      const rect = video.getBoundingClientRect();
      return typeof video.play === "function" && typeof video.pause === "function" && rect.width > 0 && rect.height > 0;
    }) || videos[0] || null;
  }

  function findPlayerContainer() {
    return queryAny(selectors.playerContainer);
  }

  /*
   * 快捷键处理不能抢走评论框、搜索框、弹幕输入框或富文本编辑区的输入。
   */
  function isTextInputTarget(target) {
    const node = target instanceof Element ? target : null;

    if (!node) {
      return false;
    }

    return Boolean(
      node.closest("input,textarea,select,[contenteditable='true'],.ql-editor,.bpx-player-dm-input,.reply-box")
    );
  }

  /*
   * uid 用作黑名单 key 前先进行规范化。
   * 这里只接受数字形式的 B 站 uid。
   */
  function normalizeUid(value) {
    const uid = String(value || "").trim();
    return uid && /^\d+$/.test(uid) ? uid : "";
  }

  /*
   * 从常见 B 站作者链接、广告跳转链接和查询参数中提取 uid。
   * catch 分支用于处理相对路径或格式异常的 href 字符串。
   */
  function extractUidFromUrl(url) {
    if (!url) {
      return "";
    }

    try {
      const parsed = new URL(url, location.href);

      if (parsed.hostname === "space.bilibili.com") {
        return normalizeUid(parsed.pathname.split("/").filter(Boolean)[0]);
      }

      if (parsed.hostname === "cm.bilibili.com") {
        return normalizeUid(parsed.searchParams.get("space_mid"));
      }

      return normalizeUid(parsed.searchParams.get("mid") || parsed.searchParams.get("space_mid"));
    } catch (error) {
      const match = String(url).match(/(?:mid|space_mid)=([0-9]+)/);
      return normalizeUid(match && match[1]);
    }
  }

  function findCardRoot(node) {
    if (!node) {
      return null;
    }

    return node.closest(selectors.card.join(","));
  }

  /*
   * 读取过滤和拉黑所需的最小卡片信息：
   * uid、标题、作者名和视频链接。
   */
  function extractCardInfo(card) {
    const authorLink = queryAny(selectors.authorLink, card);
    const titleLink = queryAny(selectors.titleLink, card);
    const uid = extractUidFromUrl(authorLink && authorLink.href);
    const title = (titleLink && (titleLink.title || titleLink.textContent) || "").trim();
    const author = (authorLink && authorLink.textContent || "").trim();

    return {
      uid,
      title,
      author,
      href: titleLink && titleLink.href
    };
  }

  /*
   * 标记和隐藏分开处理：调试模式会保留卡片并显示原因，
   * 普通模式会隐藏卡片。两种模式都会写入属性，便于 CSS 精准处理网格直接子项，
   * 避免留下空白卡位。
   */
  function markOrHideCard(card, reason) {
    if (!card) {
      return;
    }

    card.setAttribute("data-bilibili-toys-reason", reason);
    card.setAttribute("block-reason", reason);
    card.setAttribute("data-bilibili-toys-card-hidden", "true");

    if (config.homeClean.showReasons || config.playRecommend.showReasons) {
      card.classList.add("bilibili-toys-card-debug");
    } else {
      card.classList.add("bilibili-toys-card-hidden");
    }
  }

  function clearBilibiliToysMarks() {
    /*
     * 功能开关必须可逆。过滤通过给卡片添加类名实现，
     * 因此配置变化时需要移除旧标记，让下一次扫描只应用当前启用的规则。
     */
    document.querySelectorAll("[data-bilibili-toys-processed],[data-bilibili-toys-play-processed],.bilibili-toys-card-hidden,.bilibili-toys-card-debug").forEach((node) => {
      node.classList.remove("bilibili-toys-card-hidden", "bilibili-toys-card-debug");
      node.removeAttribute("data-bilibili-toys-reason");
      node.removeAttribute("block-reason");
      node.removeAttribute("data-bilibili-toys-card-hidden");
      delete node.dataset.bilibiliToysProcessed;
      delete node.dataset.bilibiliToysPlayProcessed;
    });
  }

  function updateRootStateClasses() {
    document.documentElement.classList.toggle("bilibili-toys-home-clean-off", !moduleOn("homeClean"));
  }

  /*
   * 用于识别低质量搬运 / 疑似广告标题的简单启发式规则。
   * 同时要求画质关键词和可疑资源关键词，以减少误伤。
   */
  function looksLikeAdTitle(title) {
    const normalized = String(title || "").toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
    const hasQuality = ["1080p", "2160p", "4k"].some((word) => normalized.includes(word));
    const hasAdWord = ["蓝光", "原盘", "完整版", "完版", "高码", "首发", "无删减", "修复"].some((word) => normalized.includes(word));

    return hasQuality && hasAdWord;
  }

  /*
   * 用所有已启用的首页净化规则评估单张首页卡片。
   * 返回空字符串表示卡片应保持可见。
   */
  function shouldHideHomeCard(card) {
    const text = getLabel(card);
    const info = extractCardInfo(card);

    if (config.homeClean.filterPromotions && (text.includes("推广") || text.includes("广告") || card.querySelector("[class*='ad'],[class*='Ad']"))) {
      return "推广或广告内容";
    }

    if (config.homeClean.filterLive && /live\.bilibili\.com|直播/.test(card.innerHTML + text)) {
      return "直播内容";
    }

    if (config.homeClean.keepFollowed && text.includes("已关注")) {
      return "";
    }

    if (config.homeClean.filterNoDate && !card.querySelector(".bili-video-card__info--date,[class*='date'],[class*='time']")) {
      return "缺少日期信息";
    }

    if (config.homeClean.filterNoAuthor && !info.author && !info.uid) {
      return "缺少 UP 信息";
    }

    if (config.homeClean.filterAdLikeUsers && /^bili_\d{4,}$/.test(info.author)) {
      return "疑似广告账号";
    }

    if (config.homeClean.filterAdLikeTitles && looksLikeAdTitle(info.title)) {
      return "疑似广告标题";
    }

    return "";
  }

  function findBetterHomeFeedContainer() {
    /*
     * Better Bilibili 过滤首页网格的直接子项。只隐藏嵌套视频卡会留下外层网格项，
     * 形成用户反馈的空白卡片。因此首页处理从推荐容器的直接子项开始。
     */
    return document.querySelector(".feed2 > div > .container") ||
      document.querySelector(".bili-feed4 > main > .feed2 > div > .container") ||
      document.querySelector(".container.is-version8");
  }

  function getBetterHomeFeedItems() {
    const container = findBetterHomeFeedContainer();

    if (!container) {
      return [];
    }

    return Array.from(container.children).filter((node) => {
      return node.nodeType === Node.ELEMENT_NODE && typeof node.querySelector === "function";
    });
  }

  async function addLocalBlockedUser(uid, mark, source) {
    const record = await sendMessage({
      type: "blacklist:put",
      user: {
        uid,
        mark,
        source
      }
    });

    scheduleScan();
    return record;
  }

  /*
   * 黑名单检查是异步的，因为真实数据在后台 worker 的 IndexedDB 中。
   * 黑名单模块关闭时会立即短路返回。
   */
  async function isLocalBlocked(uid) {
    if (!uid || !featureOn("blacklist", "blacklist.localEnabled")) {
      return false;
    }

    const record = await sendMessage({ type: "blacklist:get", uid });
    return Boolean(record);
  }

  function readCookie(name) {
    const pair = `; ${document.cookie}`.split(`; ${name}=`);
    return pair.length === 2 ? pair.pop().split(";").shift() : "";
  }

  /*
   * 可选的账号拉黑操作。它会调用 B 站关系接口，
   * 因此必须由显式设置和确认提示保护。
   */
  async function addAccountBlockedUser(uid) {
    const csrf = readCookie("bili_jct");

    if (!csrf) {
      throw new Error("未找到 B 站 csrf token，账号拉黑失败");
    }

    const body = new URLSearchParams();
    body.append("fid", uid);
    body.append("act", "5");
    body.append("csrf", csrf);

    const response = await fetch("https://api.bilibili.com/x/relation/modify", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body,
      credentials: "include"
    });
    const result = await response.json();

    if (result.code !== 0) {
      throw new Error(result.message || "账号拉黑失败");
    }

    return result;
  }

  /*
   * 给视频卡片附加本地 / 账号拉黑控件。
   * 函数具备幂等性，重复 DOM 扫描不会生成重复按钮。
   */
  function createBlockActions(card, info) {
    if (!featureOn("blacklist", "blacklist.localEnabled") || card.querySelector(".bilibili-toys-block-actions")) {
      return;
    }

    if (!info.uid) {
      return;
    }

    const host = queryAny(selectors.authorLink, card)?.parentElement || card;
    const wrapper = document.createElement("span");
    wrapper.className = "bilibili-toys-block-actions";
    const buttons = {};

    if (config.blacklist.showLocalButton) {
      const localButton = document.createElement("button");
      localButton.type = "button";
      localButton.className = "bilibili-toys-mini-button";
      localButton.textContent = "拉黑本地";
      localButton.title = "仅保存到 BilibiliToys 本地黑名单";
      localButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await addLocalBlockedUser(info.uid, info.author, "home-card");
        markOrHideCard(card, "本地黑名单");
      });
      buttons.local = localButton;
    }

    if (config.blacklist.showAccountButton && config.blacklist.accountBlockEnabled) {
      const accountButton = document.createElement("button");
      accountButton.type = "button";
      accountButton.className = "bilibili-toys-mini-button";
      accountButton.textContent = "账号拉黑";
      accountButton.title = "调用 B 站账号拉黑接口";
      accountButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (config.blacklist.accountBlockConfirm && !confirm(`确认将 ${info.author || info.uid} 加入 B 站账号黑名单？`)) {
          return;
        }

        await addAccountBlockedUser(info.uid);
        await addLocalBlockedUser(info.uid, info.author, "account-block");
        markOrHideCard(card, "账号黑名单");
      });
      buttons.account = accountButton;
    }

    const order = config.blacklist.preferLocalBlock ? ["local", "account"] : ["account", "local"];
    order.forEach((key) => {
      if (buttons[key]) {
        wrapper.appendChild(buttons[key]);
      }
    });

    if (!wrapper.children.length) {
      return;
    }

    host.appendChild(wrapper);
  }

  async function processHomeCards() {
    /*
     * 首页净化使用推荐流直接子项，贴近 Better Bilibili 的行为，
     * 这样移除卡片时不会留下空外壳。
     */
    if (!moduleOn("homeClean") && !moduleOn("blacklist")) {
      return;
    }

    const cards = getBetterHomeFeedItems();

    if (!cards.length) {
      return;
    }

    if (homeInitialScanDone && !config.homeClean.dynamicScan) {
      return;
    }

    for (const card of cards) {
      if (card.dataset.bilibiliToysProcessed === "true") {
        continue;
      }

      card.dataset.bilibiliToysProcessed = "true";
      const info = extractCardInfo(card);

      if (moduleOn("blacklist")) {
        createBlockActions(card, info);
      }

      if (moduleOn("blacklist") && await isLocalBlocked(info.uid)) {
        markOrHideCard(card, "本地黑名单");
        continue;
      }

      if (moduleOn("homeClean")) {
        const reason = shouldHideHomeCard(card);
        if (reason) {
          markOrHideCard(card, reason);
        }
      }
    }

    homeInitialScanDone = true;
  }

  async function processPlayRecommendations() {
    /*
     * 播放页推荐卡片使用更宽的选择器集合，
     * 因为它们会出现在旧播放页、新播放页和列表推荐等多种布局中。
     */
    if (!isPlayerPage() || !moduleOn("playRecommend")) {
      return;
    }

    const cards = Array.from(
      document.querySelectorAll(".rec-list .card-box,.recommend-list .card-box,.video-page-card-small,.card-box,.bili-video-card")
    );

    if (!cards.length) {
      return;
    }

    if (playInitialScanDone && !config.playRecommend.dynamicScan) {
      return;
    }

    for (const card of cards) {
      if (card.dataset.bilibiliToysPlayProcessed === "true") {
        continue;
      }

      card.dataset.bilibiliToysPlayProcessed = "true";
      const info = extractCardInfo(card);

      if (config.playRecommend.hideBlockedUsers && await isLocalBlocked(info.uid)) {
        markOrHideCard(card, "播放页本地黑名单");
      } else if (moduleOn("blacklist")) {
        createBlockActions(card, info);
      }
    }

    playInitialScanDone = true;
  }

  function setDynamicStyles() {
    /*
     * 运行时 CSS 用于处理更适合样式切换、而不是 DOM 重写的功能，
     * 例如隐藏底部弹幕区域。
     */
    let style = document.getElementById(RUNTIME_STYLE_ID);

    if (!style) {
      style = document.createElement("style");
      style.id = RUNTIME_STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    const hideBottomDanmaku = moduleOn("danmaku") && config.danmaku.preventBottomDanmaku;
    const showTopicTags = moduleOn("comments") && config.comments.showTopicTags;
    const hidePinnedAdComment = moduleOn("comments") && config.comments.hidePinnedAdComment;
    const useCommentAreaStyle = moduleOn("comments") && config.comments.commentAreaStyle;
    const useCommentBoxStyle = moduleOn("comments") && config.comments.commentBoxStyle;
    const usePageStyles = moduleOn("styles") && config.styles.enabled;

    style.textContent = `
      ${hideBottomDanmaku ? ".bpx-player-row-dm-wrap,.bilibili-player-video-danmaku .mode-bottom{display:none!important;}" : ""}
      ${showTopicTags ? ":root{--style-property-show-tag-container:block;}" : ":root{--style-property-show-tag-container:none;}"}
      ${hidePinnedAdComment ? ".bilibili-toys-pinned-ad-comment{display:none!important;}" : ""}
      ${useCommentAreaStyle ? ":root{--bilibili-toys-comment-fixed-margin:1rem;--bilibili-toys-comment-fixed-bg:#f0f8fff0;--bilibili-toys-comment-fixed-radius:.8rem;--bilibili-toys-comment-fixed-border:1px solid #a5a5a54d;--bilibili-toys-comment-fixed-shadow:rgb(125 131 127 / 14%) 0 0 8px 1px;--bilibili-toys-comment-fixed-padding:5px 0;}" : ""}
      ${useCommentBoxStyle ? ":root{--bilibili-toys-comment-box-margin:1rem;--bilibili-toys-comment-editor-border:1px solid rgb(0 0 0 / 5%);--bilibili-toys-comment-editor-radius:.75rem;--bilibili-toys-comment-editor-bg:transparent;--bilibili-toys-comment-tool-radius:6px;}" : ""}
      ${usePageStyles && config.styles.home ? ".container > .recommended-swipe,.is-version8 > .recommended-swipe{display:none!important;}" : ""}
      ${usePageStyles && config.styles.search ? ".search-page .ad-report,.search-page [class*='ad']{display:none!important;}" : ""}
      ${usePageStyles && config.styles.play ? ".bilibili-toys-player-soften{border-radius:6px!important;}" : ""}
      ${usePageStyles && config.styles.bangumi ? "#comment-body > div > div > .reply-warp > .fixed-reply-box{display:none!important;}.home-container > div > div[class^='navTools'] > div > a[title='新版反馈'],.home-container > div > div[class^='navTools'] > div > a[title='帮助反馈']{display:none!important;}" : ""}
      ${usePageStyles && config.styles.list ? "#mirror-vdcon > .playlist-container--right > .recommend-list-container > div > .card-box{box-shadow:rgb(125 131 127 / 24%) 0 0 4px 1px!important;background-color:rgb(208 222 233 / 67%)!important;padding:5px!important;border-radius:10px!important;transition:background-color .5s ease,box-shadow .3s ease!important;}#mirror-vdcon > .playlist-container--right > .recommend-list-container > div > .card-box:hover{background-color:rgb(204 213 213)!important;box-shadow:rgb(199 206 212 / 85%) 0 0 4px 1px!important;}#mirror-vdcon > .playlist-container--right > .recommend-list-container{margin-top:10px!important;padding-top:10px!important;}#mirror-vdcon > .playlist-container--right > .recommend-list-container > .recommend-video-card{padding:3px!important;margin-bottom:10px!important;}" : ""}
      html.bilibili-toys-lights-off::before{content:"";position:fixed;inset:0;background:rgb(0 0 0 / 72%);pointer-events:none;z-index:9998;}
      html.bilibili-toys-lights-off #bilibili-player,html.bilibili-toys-lights-off .player-container,html.bilibili-toys-lights-off #bofqi{position:relative!important;z-index:9999!important;}
    `;
  }

  function applyDefaultDanmakuOff() {
    /*
     * 默认弹幕状态通过读取当前按钮状态来应用，
     * 只有页面仍在显示弹幕时才点击关闭。
     */
    if (!moduleOn("playerDefaults") || !config.player.defaultDanmakuOff) {
      return;
    }

    const key = `${location.origin}${location.pathname}${location.search}`;
    if (appliedDanmakuOffKey === key) {
      return;
    }

    const button = queryAny(selectors.danmakuButton) || findButton(["关闭弹幕", "弹幕"], selectors.danmakuButton);

    if (!button) {
      return;
    }

    if (button.matches("input[type='checkbox']")) {
      if (button.checked) {
        clickElement(button);
      }
      appliedDanmakuOffKey = key;
      return;
    }

    const label = getLabel(button);
    if (label.includes("关闭") || !label.includes("开启")) {
      clickElement(button);
    }
    appliedDanmakuOffKey = key;
  }

  function applyDefaultViewMode() {
    /*
     * appliedViewModeKey 用来防止普通模式和宽屏模式之间来回切换。
     * 同一个 URL 达到目标显示模式后，扫描循环会停止继续点击模式按钮。
     */
    if (!moduleOn("playerDefaults") || !config.player.defaultViewModeEnabled) {
      return;
    }

    if (config.player.disableWideMode && config.player.defaultViewMode === "wide") {
      return;
    }

    const key = `${location.href}:${config.player.defaultViewMode}`;
    if (appliedViewModeKey === key || isViewModeActive(config.player.defaultViewMode)) {
      appliedViewModeKey = key;
      return;
    }

    if (config.player.defaultViewMode === "wide") {
      if (clickElement(queryAny(selectors.wideButton) || findButton(["宽屏"], selectors.wideButton))) {
        appliedViewModeKey = key;
        setTimeout(() => findVideo()?.scrollIntoView({ block: "center", inline: "center" }), 180);
      }
    }

    if (config.player.defaultViewMode === "webFullscreen") {
      if (clickElement(queryAny(selectors.webFullscreenButton) || findButton(["网页全屏"], selectors.webFullscreenButton))) {
        appliedViewModeKey = key;
      }
    }
  }

  function applyDefaultLights() {
    /*
     * 关灯复选框可能在播放器设置挂载后才出现，
     * 因此这里短时间重试，而不是假设第一次扫描时控件一定存在。
     */
    if (!moduleOn("playerDefaults") || !config.player.defaultLightsOff || config.player.smartLights) {
      return;
    }

    repeatUntil(20, 600, () => toggleBilibiliLight(2));
  }

  function applySmartLights() {
    /*
     * 参考原播放器扩展的实现：用 IntersectionObserver 观察播放器容器，
     * 并使用 0.75 阈值触发状态复查。播放器仍在可视区域且不是小窗模式时保持关灯，
     * 离开可视区域时关闭关灯，避免滚动到评论区后整页仍然保持暗背景。
     */
    if (!moduleOn("playerDefaults") || !config.player.smartLights) {
      if (smartLightObserver) {
        smartLightObserver.disconnect();
        smartLightObserver = null;
        smartLightTarget = null;
      }
      return;
    }

    const target = findPlayerContainer();

    if (!target || smartLightTarget === target) {
      return;
    }

    if (smartLightObserver) {
      smartLightObserver.disconnect();
    }

    smartLightTarget = target;
    smartLightObserver = new IntersectionObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      if (entry.isIntersecting && !entry.target.classList.contains("mini-player")) {
        toggleBilibiliLight(2);
      } else {
        toggleBilibiliLight(1);
      }
    }, { threshold: 0.75 });
    smartLightObserver.observe(target);
  }

  function isViewModeActive(mode) {
    /*
     * 新版 B 站播放器通常通过容器上的 data-screen 暴露当前显示模式。
     * 未知模式按未激活处理。
     */
    if (mode === "normal") {
      return true;
    }

    if (mode === "wide") {
      return Boolean(document.querySelector("[data-screen='wide'],.bpx-player-container[data-screen='wide']"));
    }

    if (mode === "webFullscreen") {
      return Boolean(document.querySelector("[data-screen='web'],.bpx-player-container[data-screen='web']"));
    }

    return false;
  }

  function repeatUntil(max, timeout, callback) {
    /*
     * 给懒加载播放器控件使用的通用重试函数。
     * 回调返回 true 表示操作已经成功。
     */
    let count = 0;

    function tick() {
      count += 1;
      if (count > max || callback()) {
        return;
      }
      setTimeout(tick, timeout);
    }

    tick();
  }

  function clickLightCheckbox(mode) {
    /*
     * mode：0 表示切换，1 表示强制关闭，2 表示强制开启。
     * 默认关灯功能使用强制开启，避免反复切换状态。
     */
    const checkbox = document.querySelector(".bpx-player-ctrl-setting-lightoff input[type=checkbox],.bilibili-player-video-btn-setting-right-others-content-lightoff input[type=checkbox],.squirtle-lightoff");

    if (!checkbox) {
      return false;
    }

    if (mode === 0) {
      checkbox.click();
      return true;
    }

    const isOn = checkbox.checked === true || checkbox.classList.contains("active");

    if (mode === 1 && isOn) {
      checkbox.click();
    }

    if (mode === 2 && !isOn) {
      checkbox.click();
    }

    return true;
  }

  function toggleBilibiliToysLightOverlay(mode) {
    /*
     * B 站播放器偶尔不会挂载原生关灯控件。此时提供一个只在本页生效的兜底暗场，
     * 保证快捷键有明确反馈；优先级仍低于上面的原生 lightoff 复选框。
     */
    const root = document.documentElement;

    if (mode === 0) {
      root.classList.toggle("bilibili-toys-lights-off");
      return true;
    }

    root.classList.toggle("bilibili-toys-lights-off", mode === 2);
    return true;
  }

  function toggleBilibiliLight(mode) {
    /*
     * 部分播放器版本会把关灯复选框藏在设置 hover 面板中。
     * 先 hover 设置按钮打开面板，再尝试点击复选框。
     */
    if (clickLightCheckbox(mode)) {
      return true;
    }

    const settingButton = document.querySelector(".bilibili-player-video-btn-setting,.bpx-player-ctrl-setting");

    if (!settingButton) {
      return toggleBilibiliToysLightOverlay(mode);
    }

    settingButton.addEventListener("mouseover", () => {
      settingButton.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      setTimeout(() => {
        if (!clickLightCheckbox(mode)) {
          toggleBilibiliToysLightOverlay(mode);
        }
      }, 100);
    }, { once: true });
    settingButton.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    return true;
  }

  function bindVideoEvents() {
    /*
     * 每个 video 元素只绑定一次事件。SPA 导航替换 video 元素时，
     * scanPage 会清空 lastVideo，让本函数能绑定新元素。
     */
    const video = findVideo();

    if (!video || lastVideo === video) {
      return;
    }

    lastVideo = video;

    video.addEventListener("ended", () => {
      if (!moduleOn("playerDefaults") || !config.player.exitFullscreenOnEnded) {
        return;
      }

      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }

      const webButton = findButton(["退出网页全屏", "退出全屏"], selectors.webFullscreenButton);
      if (webButton) {
        clickElement(webButton);
      }
    });

    if (moduleOn("playerDefaults") && config.player.autoPlay && video.paused) {
      video.play().catch(() => {});
    }
  }

  function shortcutToText(shortcut) {
    /*
     * 将基于 KeyboardEvent.code 的快捷键转换为紧凑标签，
     * 供浮层和设置表格显示。
     */
    if (!shortcut || !shortcut.code) {
      return "未设置";
    }

    const keyText = shortcut.code === "Slash" ? "/" : shortcut.code.replace(/^Key/, "").replace(/^Digit/, "");

    return [
      shortcut.ctrl ? "Ctrl" : "",
      shortcut.alt ? "Alt" : "",
      shortcut.shift ? "Shift" : "",
      keyText
    ].filter(Boolean).join(" + ");
  }

  function eventMatchesShortcut(event, shortcut) {
    /*
     * 快捷键同时匹配物理按键 code 和完整修饰键状态。
     * 这样 Ctrl / Alt / Shift 组合不会误触发普通快捷键。
     */
    if (!shortcut || !shortcut.enabled || !shortcut.code) {
      return false;
    }

    return (
      event.code === shortcut.code &&
      event.ctrlKey === Boolean(shortcut.ctrl) &&
      event.altKey === Boolean(shortcut.alt) &&
      event.shiftKey === Boolean(shortcut.shift)
    );
  }

  function getShortcutAction(event) {
    /*
     * 为一次键盘事件返回匹配的动作 id。
     * 快捷键关闭或没有匹配项时返回空字符串。
     */
    if (!moduleOn("hotkeys") || !config.hotkeys.enabled || config.hotkeys.disableAll) {
      return "";
    }

    const entries = Object.entries(config.hotkeys.shortcuts || {});

    for (const [id, shortcut] of entries) {
      if (eventMatchesShortcut(event, shortcut)) {
        return id;
      }
    }

    return "";
  }

  function showOverlay(id, text, position) {
    /*
     * 每个 id 复用同一个浮层，使重复触发进度 / 时间 / 标题快捷键时原地更新，
     * 而不是堆叠新的 DOM 节点。
     */
    let overlay = document.getElementById(`bilibili-toys-overlay-${id}`);

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = `bilibili-toys-overlay-${id}`;
      overlay.className = `bilibili-toys-overlay ${position || ""}`.trim();
      document.documentElement.appendChild(overlay);
    }

    overlay.textContent = text;
    overlay.style.display = "block";

    clearTimeout(overlayTimers.get(id));
    overlayTimers.set(id, setTimeout(() => {
      overlay.style.display = "none";
    }, 1600));
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const rest = Math.floor(safe % 60);
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  }

  /*
   * 以下小型动作函数把快捷键 id 映射到具体播放器行为。
   * 能使用原生媒体 API 时优先使用，只有 UI 专属功能才回退到 B 站播放器按钮。
   */
  function toggleDanmaku() {
    clickElement(queryAny(selectors.danmakuButton) || findButton(["弹幕"], selectors.danmakuButton));
  }

  function togglePlayPause() {
    /*
     * 空格播放 / 暂停不能只依赖 B 站播放器按钮。新版播放器的按钮类名和挂载时机经常变化，
     * 直接控制当前可见 video 更稳定；按钮点击仅作为找不到 video 时的兜底。
     */
    const video = findVideo();

    if (video && typeof video.play === "function" && typeof video.pause === "function") {
      if (video.paused || video.ended) {
        video.play().catch(() => {
          clickElement(queryAny(selectors.playButton) || findButton(["播放", "暂停"], selectors.playButton));
        });
      } else {
        video.pause();
      }
      return true;
    }

    return clickElement(queryAny(selectors.playButton) || findButton(["播放", "暂停"], selectors.playButton));
  }

  function toggleMute() {
    const video = findVideo();

    if (video && "muted" in video) {
      video.muted = !video.muted;
      showOverlay("status", video.muted ? "静音 On" : "静音 Off");
      return true;
    }

    return clickElement(queryAny(selectors.muteButton) || findButton(["静音", "音量"], selectors.muteButton));
  }

  function toggleFullscreen() {
    /*
     * 全屏优先使用标准 Fullscreen API，避免播放器按钮类名变化导致快捷键失效。
     */
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
      return true;
    }

    const target = findPlayerContainer() || findVideo() || document.documentElement;

    if (target && target.requestFullscreen) {
      target.requestFullscreen().catch(() => {
        clickElement(queryAny(selectors.fullscreenButton) || findButton(["全屏"], selectors.fullscreenButton));
      });
      return true;
    }

    return clickElement(queryAny(selectors.fullscreenButton) || findButton(["全屏"], selectors.fullscreenButton));
  }

  function showDanmakuStatus() {
    const button = queryAny(selectors.danmakuButton) || findButton(["弹幕"], selectors.danmakuButton);
    const enabled = button && (button.checked === true || !getLabel(button).includes("开启"));

    showOverlay("status", `弹幕 ${enabled ? "On" : "Off"}`);
  }

  function getCaptionItems() {
    return queryAll(selectors.subtitleLanguageItem);
  }

  function rememberCaptionChoice(item) {
    const label = getLabel(item);

    if (label) {
      lastCaptionText = label;
    }
  }

  function bindCaptionRemember() {
    /*
     * 原播放器扩展会在字幕语言项点击时记录最后一次选择。
     * 这里保留相同思路，并用 data 标记避免反复绑定监听器。
     */
    if (!moduleOn("danmaku") || !config.danmaku.rememberCaption) {
      return;
    }

    getCaptionItems().forEach((item) => {
      if (item.dataset.bilibiliToysCaptionBound === "true") {
        return;
      }

      item.dataset.bilibiliToysCaptionBound = "true";
      item.addEventListener("click", () => rememberCaptionChoice(item));
    });
  }

  function findRememberedCaption() {
    const items = getCaptionItems();

    return items.find((item) => getLabel(item) === lastCaptionText) ||
      items.find((item) => item.classList.contains("bpx-state-active")) ||
      items[0] ||
      null;
  }

  function toggleSubtitle() {
    const closeSwitch = queryAny(selectors.subtitleCloseSwitch);

    if (!closeSwitch || !config.danmaku.rememberCaption) {
      clickElement(queryAny(selectors.subtitleButton) || findButton(["字幕"], selectors.subtitleButton));
      return;
    }

    bindCaptionRemember();

    if (closeSwitch.classList.contains("bpx-state-active")) {
      const caption = findRememberedCaption();

      if (caption) {
        clickElement(caption);
      } else {
        clickElement(closeSwitch);
      }
      return;
    }

    const active = getCaptionItems().find((item) => item.classList.contains("bpx-state-active"));
    if (active) {
      rememberCaptionChoice(active);
    }

    clickElement(closeSwitch);
  }

  function seekBy(seconds) {
    const video = findVideo();
    if (!video) {
      return;
    }

    const currentTime = Number(video.currentTime) || 0;
    const targetTime = Math.max(0, currentTime + seconds);
    const clampedTime = Number.isFinite(video.duration) ? Math.min(video.duration, targetTime) : targetTime;

    try {
      video.currentTime = clampedTime;
    } catch (error) {
      console.warn("[BilibiliToys] seek failed", error);
    }
  }

  function stepFrame(direction) {
    const video = findVideo();
    if (!video) {
      return;
    }

    if (!video.paused) {
      video.pause();
    }

    const currentTime = Number(video.currentTime) || 0;
    const targetTime = Math.max(0, currentTime + direction / 30);
    const clampedTime = Number.isFinite(video.duration) ? Math.min(video.duration, targetTime) : targetTime;

    try {
      video.currentTime = clampedTime;
    } catch (error) {
      console.warn("[BilibiliToys] frame step failed", error);
    }
  }

  function setSpeed(delta) {
    const video = findVideo();
    if (!video) {
      return;
    }

    video.playbackRate = Math.max(0.25, Math.min(5, Number((video.playbackRate + delta).toFixed(2))));
    showOverlay("status", `倍速 ${video.playbackRate}`);
  }

  function resetSpeed() {
    const video = findVideo();
    if (!video) {
      return;
    }

    video.playbackRate = 1;
    showOverlay("status", "倍速 1");
  }

  async function togglePip() {
    const video = findVideo();

    if (!video || !document.pictureInPictureEnabled || video.disablePictureInPicture) {
      return;
    }

    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
      await video.requestPictureInPicture();
    }
  }

  function takeScreenshot(toClipboard) {
    /*
     * 截图通过临时 canvas 绘制当前 <video> 画面。
     * 如果浏览器阻止剪贴板写入，用户会看到失败浮层，而不是未捕获的 Promise 错误。
     */
    const video = findVideo();

    if (!video || video.readyState < 2) {
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

    const mime = config.media.screenshotFormat === "png" ? "image/png" : "image/jpeg";

    if (toClipboard) {
      canvas.toBlob((blob) => {
        if (blob && navigator.clipboard && globalThis.ClipboardItem) {
          navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]).then(() => {
            showOverlay("status", "截图已复制");
          }).catch(() => {
            showOverlay("status", "截图复制失败");
          });
        }
      }, mime, 0.98);
      return;
    }

    const link = document.createElement("a");
    link.download = `bilibili-toys-screenshot-${video.currentTime.toFixed(3)}.${config.media.screenshotFormat}`;
    link.href = canvas.toDataURL(mime, 0.98);
    link.click();
  }

  function setVideoScale(direction) {
    const video = findVideo();

    if (!video) {
      return;
    }

    videoScaleIndex = Math.max(0, Math.min(VIDEO_SCALES.length - 1, videoScaleIndex + direction));
    video.style.transform = `scale(${VIDEO_SCALES[videoScaleIndex]})`;
    video.style.transformOrigin = "center center";
    showOverlay("status", `视频缩放 ${Math.round(VIDEO_SCALES[videoScaleIndex] * 100)}%`);
  }

  function resetVideoScale() {
    const video = findVideo();

    if (!video) {
      return;
    }

    videoScaleIndex = 2;
    video.style.transform = "";
    showOverlay("status", "视频缩放 100%");
  }

  function showProgress() {
    const video = findVideo();

    if (!video) {
      return;
    }

    showOverlay("progress", `${formatTime(video.currentTime)} / ${formatTime(video.duration)} [-${formatTime(video.duration - video.currentTime)}]`);
  }

  function showClock() {
    const options = {
      hour: "2-digit",
      minute: "2-digit",
      hour12: !config.danmaku.time24Hour
    };

    if (config.danmaku.showSeconds) {
      options.second = "2-digit";
    }

    showOverlay("clock", new Intl.DateTimeFormat("zh-CN", options).format(new Date()), "is-right");
  }

  function showTitle() {
    const title = document.querySelector("h1.video-title,.video-title,.media-title")?.textContent?.trim() || document.title;
    showOverlay("title", title, "is-center");
  }

  function createShortcutHelpRow(label, shortcutTextValue) {
    /*
     * 快捷键帮助弹窗中的单行条目。用 DOM API 生成，避免把用户可修改的
     * 快捷键名称直接拼接进 HTML。
     */
    const row = document.createElement("div");
    const name = document.createElement("span");
    const key = document.createElement("kbd");

    row.className = "bilibili-toys-shortcut-help-row";
    name.textContent = label;
    key.textContent = shortcutTextValue;
    row.append(name, key);
    return row;
  }

  function renderShortcutHelpColumn(title, rows) {
    /*
     * 构建帮助弹窗的一列。左列展示扩展快捷键，右列展示 B 站默认快捷键。
     */
    const column = document.createElement("section");
    const heading = document.createElement("h3");

    column.className = "bilibili-toys-shortcut-help-column";
    heading.textContent = title;
    column.appendChild(heading);
    rows.forEach((row) => column.appendChild(row));
    return column;
  }

  function closeShortcutHelp() {
    const backdrop = document.getElementById("bilibili-toys-shortcut-help");

    if (backdrop) {
      backdrop.remove();
    }
  }

  function showShortcutHelp() {
    /*
     * Alt + / 在播放页打开快捷键总览。遮罩点击关闭，弹窗内容阻止冒泡，
     * 因此用户可以在弹窗内滚动查看全部已启用快捷键。
     */
    closeShortcutHelp();

    const backdrop = document.createElement("div");
    const modal = document.createElement("div");
    const header = document.createElement("div");
    const title = document.createElement("div");
    const close = document.createElement("button");
    const grid = document.createElement("div");
    const extensionRows = [];
    const bilibiliRows = CONFIG.BILIBILI_DEFAULT_SHORTCUTS.map((item) => createShortcutHelpRow(item.label, item.shortcut));

    if (moduleOn("hotkeys") && config.hotkeys.enabled && !config.hotkeys.disableAll) {
      Object.values(config.hotkeys.shortcuts || {}).forEach((shortcut) => {
        if (shortcut.enabled && shortcut.code) {
          extensionRows.push(createShortcutHelpRow(shortcut.label, shortcutToText(shortcut)));
        }
      });
    }

    backdrop.id = "bilibili-toys-shortcut-help";
    backdrop.className = "bilibili-toys-shortcut-help-backdrop";
    modal.className = "bilibili-toys-shortcut-help-modal";
    header.className = "bilibili-toys-shortcut-help-header";
    title.className = "bilibili-toys-shortcut-help-title";
    close.className = "bilibili-toys-shortcut-help-close";
    grid.className = "bilibili-toys-shortcut-help-grid";

    title.textContent = "快捷键";
    close.type = "button";
    close.textContent = "关闭";
    close.addEventListener("click", closeShortcutHelp);
    backdrop.addEventListener("click", closeShortcutHelp);
    modal.addEventListener("click", (event) => event.stopPropagation());

    header.append(title, close);
    grid.append(
      renderShortcutHelpColumn("BilibiliToys", extensionRows),
      renderShortcutHelpColumn("Bilibili", bilibiliRows)
    );
    modal.append(header, grid);
    backdrop.appendChild(modal);
    document.documentElement.appendChild(backdrop);
  }

  function toggleShortcutHelp() {
    /*
     * 快捷键帮助已打开时再次触发同一快捷键会关闭弹窗；
     * 未打开时则重新收集当前启用快捷键并展示。
     */
    if (document.getElementById("bilibili-toys-shortcut-help")) {
      closeShortcutHelp();
      return;
    }

    showShortcutHelp();
  }

  function isShortcutHelpCloseEvent(event) {
    /*
     * 帮助弹窗打开时，Space 和 Esc 默认只关闭弹窗，不再穿透到播放器。
     */
    return event.code === "Escape" || event.code === "Space" || event.key === " ";
  }

  function runShortcutAction(id) {
    /*
     * 所有扩展快捷键的分发表。每个处理函数仍会检查自己的功能开关，
     * 因此关闭媒体 / 弹幕功能时，对应快捷键行为也会失效。
     */
    const longStep = Number(config.media.longStep) || 30;
    const shortStep = Number(config.media.shortStep) || 5;
    const speedStep = Number(config.media.speedStep) || 0.25;

    const actions = {
      danmakuToggle: () => moduleOn("danmaku") && toggleDanmaku(),
      danmakuStatus: () => moduleOn("danmaku") && showDanmakuStatus(),
      captionToggle: () => moduleOn("danmaku") && config.danmaku.subtitleHotkey && toggleSubtitle(),
      fullscreen: () => toggleFullscreen(),
      webFullscreen: () => clickElement(queryAny(selectors.webFullscreenButton) || findButton(["网页全屏"], selectors.webFullscreenButton)),
      widescreen: () => !config.player.disableWideMode && clickElement(queryAny(selectors.wideButton) || findButton(["宽屏"], selectors.wideButton)),
      playPause: () => togglePlayPause(),
      mute: () => toggleMute(),
      nextVideo: () => clickElement(queryAny(selectors.nextButton) || findButton(["下一个"], selectors.nextButton)),
      shortBackward: () => seekBy(-shortStep),
      longBackward: () => seekBy(-longStep),
      shortForward: () => seekBy(shortStep),
      longForward: () => seekBy(longStep),
      previousFrame: () => config.media.frameControl && stepFrame(-1),
      nextFrame: () => config.media.frameControl && stepFrame(1),
      replay: () => {
        const video = findVideo();
        if (video && config.media.replay) {
          video.currentTime = 0;
        }
      },
      pip: () => config.media.pip && togglePip(),
      screenshotFile: () => config.media.screenshotFile && takeScreenshot(false),
      screenshotClipboard: () => config.media.screenshotClipboard && takeScreenshot(true),
      speedUp: () => config.media.speedControl && setSpeed(speedStep),
      speedDown: () => config.media.speedControl && setSpeed(-speedStep),
      speedReset: () => config.media.speedControl && resetSpeed(),
      videoScaleUp: () => config.danmaku.videoScaleHotkeys && setVideoScale(1),
      videoScaleDown: () => config.danmaku.videoScaleHotkeys && setVideoScale(-1),
      videoScaleReset: () => config.danmaku.videoScaleHotkeys && resetVideoScale(),
      titleOverlay: () => config.danmaku.titleOverlay && showTitle(),
      progressOverlay: () => config.danmaku.progressOverlay && showProgress(),
      clockOverlay: () => config.danmaku.clockOverlay && showClock(),
      lightsToggle: () => toggleBilibiliLight(0),
      shortcutHelp: () => toggleShortcutHelp()
    };

    if (actions[id]) {
      actions[id]();
    }
  }

  function handleKeydown(event) {
    /*
     * 提前捕获 keydown，确保播放器获得焦点时快捷键也能工作。
     * 文本输入目标已由上方 isTextInputTarget 跳过。
     */
    if (!isPlayerPage()) {
      return;
    }

    const action = getShortcutAction(event);
    const helpOpen = Boolean(document.getElementById("bilibili-toys-shortcut-help"));

    if (helpOpen && (isShortcutHelpCloseEvent(event) || action === "shortcutHelp")) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeShortcutHelp();
      return;
    }

    if (action === "shortcutHelp") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      toggleShortcutHelp();
      return;
    }

    if (isTextInputTarget(event.target)) {
      return;
    }

    if (moduleOn("hotkeys") && config.hotkeys.spacePlayPause && (event.code === "Space" || event.key === " ")) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      togglePlayPause();
      return;
    }

    if (action) {
      event.preventDefault();
      event.stopPropagation();
      runShortcutAction(action);
    }
  }

  function injectPageAgentIfNeeded() {
    /*
     * MV3 隔离环境中的内容脚本不能直接 patch 页面拥有的 API。
     * 当功能需要访问 MAIN world 时，会注入 web-accessible 的页面代理脚本。
     */
    const needsAgent = moduleOn("homeClean") || moduleOn("tracking") || moduleOn("cdn") || moduleOn("comments");

    if (needsAgent && !document.getElementById(PAGE_AGENT_ID)) {
      const script = document.createElement("script");
      script.id = PAGE_AGENT_ID;
      script.src = chrome.runtime.getURL("src/page/page-agent.js");
      script.onload = () => {
        /*
         * 第一次配置事件可能早于外部脚本加载完成。
         * 脚本 load 后再次派发，可保证页面代理立刻拿到当前开关，
         * 即使页面很安静、没有 DOM 变化触发下一次扫描也一样。
         */
        dispatchPageAgentConfig();
        script.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    }

    dispatchPageAgentConfig();
  }

  function dispatchPageAgentConfig() {
    /*
     * 只传递 MAIN-world 页面代理需要的开关，
     * 避免把无关扩展设置暴露到页面环境中。
     */
    document.dispatchEvent(new CustomEvent(PAGE_CONFIG_EVENT, {
      detail: {
        enabled: config.enabled,
        tracking: config.tracking,
        cdn: config.cdn,
        comments: config.comments,
        homeClean: config.homeClean,
        modules: config.modules
      }
    }));
  }

  function applyPlayerDefaults() {
    /*
     * B 站播放器会异步挂载，并可能在路由变化后替换控件，
     * 因此播放器默认状态会在扫描中重复校准。
     */
    if (!isPlayerPage()) {
      return;
    }

    bindVideoEvents();
    bindCaptionRemember();
    applyDefaultDanmakuOff();
    applyDefaultViewMode();
    applyDefaultLights();
    applySmartLights();
  }

  async function scanPage() {
    /*
     * 中央协调循环。它会应用 CSS、注入页面 hook、处理 SPA 路由变化、
     * 处理卡片，最后校准播放器默认状态。
     */
    setDynamicStyles();
    updateRootStateClasses();
    injectPageAgentIfNeeded();

    if (location.href !== currentUrl) {
      currentUrl = location.href;
      lastVideo = null;
      appliedDanmakuOffKey = "";
      appliedViewModeKey = "";
      smartLightTarget = null;
      homeInitialScanDone = false;
      playInitialScanDone = false;
      clearBilibiliToysMarks();
    }

    await processHomeCards();
    await processPlayRecommendations();
    applyPlayerDefaults();
  }

  function scheduleScan() {
    /*
     * 对 DOM 变化扫描做防抖。B 站页面渲染时会创建大量节点，
     * 如果每次变化都扫描会产生不必要的开销。
     */
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanPage().catch((error) => console.warn("[BilibiliToys] scan failed", error));
    }, OBSERVER_DEBOUNCE_MS);
  }

  function bindDomObserver() {
    /*
     * 观察整个文档，因为 SPA 导航期间卡片和播放器控件可能插入到任意位置。
     */
    if (domObserver) {
      return;
    }

    domObserver = new MutationObserver(scheduleScan);
    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: false
    });
  }

  function bindRouteWatcher() {
    /*
     * B 站使用 history.pushState / replaceState 做 SPA 导航，
     * 不会触发内容脚本重新加载。patch history 后，扩展可在路由变化后重新扫描。
     */
    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];

      history[method] = function patchedHistoryMethod() {
        const result = original.apply(this, arguments);
        setTimeout(scheduleScan, 0);
        return result;
      };
    });

    window.addEventListener("popstate", scheduleScan);
  }

  async function start() {
    /*
     * 等待 chrome.storage 前先注入页面代理。这贴近原 Better Bilibili 的
     * MAIN-world 注入时机，可在 B 站 Vue 网格渲染轮播 / 广告 / 楼层卡片前
     * 过滤首页推荐请求。默认配置会关闭高风险追踪 / CDN 开关，但开启首页净化。
     */
    updateRootStateClasses();
    injectPageAgentIfNeeded();

    config = await CONFIG.readStorage();
    updateRootStateClasses();
    injectPageAgentIfNeeded();
    bindDomObserver();
    bindRouteWatcher();
    window.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("keydown", handleKeydown, true);
    scheduleScan();

    CONFIG.onConfigChanged((nextConfig) => {
      config = nextConfig;
      clearBilibiliToysMarks();
      appliedDanmakuOffKey = "";
      appliedViewModeKey = "";
      smartLightTarget = null;
      homeInitialScanDone = false;
      playInitialScanDone = false;
      updateRootStateClasses();
      scheduleScan();
    });
  }

  start().catch((error) => console.warn("[BilibiliToys] start failed", error));
})();
