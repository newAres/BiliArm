/*
 * BiliArm content script.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 BiliArm contributors
 *
 * Feature behavior is derived from the reviewed Better Bilibili 2026.02.13 and
 * Bilibili Player Extension 3.0.2 CRX packages. The implementation below is a
 * commented, modular rewrite for BiliArm rather than a direct minified copy.
 */

(function () {
  "use strict";

  const CONFIG = globalThis.BiliArmConfig;
  const PAGE_AGENT_ID = "biliarm-page-agent";
  const PAGE_CONFIG_EVENT = "BiliArmPageConfig";
  const RUNTIME_STYLE_ID = "biliarm-dynamic-style";
  const OBSERVER_DEBOUNCE_MS = 350;

  let config = CONFIG.normalizeConfig();
  let domObserver = null;
  let scanTimer = 0;
  let currentUrl = location.href;
  let lastVideo = null;
  let overlayTimers = new Map();
  let videoScaleIndex = 2;
  let appliedViewModeKey = "";

  const VIDEO_SCALES = [0.5, 0.75, 1];

  const selectors = {
    video: [
      "#bilibiliPlayer video",
      "#bilibili-player video",
      ".bilibili-player video",
      ".player-container video",
      "#bofqi video",
      ".bpx-player-video-wrap video",
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

  function featureOn(moduleName, path) {
    return moduleOn(moduleName) && Boolean(CONFIG.getByPath(config, path));
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        if (!response || !response.ok) {
          reject(new Error(response && response.error ? response.error : "BiliArm message failed"));
          return;
        }

        resolve(response.data);
      });
    });
  }

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

  function clickElement(node) {
    if (!node) {
      return false;
    }

    const target = node.closest("button,[role='button'],label,a,.bpx-player-ctrl-btn,.bilibili-player-video-btn") || node;

    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    target.click();
    return true;
  }

  function findButton(texts, fallbackSelectors) {
    const candidates = [
      ...queryAll(fallbackSelectors || []),
      ...Array.from(document.querySelectorAll("button,[role='button'],a,[title],[aria-label],[data-title],[data-tooltip]"))
    ];

    return candidates.find((node) => {
      const label = getLabel(node);
      return texts.some((text) => label.includes(text));
    });
  }

  function findVideo() {
    return queryAny(selectors.video);
  }

  function isTextInputTarget(target) {
    const node = target instanceof Element ? target : null;

    if (!node) {
      return false;
    }

    return Boolean(
      node.closest("input,textarea,select,[contenteditable='true'],.ql-editor,.bpx-player-dm-input,.reply-box")
    );
  }

  function normalizeUid(value) {
    const uid = String(value || "").trim();
    return uid && /^\d+$/.test(uid) ? uid : "";
  }

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

  function markOrHideCard(card, reason) {
    if (!card) {
      return;
    }

    card.setAttribute("data-biliarm-reason", reason);
    card.setAttribute("block-reason", reason);
    card.setAttribute("data-biliarm-card-hidden", "true");

    if (config.homeClean.showReasons || config.playRecommend.showReasons) {
      card.classList.add("biliarm-card-debug");
    } else {
      card.classList.add("biliarm-card-hidden");
    }
  }

  function clearBiliArmMarks() {
    /*
     * Feature switches must be reversible. Because filtering is implemented by
     * adding classes to page cards, a config change has to remove old marks so
     * the next scan can re-apply only the currently enabled rules.
     */
    document.querySelectorAll("[data-biliarm-processed],[data-biliarm-play-processed],.biliarm-card-hidden,.biliarm-card-debug").forEach((node) => {
      node.classList.remove("biliarm-card-hidden", "biliarm-card-debug");
      node.removeAttribute("data-biliarm-reason");
      node.removeAttribute("block-reason");
      node.removeAttribute("data-biliarm-card-hidden");
      delete node.dataset.biliarmProcessed;
      delete node.dataset.biliarmPlayProcessed;
    });
  }

  function updateRootStateClasses() {
    document.documentElement.classList.toggle("biliarm-home-clean-off", !moduleOn("homeClean"));
  }

  function looksLikeAdTitle(title) {
    const normalized = String(title || "").toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
    const hasQuality = ["1080p", "2160p", "4k"].some((word) => normalized.includes(word));
    const hasAdWord = ["蓝光", "原盘", "完整版", "完版", "高码", "首发", "无删减", "修复"].some((word) => normalized.includes(word));

    return hasQuality && hasAdWord;
  }

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
     * Better Bilibili filters direct children of the homepage grid. Hiding a
     * nested video card leaves the grid child in place, which creates the
     * blank-card holes the user reported. So homepage processing starts from
     * the direct feed container children.
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

  function createBlockActions(card, info) {
    if (!featureOn("blacklist", "blacklist.localEnabled") || card.querySelector(".biliarm-block-actions")) {
      return;
    }

    if (!info.uid) {
      return;
    }

    const host = queryAny(selectors.authorLink, card)?.parentElement || card;
    const wrapper = document.createElement("span");
    wrapper.className = "biliarm-block-actions";

    if (config.blacklist.showLocalButton) {
      const localButton = document.createElement("button");
      localButton.type = "button";
      localButton.className = "biliarm-mini-button";
      localButton.textContent = "拉黑本地";
      localButton.title = "仅保存到 BiliArm 本地黑名单";
      localButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await addLocalBlockedUser(info.uid, info.author, "home-card");
        markOrHideCard(card, "本地黑名单");
      });
      wrapper.appendChild(localButton);
    }

    if (config.blacklist.showAccountButton && config.blacklist.accountBlockEnabled) {
      const accountButton = document.createElement("button");
      accountButton.type = "button";
      accountButton.className = "biliarm-mini-button";
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
      wrapper.appendChild(accountButton);
    }

    host.appendChild(wrapper);
  }

  async function processHomeCards() {
    if (!moduleOn("homeClean") && !moduleOn("blacklist")) {
      return;
    }

    const cards = getBetterHomeFeedItems();

    for (const card of cards) {
      if (card.dataset.biliarmProcessed === "true") {
        continue;
      }

      card.dataset.biliarmProcessed = "true";
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
  }

  async function processPlayRecommendations() {
    if (!moduleOn("playRecommend")) {
      return;
    }

    const cards = Array.from(
      document.querySelectorAll(".rec-list .card-box,.recommend-list .card-box,.video-page-card-small,.card-box,.bili-video-card")
    );

    for (const card of cards) {
      if (card.dataset.biliarmPlayProcessed === "true") {
        continue;
      }

      card.dataset.biliarmPlayProcessed = "true";
      const info = extractCardInfo(card);

      if (config.playRecommend.hideBlockedUsers && await isLocalBlocked(info.uid)) {
        markOrHideCard(card, "播放页本地黑名单");
      } else if (moduleOn("blacklist")) {
        createBlockActions(card, info);
      }
    }
  }

  function setDynamicStyles() {
    let style = document.getElementById(RUNTIME_STYLE_ID);

    if (!style) {
      style = document.createElement("style");
      style.id = RUNTIME_STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    const hideBottomDanmaku = moduleOn("danmaku") && config.danmaku.preventBottomDanmaku;
    const showTopicTags = moduleOn("comments") && config.comments.showTopicTags;
    const hidePinnedAdComment = moduleOn("comments") && config.comments.hidePinnedAdComment;
    const usePageStyles = moduleOn("styles") && config.styles.enabled;

    style.textContent = `
      ${hideBottomDanmaku ? ".bpx-player-row-dm-wrap,.bilibili-player-video-danmaku .mode-bottom{display:none!important;}" : ""}
      ${showTopicTags ? ":root{--style-property-show-tag-container:block;}" : ":root{--style-property-show-tag-container:none;}"}
      ${hidePinnedAdComment ? ".biliarm-pinned-ad-comment{display:none!important;}" : ""}
      ${usePageStyles && config.styles.home ? ".container > .recommended-swipe,.is-version8 > .recommended-swipe{display:none!important;}" : ""}
      ${usePageStyles && config.styles.search ? ".search-page .ad-report,.search-page [class*='ad']{display:none!important;}" : ""}
      ${usePageStyles && config.styles.play ? ".biliarm-player-soften{border-radius:6px!important;}" : ""}
    `;
  }

  function applyDefaultDanmakuOff() {
    if (!moduleOn("playerDefaults") || !config.player.defaultDanmakuOff) {
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
      return;
    }

    const label = getLabel(button);
    if (label.includes("关闭") || !label.includes("开启")) {
      clickElement(button);
    }
  }

  function applyDefaultViewMode() {
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
    if (!moduleOn("playerDefaults") || !config.player.defaultLightsOff) {
      return;
    }

    repeatUntil(20, 600, () => toggleBilibiliLight(2));
  }

  function isViewModeActive(mode) {
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

  function toggleBilibiliLight(mode) {
    if (clickLightCheckbox(mode)) {
      return true;
    }

    const settingButton = document.querySelector(".bilibili-player-video-btn-setting,.bpx-player-ctrl-setting");

    if (!settingButton) {
      return false;
    }

    settingButton.addEventListener("mouseover", () => {
      settingButton.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      setTimeout(() => clickLightCheckbox(mode), 100);
    }, { once: true });
    settingButton.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    return false;
  }

  function bindVideoEvents() {
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
    if (!shortcut || !shortcut.code) {
      return "未设置";
    }

    return [
      shortcut.ctrl ? "Ctrl" : "",
      shortcut.alt ? "Alt" : "",
      shortcut.shift ? "Shift" : "",
      shortcut.code.replace(/^Key/, "").replace(/^Digit/, "")
    ].filter(Boolean).join(" + ");
  }

  function eventMatchesShortcut(event, shortcut) {
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
    let overlay = document.getElementById(`biliarm-overlay-${id}`);

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = `biliarm-overlay-${id}`;
      overlay.className = `biliarm-overlay ${position || ""}`.trim();
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

  function toggleDanmaku() {
    clickElement(queryAny(selectors.danmakuButton) || findButton(["弹幕"], selectors.danmakuButton));
  }

  function showDanmakuStatus() {
    const button = queryAny(selectors.danmakuButton) || findButton(["弹幕"], selectors.danmakuButton);
    const enabled = button && (button.checked === true || !getLabel(button).includes("开启"));

    showOverlay("status", `弹幕 ${enabled ? "On" : "Off"}`);
  }

  function toggleSubtitle() {
    clickElement(queryAny(selectors.subtitleButton) || findButton(["字幕"], selectors.subtitleButton));
  }

  function seekBy(seconds) {
    const video = findVideo();
    if (!video || !Number.isFinite(video.duration)) {
      return;
    }

    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  }

  function stepFrame(direction) {
    const video = findVideo();
    if (!video || !Number.isFinite(video.duration)) {
      return;
    }

    if (!video.paused) {
      video.pause();
    }

    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + direction / 30));
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
    link.download = `biliarm-screenshot-${video.currentTime.toFixed(3)}.${config.media.screenshotFormat}`;
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

  function runShortcutAction(id) {
    const longStep = Number(config.media.longStep) || 30;
    const shortStep = Number(config.media.shortStep) || 5;
    const speedStep = Number(config.media.speedStep) || 0.25;

    const actions = {
      danmakuToggle: () => moduleOn("danmaku") && toggleDanmaku(),
      danmakuStatus: () => moduleOn("danmaku") && showDanmakuStatus(),
      captionToggle: () => moduleOn("danmaku") && config.danmaku.subtitleHotkey && toggleSubtitle(),
      fullscreen: () => clickElement(queryAny(selectors.fullscreenButton) || findButton(["全屏"], selectors.fullscreenButton)),
      webFullscreen: () => clickElement(queryAny(selectors.webFullscreenButton) || findButton(["网页全屏"], selectors.webFullscreenButton)),
      widescreen: () => !config.player.disableWideMode && clickElement(queryAny(selectors.wideButton) || findButton(["宽屏"], selectors.wideButton)),
      playPause: () => clickElement(queryAny(selectors.playButton) || findButton(["播放", "暂停"], selectors.playButton)),
      mute: () => clickElement(queryAny(selectors.muteButton) || findButton(["静音", "音量"], selectors.muteButton)),
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
      lightsToggle: () => clickElement(queryAny(selectors.lightButton) || findButton(["关灯", "开灯"], selectors.lightButton))
    };

    if (actions[id]) {
      actions[id]();
    }
  }

  function handleKeydown(event) {
    if (event.defaultPrevented || isTextInputTarget(event.target)) {
      return;
    }

    if (moduleOn("hotkeys") && config.hotkeys.spacePlayPause && event.code === "Space") {
      event.preventDefault();
      clickElement(queryAny(selectors.playButton) || findButton(["播放", "暂停"], selectors.playButton));
      return;
    }

    const action = getShortcutAction(event);

    if (action) {
      event.preventDefault();
      event.stopPropagation();
      runShortcutAction(action);
    }
  }

  function injectPageAgentIfNeeded() {
    const needsAgent = moduleOn("homeClean") || moduleOn("tracking") || moduleOn("cdn") || moduleOn("comments");

    if (needsAgent && !document.getElementById(PAGE_AGENT_ID)) {
      const script = document.createElement("script");
      script.id = PAGE_AGENT_ID;
      script.src = chrome.runtime.getURL("src/page/page-agent.js");
      script.onload = () => {
        /*
         * The first config event can fire before the external script finishes
         * loading. Dispatching again on load guarantees the page agent receives
         * the current switches immediately, even on a quiet page with no DOM
         * mutations to trigger another scan.
         */
        dispatchPageAgentConfig();
        script.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    }

    dispatchPageAgentConfig();
  }

  function dispatchPageAgentConfig() {
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
    bindVideoEvents();
    applyDefaultDanmakuOff();
    applyDefaultViewMode();
    applyDefaultLights();
  }

  async function scanPage() {
    setDynamicStyles();
    updateRootStateClasses();
    injectPageAgentIfNeeded();

    if (location.href !== currentUrl) {
      currentUrl = location.href;
      lastVideo = null;
      appliedViewModeKey = "";
      clearBiliArmMarks();
    }

    await processHomeCards();
    await processPlayRecommendations();
    applyPlayerDefaults();
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanPage().catch((error) => console.warn("[BiliArm] scan failed", error));
    }, OBSERVER_DEBOUNCE_MS);
  }

  function bindDomObserver() {
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
     * Inject the page agent before waiting for chrome.storage. This mirrors the
     * original Better Bilibili main-world timing and lets the homepage feed
     * request be filtered before B site's Vue grid renders carousel/ad/floor
     * cards. The default config has high-risk tracking/CDN switches off, but
     * homepage cleaning on, matching the extension defaults.
     */
    updateRootStateClasses();
    injectPageAgentIfNeeded();

    config = await CONFIG.readStorage();
    updateRootStateClasses();
    injectPageAgentIfNeeded();
    bindDomObserver();
    bindRouteWatcher();
    document.addEventListener("keydown", handleKeydown, true);
    scheduleScan();

    CONFIG.onConfigChanged((nextConfig) => {
      config = nextConfig;
      clearBiliArmMarks();
      appliedViewModeKey = "";
      updateRootStateClasses();
      scheduleScan();
    });
  }

  start().catch((error) => console.warn("[BiliArm] start failed", error));
})();
