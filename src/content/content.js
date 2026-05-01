(function () {
  "use strict";

  const CONFIG = globalThis.BiliArmConfig;
  const STYLE_ID = "biliarm-runtime-style";
  const ROUTE_EVENT = "biliarm-route-change";
  const PLAYER_READY_TIMEOUT = 10000;

  let currentConfig = CONFIG.normalizeConfig();
  let lastUrl = location.href;
  let applyTimer = 0;
  let routeBound = false;
  let observer = null;
  let boundVideo = null;
  let applyState = createApplyState();

  const selectors = {
    video: [
      "video.bpx-player-video",
      ".bpx-player-video-wrap video",
      ".bilibili-player-video video",
      "video"
    ],
    danmakuSwitch: [
      ".bpx-player-dm-switch input[type='checkbox']",
      ".bpx-player-dm-switch",
      ".bilibili-player-video-danmaku-switch input[type='checkbox']",
      ".bilibili-player-video-btn-danmaku"
    ],
    wideButton: [
      ".bpx-player-ctrl-wide",
      ".bilibili-player-video-btn-widescreen"
    ],
    webFullscreenButton: [
      ".bpx-player-ctrl-web",
      ".bilibili-player-video-web-fullscreen",
      ".bilibili-player-video-btn-web-fullscreen"
    ],
    lightButton: [
      ".bpx-player-ctrl-light",
      ".bilibili-player-video-btn-light"
    ],
    playerContainer: [
      "#bilibili-player",
      ".bpx-player-container",
      ".bpx-player-primary-area",
      ".bilibili-player",
      ".bilibili-player-video"
    ],
    wideActive: [
      ".bpx-player-container[data-screen='wide']",
      ".bpx-player-container[data-screen='widescreen']",
      ".bpx-player-container.mode-widescreen",
      ".bilibili-player.mode-widescreen",
      ".player-mode-widescreen"
    ],
    webFullscreenActive: [
      ".bpx-player-container[data-screen='web']",
      ".bpx-player-container[data-screen='webfullscreen']",
      ".bpx-player-container.mode-webscreen",
      ".bpx-player-container.mode-web-fullscreen",
      ".bilibili-player.mode-webscreen",
      ".player-mode-webfullscreen"
    ],
    cleanupCarousel: [
      ".recommended-swipe",
      ".bili-feed4-layout .recommended-swipe",
      ".bili-grid .recommended-swipe",
      ".banner-card",
      ".carousel-area",
      ".large-header-v1 .banner",
      ".bili-header .animated-banner"
    ],
    bottomDanmaku: [
      ".bpx-player-row-dm-wrap",
      ".bilibili-player-video-danmaku .danmaku-item[data-mode='bottom']",
      ".bilibili-player-video-danmaku .mode-bottom",
      ".bilibili-danmaku-bottom"
    ]
  };

  function createApplyState() {
    return {
      autoPlayKey: "",
      danmakuKey: "",
      lightMode: null,
      viewModeKey: ""
    };
  }

  function resetApplyState() {
    applyState = createApplyState();
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

  function queryAll(list) {
    return list.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
  }

  function findVideo() {
    return queryAny(selectors.video);
  }

  function getLabel(node) {
    if (!node) {
      return "";
    }

    return [
      node.getAttribute("aria-label"),
      node.getAttribute("title"),
      node.getAttribute("data-title"),
      node.textContent
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  function isButtonActive(node) {
    if (!node) {
      return false;
    }

    const className = String(node.className || "");
    return (
      node.getAttribute("aria-pressed") === "true" ||
      node.getAttribute("aria-checked") === "true" ||
      node.checked === true ||
      /\b(active|selected|on|checked)\b/i.test(className)
    );
  }

  function isViewModeActive(mode, button) {
    const label = getLabel(button);

    if (mode === "wide") {
      return label.includes("退出宽屏") || Boolean(queryAny(selectors.wideActive));
    }

    if (mode === "webFullscreen") {
      return label.includes("退出网页全屏") || label.includes("退出全屏") || Boolean(queryAny(selectors.webFullscreenActive));
    }

    return mode === "normal";
  }

  function isBilibiliLightsOff(button) {
    const label = getLabel(button);
    const htmlClass = document.documentElement.className;
    const bodyClass = document.body ? document.body.className : "";

    if (label.includes("开灯") || label.includes("退出关灯")) {
      return true;
    }

    if (label.includes("关灯")) {
      return false;
    }

    return /light[-_]?off|lights[-_]?off|mode[-_]?light[-_]?off/i.test(`${htmlClass} ${bodyClass}`);
  }

  function clickElement(node) {
    if (!node) {
      return false;
    }

    const target = node.closest("button,[role='button'],label,.bpx-player-ctrl-btn") || node;
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    target.click();
    return true;
  }

  function findButtonByText(texts, fallbackSelectors) {
    const candidates = [
      ...queryAll(fallbackSelectors || []),
      ...Array.from(document.querySelectorAll("button,[role='button'],.bpx-player-ctrl-btn,.bilibili-player-video-btn"))
    ];

    return candidates.find((node) => {
      const label = getLabel(node);
      return texts.some((text) => label.includes(text));
    });
  }

  function setRuntimeStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }

    const hideCarousel = currentConfig.enabled && currentConfig.pageCleanup.removeLargeCarousel;
    const hideBottomDanmaku = currentConfig.enabled && currentConfig.danmaku.hideBottomDanmaku;

    style.textContent = `
      ${hideCarousel ? selectors.cleanupCarousel.join(",") + "{display:none!important;}" : ""}
      ${hideBottomDanmaku ? selectors.bottomDanmaku.join(",") + "{display:none!important;}" : ""}
    `;
  }

  function setDanmakuOff() {
    const input = queryAny(selectors.danmakuSwitch);
    if (!input) {
      const closeButton = findButtonByText(["关闭弹幕"], selectors.danmakuSwitch);
      if (closeButton) {
        clickElement(closeButton);
      }
      return;
    }

    if (input.matches("input[type='checkbox']")) {
      if (input.checked) {
        clickElement(input);
      }
      return;
    }

    const label = getLabel(input);
    if (label.includes("关闭弹幕") || isButtonActive(input)) {
      clickElement(input);
    }
  }

  function setLightsOff(off) {
    const desired = Boolean(off);
    const button = queryAny(selectors.lightButton) || findButtonByText(["关灯", "开灯"], selectors.lightButton);

    if (!button || applyState.lightMode === desired) {
      return;
    }

    if (isBilibiliLightsOff(button) !== desired) {
      clickElement(button);
    }

    applyState.lightMode = desired;
  }

  function scrollPlayerToCenter() {
    const video = findVideo();
    const player = queryAny(selectors.playerContainer) || (video ? video.closest("#bilibili-player,.bpx-player-container,.bilibili-player") : null) || video;

    if (!player) {
      return;
    }

    window.setTimeout(() => {
      const rect = player.getBoundingClientRect();
      const targetTop = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth"
      });
    }, 300);
  }

  function applyViewMode() {
    const mode = currentConfig.player.defaultViewMode;
    const applyKey = `${location.href}:${mode}`;

    if (applyState.viewModeKey === applyKey) {
      return;
    }

    if (mode === "wide") {
      const button = queryAny(selectors.wideButton) || findButtonByText(["宽屏"], selectors.wideButton);
      if (!button) {
        return;
      }
      if (!isButtonActive(button) && !isViewModeActive(mode, button)) {
        clickElement(button);
      }
      scrollPlayerToCenter();
      applyState.viewModeKey = applyKey;
      return;
    }

    if (mode === "webFullscreen") {
      const button = queryAny(selectors.webFullscreenButton) || findButtonByText(["网页全屏"], selectors.webFullscreenButton);
      if (!button) {
        return;
      }
      if (!isButtonActive(button) && !isViewModeActive(mode, button)) {
        clickElement(button);
      }
      applyState.viewModeKey = applyKey;
    }
  }

  function exitFullscreenIfNeeded() {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }

    const exitWebButton = findButtonByText(["退出网页全屏", "退出全屏"], selectors.webFullscreenButton);
    if (exitWebButton) {
      clickElement(exitWebButton);
    }
  }

  function bindEndedHandler(video) {
    if (!video || boundVideo === video) {
      return;
    }

    if (boundVideo) {
      boundVideo.removeEventListener("ended", handleVideoEnded);
    }

    boundVideo = video;
    boundVideo.addEventListener("ended", handleVideoEnded);
  }

  function handleVideoEnded() {
    if (currentConfig.enabled && currentConfig.player.exitFullscreenOnEnded) {
      exitFullscreenIfNeeded();
    }
  }

  function bindRouteWatcher() {
    if (routeBound) {
      return;
    }

    routeBound = true;
    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      history[method] = function patchedHistoryMethod() {
        const result = original.apply(this, arguments);
        window.dispatchEvent(new Event(ROUTE_EVENT));
        return result;
      };
    });

    window.addEventListener("popstate", () => window.dispatchEvent(new Event(ROUTE_EVENT)));
    window.addEventListener(ROUTE_EVENT, () => {
      if (lastUrl !== location.href) {
        lastUrl = location.href;
        resetApplyState();
        scheduleApply(350);
      }
    });
  }

  function bindDomObserver() {
    if (observer) {
      return;
    }

    observer = new MutationObserver(() => scheduleApply(500));
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function handleScroll() {
    if (!currentConfig.enabled || !currentConfig.light.autoToggleOnScroll) {
      return;
    }

    setLightsOff(window.scrollY > 120);
  }

  function bindScrollHandler() {
    let scrollTimer = 0;
    window.addEventListener(
      "scroll",
      () => {
        window.clearTimeout(scrollTimer);
        scrollTimer = window.setTimeout(handleScroll, 120);
      },
      { passive: true }
    );
  }

  function waitForPlayer(callback) {
    const startedAt = Date.now();

    function tick() {
      const video = findVideo();
      if (video) {
        callback(video);
        return;
      }

      if (Date.now() - startedAt < PLAYER_READY_TIMEOUT) {
        window.setTimeout(tick, 250);
      }
    }

    tick();
  }

  function applyFeatures() {
    setRuntimeStyle();

    if (!currentConfig.enabled) {
      return;
    }

    waitForPlayer((video) => {
      bindEndedHandler(video);

      const autoPlayKey = `${location.href}:${video.currentSrc || "video"}`;
      if (currentConfig.player.autoPlay && video.paused && applyState.autoPlayKey !== autoPlayKey) {
        applyState.autoPlayKey = autoPlayKey;
        video.play().catch(() => {});
      }

      const danmakuKey = `${location.href}:danmaku-off`;
      if (currentConfig.player.defaultDanmakuOff && applyState.danmakuKey !== danmakuKey) {
        applyState.danmakuKey = danmakuKey;
        setDanmakuOff();
      }

      if (currentConfig.player.defaultViewMode !== "normal") {
        applyViewMode();
      }

      if (currentConfig.light.autoToggleOnScroll) {
        setLightsOff(window.scrollY > 120);
      } else if (currentConfig.light.defaultLightsOff) {
        setLightsOff(true);
      }
    });
  }

  function scheduleApply(delay) {
    window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(applyFeatures, delay || 0);
  }

  async function start() {
    currentConfig = await CONFIG.readStorage();
    bindRouteWatcher();
    bindDomObserver();
    bindScrollHandler();
    scheduleApply(0);

    CONFIG.onConfigChanged((nextConfig) => {
      currentConfig = nextConfig;
      resetApplyState();
      scheduleApply(0);
    });
  }

  start();
})();
