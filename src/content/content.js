(function () {
  "use strict";

  // content script 运行在 B 站页面内，负责把用户配置转化为页面行为。
  const CONFIG = globalThis.BiliArmConfig;
  const STYLE_ID = "biliarm-runtime-style";
  const PRELOAD_STYLE_ID = "biliarm-preload-style";
  const ROUTE_EVENT = "biliarm-route-change";
  const PLAYER_READY_TIMEOUT = 10000;
  const CONTROL_READY_TIMEOUT = 6000;

  let currentConfig = CONFIG.normalizeConfig();
  let lastUrl = location.href;
  let applyTimer = 0;
  let routeBound = false;
  let observer = null;
  let boundVideo = null;
  let feedRefreshBound = false;
  let pendingFeedCards = [];
  let applyState = createApplyState();

  // 所有 DOM 选择器集中维护，B 站页面结构变化时优先改这里。
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
      "[aria-label*='关灯']",
      "[aria-label*='开灯']",
      "[title*='关灯']",
      "[title*='开灯']",
      "[data-title*='关灯']",
      "[data-title*='开灯']",
      "[data-tooltip*='关灯']",
      "[data-tooltip*='开灯']",
      ".bpx-player-ctrl-light",
      ".bpx-player-ctrl-btn[aria-label*='灯']",
      ".bilibili-player-video-btn-light",
      ".bilibili-player-video-btn-light-off",
      ".bpx-player-ctrl-light-off",
      ".bpx-player-ctrl-light-on"
    ],
    playerMenuButton: [
      ".bpx-player-ctrl-setting",
      ".bpx-player-ctrl-more",
      ".bilibili-player-video-btn-setting",
      ".bilibili-player-video-btn-more"
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
      ".large-header-v1 .banner",
      ".bili-header .animated-banner"
    ],
    liveSection: [
      ".bili-live-card",
      ".live-card",
      ".live-room-card",
      "[class*='live-card']",
      "[class*='LiveCard']",
      "[class*='live-room']",
      ".bili-video-card:has([class*='bangumi'])",
      ".bili-video-card:has([class*='pgc'])",
      ".bili-video-card:has(.bili-video-card__info--ad)",
      ".bili-video-card:has(a[href*='live.bilibili.com'])",
      ".bili-video-card:has(a[href*='/bangumi/'])",
      ".bili-video-card:has(a[href*='/anime/'])",
      ".bili-video-card:has(a[href*='/guochuang/'])",
      ".feed-card:has(a[href*='live.bilibili.com'])",
      ".feed-card:has(a[href*='/bangumi/'])",
      ".feed-card:has(a[href*='/anime/'])",
      ".feed-card:has(a[href*='/guochuang/'])"
    ],
    bottomDanmaku: [
      ".bpx-player-row-dm-wrap",
      ".bilibili-player-video-danmaku .danmaku-item[data-mode='bottom']",
      ".bilibili-player-video-danmaku .mode-bottom",
      ".bilibili-danmaku-bottom"
    ],
    homeFeedContainer: [
      ".bili-feed4-layout",
      ".bili-grid",
      ".recommended-container_floor-aside",
      ".container",
      "main"
    ],
    homeFeedCard: [
      ".bili-feed4-layout .bili-video-card",
      ".bili-grid .bili-video-card",
      ".feed-card",
      ".bili-video-card"
    ],
    homeFeedRefreshButton: [
      ".feed-roll-btn",
      ".primary-btn.roll-btn",
      "[class*='roll'][class*='btn']",
      "[class*='refresh']"
    ]
  };

  // 每次页面路由或配置变化后，幂等行为需要重新允许执行。
  function createApplyState() {
    return {
      autoPlayKey: "",
      danmakuKey: "",
      lightMode: null,
      viewModeKey: ""
    };
  }

  // 重置本轮页面状态，避免旧页面的“已执行”标记影响新视频。
  function resetApplyState() {
    applyState = createApplyState();
  }

  // document_start 时 head 可能还没就绪，所以样式统一走这个兜底函数。
  function appendStyleElement(style) {
    (document.head || document.documentElement).appendChild(style);
  }

  // 从一组选项里找到第一个存在的元素。
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

  // 批量查找多个选择器，用于候选按钮和卡片的合并处理。
  function queryAll(list) {
    return list.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
  }

  // 页面可能存在多个 video，优先选播放器内的 B 站 video。
  function findVideo() {
    return queryAny(selectors.video);
  }

  // B 站按钮经常用 title、aria-label 或 data-title 标识行为。
  function getLabel(node) {
    if (!node) {
      return "";
    }

    return [
      node.getAttribute("aria-label"),
      node.getAttribute("title"),
      node.getAttribute("data-title"),
      node.getAttribute("data-tooltip"),
      node.getAttribute("data-text"),
      node.textContent
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  // 判断按钮是否已激活，用于避免重复点击宽屏/网页全屏。
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

  // 宽屏和网页全屏有时不会给按钮 active 类，需要结合容器状态判断。
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

  // 判断 B 站自己的关灯状态；不同播放器版本的文案可能相反。
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

  // 统一模拟用户点击，先 hover 唤出播放器控制栏，再触发 click。
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

  // 在常规按钮集合里按文字查找控件。
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

  // 在更宽的原生控件集合里按文字查找，主要用于播放器浮层按钮。
  function findNativeControlByText(texts, fallbackSelectors) {
    const candidates = [
      ...queryAll(fallbackSelectors || []),
      ...Array.from(
        document.querySelectorAll(
          "button,[role='button'],a,[title],[aria-label],[data-title],[data-tooltip],.bpx-player-ctrl-btn,.bilibili-player-video-btn"
        )
      )
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
      appendStyleElement(style);
    }

    const preloadStyle = document.getElementById(PRELOAD_STYLE_ID);
    if (preloadStyle) {
      preloadStyle.remove();
    }

    const hideCarousel = currentConfig.enabled && currentConfig.pageCleanup.removeLargeCarousel;
    const hideBottomDanmaku = currentConfig.enabled && currentConfig.danmaku.hideBottomDanmaku;
    const hideLiveSection = currentConfig.enabled && currentConfig.pageCleanup.removeLiveSection;

    style.textContent = `
      ${hideCarousel ? selectors.cleanupCarousel.join(",") + "{display:none!important;}" : ""}
      ${hideLiveSection ? ".biliarm-hidden-feed-card{display:none!important;}" : ""}
      ${hideLiveSection ? ".bili-feed4-layout,.bili-grid{grid-auto-flow:dense!important;}" : ""}
      ${hideBottomDanmaku ? selectors.bottomDanmaku.join(",") + "{display:none!important;}" : ""}
      .biliarm-preserved-feed-card{display:block!important;}
      .biliarm-preserved-feed-card-start{grid-column-start:1!important;}
    `;
  }

  function setPreloadCleanupStyle() {
    if (document.getElementById(PRELOAD_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = PRELOAD_STYLE_ID;
    style.textContent = `${selectors.cleanupCarousel.join(",")}{display:none!important;}`;
    appendStyleElement(style);
  }

  // B 站首页的卡片外层会随版本变化，这里从命中的内部链接向上找到真正参与栅格布局的直接子项。
  function findHomeGridItem(node) {
    if (!node) {
      return null;
    }

    const card = node.closest(".bili-video-card,.feed-card,.floor-card,.bili-live-card,.live-card,.floor-single-card");
    if (!card || card.closest(".bili-header,.left-entry,.right-entry,.bili-channel,.channel-icons,.palette-button-wrap")) {
      return null;
    }

    if (card.matches(".floor-single-card") && card.querySelectorAll(".bili-video-card,.feed-card,.floor-card").length > 1) {
      return null;
    }

    return card;
  }

  // 统一隐藏整张首页卡片，避免只隐藏图片或链接后留下栅格空洞。
  function hideHomeFeedCard(node) {
    const card = findHomeGridItem(node);
    if (!card || card.classList.contains("biliarm-preserved-feed-card")) {
      return;
    }

    card.classList.add("biliarm-hidden-feed-card");
    card.setAttribute("data-biliarm-hidden", "true");
    card.style.display = "none";
  }

  // 首页直播/番剧/国创卡片有时只暴露内部链接，CSS 不能总是隐藏到卡片容器，这里做一次 DOM 兜底。
  function hideLiveModules() {
    if (!currentConfig.enabled || !currentConfig.pageCleanup.removeLiveSection) {
      return;
    }

    Array.from(document.querySelectorAll("a[href*='live.bilibili.com'],a[href*='/bangumi/'],a[href*='/anime/'],a[href*='/guochuang/']")).forEach((link) => {
      hideHomeFeedCard(link);
    });

    Array.from(document.querySelectorAll(".bili-video-card,.feed-card,.bili-live-card,.live-card")).forEach((card) => {
      const label = getLabel(card);
      if (["番剧", "国创", "综艺", "动漫", "直播"].some((text) => label.includes(text))) {
        hideHomeFeedCard(card);
      }
    });
  }

  // 默认关闭弹幕通过 B 站自带开关完成，避免直接改播放器内部状态。
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

  // 关灯只调用 B 站原生关灯控件，不再注入自定义遮罩。
  function setLightsOff(off) {
    const desired = Boolean(off);
    const player = queryAny(selectors.playerContainer);

    if (player) {
      player.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      player.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 120, clientY: 120 }));
    }

    let button = queryAny(selectors.lightButton) || findNativeControlByText(["关灯", "开灯"], selectors.lightButton);

    if (!button) {
      queryAll(selectors.playerMenuButton).forEach((menuButton) => {
        menuButton.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        menuButton.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        clickElement(menuButton);
      });
      button = queryAny(selectors.lightButton) || findNativeControlByText(["关灯", "开灯"], selectors.lightButton);
    }

    if (!button) {
      return;
    }

    const beforeState = isBilibiliLightsOff(button);
    if (beforeState !== desired) {
      clickElement(button);
      window.setTimeout(() => {
        queryAll(selectors.playerMenuButton).forEach((menuButton) => {
          menuButton.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        });
        const latestButton = queryAny(selectors.lightButton) || findNativeControlByText(["关灯", "开灯"], selectors.lightButton);
        if (latestButton && isBilibiliLightsOff(latestButton) !== desired) {
          clickElement(latestButton);
        }
      }, 300);
    }

    applyState.lightMode = desired;
  }

  // B 站控制栏和设置浮层有延迟，关灯失败时用短间隔重试几次。
  function scheduleLightsOff(desired) {
    [0, 250, 700, 1400].forEach((delay) => {
      window.setTimeout(() => setLightsOff(desired), delay);
    });
  }

  // 宽屏后滚动到播放器区域，但保留顶部安全距离，防止标题栏遮住画面。
  function scrollPlayerToCenter() {
    const video = findVideo();
    const player = queryAny(selectors.playerContainer) || (video ? video.closest("#bilibili-player,.bpx-player-container,.bilibili-player") : null) || video;

    if (!player) {
      return;
    }

    window.setTimeout(() => {
      const rect = player.getBoundingClientRect();
      const safeTop = 50;
      const centerTop = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
      const topAligned = window.scrollY + rect.top - safeTop;
      const targetTop = Math.min(centerTop, topAligned);
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth"
      });
    }, 300);
  }

  // 宽屏按钮比 video 更早出现，快速轮询可以让默认宽屏更接近进页即生效。
  function waitForPlayerControls(callback) {
    const startedAt = Date.now();

    function tick() {
      const hasControl = queryAny([...selectors.wideButton, ...selectors.webFullscreenButton]);
      if (hasControl) {
        callback();
        return;
      }

      if (Date.now() - startedAt < CONTROL_READY_TIMEOUT) {
        window.setTimeout(tick, 50);
      }
    }

    tick();
  }

  // 根据配置切换宽屏或网页全屏；每个 URL 只自动应用一次，避免来回切换。
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

  // 首页路径判断集中封装，避免把首页专用功能误用到播放页。
  function isHomePage() {
    return location.hostname === "www.bilibili.com" && (location.pathname === "/" || location.pathname === "");
  }

  // 优先以视频卡片父容器作为列表容器，兼容 B 站首页布局变化。
  function findHomeFeedContainer() {
    const cards = queryAll(selectors.homeFeedCard);
    if (cards.length > 0) {
      return cards[0].parentElement;
    }

    return queryAny(selectors.homeFeedContainer);
  }

  // 点击换一换前复制旧卡片，等待新卡片出现后追加到列表尾部。
  function cloneCurrentHomeFeedCards() {
    if (!isHomePage() || !currentConfig.enabled || !currentConfig.pageCleanup.keepHomeFeedOnRefresh) {
      return [];
    }

    const clones = queryAll(selectors.homeFeedCard)
      .filter((card) => !card.classList.contains("biliarm-preserved-feed-card"))
      .filter((card) => {
        const gridItem = findHomeGridItem(card);
        return !gridItem || !gridItem.classList.contains("biliarm-hidden-feed-card");
      })
      .slice(0, 24)
      .map((card) => {
        const clone = card.cloneNode(true);
        clone.classList.add("biliarm-preserved-feed-card");
        clone.setAttribute("data-biliarm-preserved", "true");
        return clone;
      });

    if (clones[0]) {
      clones[0].classList.add("biliarm-preserved-feed-card-start");
    }

    return clones;
  }

  // 将等待保留的旧卡片追加回首页列表。
  function appendPreservedFeedCards() {
    if (pendingFeedCards.length === 0) {
      return;
    }

    const container = findHomeFeedContainer();
    if (!container) {
      return;
    }

    const fragment = document.createDocumentFragment();
    pendingFeedCards.forEach((card) => fragment.appendChild(card));
    container.appendChild(fragment);
    pendingFeedCards = [];
  }

  // 识别首页“换一换/换一批”触发器，尽量兼容类名和文案。
  function isFeedRefreshTrigger(node) {
    if (!node) {
      return false;
    }

    const trigger = node.closest("button,[role='button'],a,.feed-roll-btn,.primary-btn,[class*='roll'],[class*='refresh']");
    if (!trigger) {
      return false;
    }

    const label = getLabel(trigger);
    return label.includes("换一换") || label.includes("换一批") || /roll|refresh/i.test(String(trigger.className || ""));
  }

  // 监听换一换点击，在页面替换列表后把旧列表补到后面。
  function bindHomeFeedRefreshKeeper() {
    if (feedRefreshBound) {
      return;
    }

    feedRefreshBound = true;
    document.addEventListener(
      "click",
      (event) => {
        if (!currentConfig.enabled || !currentConfig.pageCleanup.keepHomeFeedOnRefresh || !isFeedRefreshTrigger(event.target)) {
          return;
        }

        pendingFeedCards = cloneCurrentHomeFeedCards();
        window.setTimeout(appendPreservedFeedCards, 450);
        window.setTimeout(appendPreservedFeedCards, 1000);
      },
      true
    );
  }

  // 播放结束后退出浏览器全屏或 B 站网页全屏。
  function exitFullscreenIfNeeded() {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }

    const exitWebButton = findButtonByText(["退出网页全屏", "退出全屏"], selectors.webFullscreenButton);
    if (exitWebButton) {
      clickElement(exitWebButton);
    }
  }

  // 每个 video 元素只绑定一次 ended 事件，避免重复退出全屏。
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

  // ended 回调保持轻量，具体退出逻辑交给 exitFullscreenIfNeeded。
  function handleVideoEnded() {
    if (currentConfig.enabled && currentConfig.player.exitFullscreenOnEnded) {
      exitFullscreenIfNeeded();
    }
  }

  // B 站是 SPA，拦截 history 变化后重新应用当前配置。
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

  // 监听动态渲染，用防抖方式重新应用 CSS、过滤和播放器行为。
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

  // 滚动自动关灯只在用户开启该功能时生效。
  function handleScroll() {
    if (!currentConfig.enabled || !currentConfig.light.autoToggleOnScroll) {
      return;
    }

    scheduleLightsOff(window.scrollY > 120);
  }

  // 滚动事件节流，避免频繁查找播放器控件。
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

  // 播放器异步加载，等待 video 出现后再执行播放器相关逻辑。
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

  // 主应用流程：先写样式和页面增强，再等待播放器并执行播放增强。
  function applyFeatures() {
    setRuntimeStyle();

    if (!currentConfig.enabled) {
      return;
    }

    hideLiveModules();

    if (currentConfig.player.defaultViewMode !== "normal") {
      waitForPlayerControls(applyViewMode);
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
        scheduleLightsOff(window.scrollY > 120);
      } else if (currentConfig.light.defaultLightsOff) {
        scheduleLightsOff(true);
      }
    });
  }

  // 防抖调度页面增强，避免 MutationObserver 触发过密。
  function scheduleApply(delay) {
    window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(applyFeatures, delay || 0);
  }

  // 初始化顺序：先预隐藏轮播，再读取配置并绑定全局监听。
  async function start() {
    setPreloadCleanupStyle();
    currentConfig = await CONFIG.readStorage();
    bindRouteWatcher();
    bindDomObserver();
    bindScrollHandler();
    bindHomeFeedRefreshKeeper();
    if (currentConfig.enabled && currentConfig.player.defaultViewMode !== "normal") {
      waitForPlayerControls(applyViewMode);
    }
    scheduleApply(0);

    CONFIG.onConfigChanged((nextConfig) => {
      currentConfig = nextConfig;
      resetApplyState();
      scheduleApply(0);
    });
  }

  start();
})();
