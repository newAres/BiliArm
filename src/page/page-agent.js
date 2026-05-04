/*
 * BilibiliToys 页面代理脚本。
 *
 * SPDX-License-Identifier: MIT
 * 版权所有 (c) 2026 BilibiliToys 贡献者
 *
 * 本文件运行在网页 MAIN world 中。它会 patch fetch、XMLHttpRequest、
 * sendBeacon 和 WebSocket 等页面 API，因此刻意与普通内容脚本逻辑隔离。
 * 实现思路参考了 Better Bilibili 2026.02.13 的 main-world 脚本，
 * 并为 BilibiliToys 重写为显式开关和带注释的结构。
 */

(function () {
  "use strict";

  const CONFIG_EVENT = "BilibiliToysPageConfig";
  const ORIGINALS = {};

  /*
   * pageConfig 由内容脚本通过 DOM CustomEvent 更新。
   * 默认值保持保守：在内容脚本确认启用模块前，已注入的 patch 不做实际拦截。
   */
  let pageConfig = {
    enabled: false,
    modules: {},
    tracking: {},
    cdn: {},
    comments: {},
    homeClean: {}
  };

  let latestDash = null;
  const cdnReplacementCache = new Map();

  /*
   * MAIN world 功能同样遵循与隔离内容脚本一致的全局 / 模块开关模型。
   */
  function moduleOn(name) {
    return Boolean(pageConfig.enabled && pageConfig.modules && pageConfig.modules[name]);
  }

  /*
   * 将 fetch / XMLHttpRequest 输入规范化为 URL 字符串。
   * fetch 可能接收字符串、Request 对象或类似 URL 的对象。
   */
  function getUrl(input) {
    if (typeof input === "string") {
      return input;
    }

    if (input && typeof input.url === "string") {
      return input.url;
    }

    return "";
  }

  /*
   * 已知日志与追踪端点。具体由各个追踪开关决定哪个被 patch 的 API 可以拦截它们。
   */
  function isTrackingLogUrl(url) {
    return [
      "data.bilibili.com/log/web",
      "data.bilibili.com/v2/log/web",
      "data.bilibili.com/v2/log/web?content_type=pbrequest",
      "api.bilibili.com/x/click-interface",
      "web-player-tracker.biliapi.net"
    ].some((needle) => String(url).includes(needle));
  }

  /*
   * 即使开启日志拦截，也可以保留反馈 / 点踩端点，
   * 因为用户通常期望负反馈行为继续生效。
   */
  function isAllowedFeedbackUrl(url) {
    if (!pageConfig.tracking.keepFeedback) {
      return false;
    }

    return String(url).includes("dislike.click") || String(url).includes("dislike-cancel.click");
  }

  function isHomePage() {
    return location.hostname === "www.bilibili.com" && (location.pathname === "/" || location.pathname === "/index.html");
  }

  function isPlayerPage() {
    return location.hostname === "www.bilibili.com" && /^\/(video|bangumi|cheese|list)\//.test(location.pathname);
  }

  function shouldBlockTrackingRequest(url, transport) {
    /*
     * Better Bilibili 原实现是按日志 URL 拦截。BilibiliToys 在此基础上补充分场景开关：
     * 首页日志和播放器日志只在对应页面生效，避免影响其他页面的必要请求。
     */
    if (!moduleOn("tracking") || !isTrackingLogUrl(url) || isAllowedFeedbackUrl(url)) {
      return false;
    }

    if (transport === "fetch" && pageConfig.tracking.blockFetchLogs) {
      return true;
    }

    if (transport === "xhr" && pageConfig.tracking.blockXhrLogs) {
      return true;
    }

    if (transport === "beacon" && pageConfig.tracking.blockSendBeacon) {
      return true;
    }

    if (transport === "websocket" && pageConfig.tracking.blockWebSocket) {
      return true;
    }

    return Boolean((pageConfig.tracking.blockHomeLogs && isHomePage()) || (pageConfig.tracking.blockPlayerLogs && isPlayerPage()));
  }

  /*
   * 当页面期望 fetch 返回 JSON 时，成功的空 JSON 响应比直接 reject 更不容易破坏页面。
   */
  function makeEmptyJsonResponse() {
    return new Response(JSON.stringify({}), {
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": "application/json"
      }
    });
  }

  const HOME_FEED_ENDPOINTS = [
    "//api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd",
    "https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd"
  ];

  const HOME_BLOCKED_ENDPOINTS = [
    "/x/web-interface/dynamic/region",
    "manga.bilibili.com/twirp/comic.v1.MainStation/Feed",
    "/pgc/web/timeline/v2",
    "api.live.bilibili.com/xlive/web-interface/v1/webMain/getMoreRecList",
    "/x/web-show/res/locs",
    "twirp/comic.v1.Comic/HomeHot",
    "/twirp/comic.v1.Comic/Recommend",
    "/pugv/app/web/floor/switch",
    "cm.bilibili.com/cm/api/fees/pc"
  ];

  function isHomeFeedUrl(url) {
    /*
     * 推荐流端点在请求层调整和过滤，以避免可见的轮播 / 卡片闪烁。
     */
    return HOME_FEED_ENDPOINTS.some((endpoint) => String(url).startsWith(endpoint));
  }

  function isBlockedHomeModuleUrl(url) {
    /*
     * 这些模块会向首页添加非视频楼层、直播块或推广内容。
     * 在渲染前阻断它们可保持网格对齐。
     */
    return HOME_BLOCKED_ENDPOINTS.some((endpoint) => String(url).includes(endpoint));
  }

  function tuneHomeFeedUrl(url) {
    /*
     * 贴近 Better Bilibili 的策略：根据当前网格列数请求足够的推荐项，
     * 避免移除过滤卡片后留下空洞。
     */
    const source = String(url);

    if (!source.includes("fresh_type=")) {
      return source;
    }

    const columns = window.innerWidth < 1140 ? 3 : window.innerWidth < 1400 ? 4 : 5;
    const isRefresh = source.includes("fresh_type=3");
    const ps = isRefresh ? 2 * columns + 1 : 4 * columns + 1;

    return source
      .replace(/ps=\d{1,2}/, `ps=${ps}`)
      .replace(/y_num=\d{1,2}/, `y_num=${columns}`)
      .replace(/last_y_num=\d{1,2}/, `last_y_num=${columns}`);
  }

  function filterHomeFeedPayload(payload) {
    const items = payload?.data?.item;

    if (!Array.isArray(items)) {
      return payload;
    }

    /*
     * 这里沿用 Better Bilibili 的请求级首页推荐过滤。
     * 在 Vue 渲染网格前移除直播 / 广告项，可避免空白卡片和后置隐藏闪烁。
     */
    payload.data.item = items.filter((item) => {
      if (pageConfig.homeClean.filterLive && item?.goto === "live") {
        return false;
      }

      if ((pageConfig.homeClean.filterAds || pageConfig.homeClean.filterPromotions) && item?.goto === "ad") {
        return false;
      }

      return Boolean(item?.is_followed || item?.owner?.mid);
    });

    return payload;
  }

  function extractDashFromPayload(payload) {
    /*
     * B 站播放信息在普通视频、PGC 和旧播放器 API 中可能有不同嵌套结构，
     * 因此检查所有已知路径。
     */
    if (!payload || typeof payload !== "object") {
      return null;
    }

    return (
      payload.dash ||
      payload.data?.dash ||
      payload.result?.video_info?.dash ||
      payload.data?.video_info?.dash ||
      payload.raw?.data?.video_info?.dash ||
      null
    );
  }

  function rememberDashFromPayload(payload) {
    /*
     * 缓存最新 DASH 资源列表。后续 CDN 替换需要完整的 base 与 backup URL，
     * 才能挑选替代节点。
     */
    const dash = extractDashFromPayload(payload);

    if (dash && dash.video && dash.audio) {
      latestDash = dash;
    }

    return payload;
  }

  function collectResourceUrls(resource) {
    /*
     * DASH 资源字段会随 API 版本使用 camelCase 或 snake_case。
     * 这里把两种字段都收集到同一个去重列表中。
     */
    const urls = new Set();

    if (!resource) {
      return [];
    }

    if (resource.baseUrl) {
      urls.add(resource.baseUrl);
    }

    if (resource.base_url) {
      urls.add(resource.base_url);
    }

    (resource.backupUrl || []).forEach((url) => url && urls.add(url));
    (resource.backup_url || []).forEach((url) => url && urls.add(url));

    return Array.from(urls);
  }

  function shouldAvoidCdnUrl(url) {
    /*
     * CDN 规避是可选功能，并且只作用于设置中选择的已知主机。
     */
    if (!moduleOn("cdn")) {
      return false;
    }

    if (pageConfig.cdn.avoidMcdn && String(url).includes("mcdn.bilivideo")) {
      return true;
    }

    if (pageConfig.cdn.avoidMountaintoys && String(url).includes("edge.mountaintoys.cn")) {
      return true;
    }

    return false;
  }

  function sortCandidateUrls(left, right) {
    /*
     * 可选偏好：启用后 cn-*.bilivideo.com 候选地址会排在前面；
     * 否则保持服务端提供的顺序。
     */
    const leftIsCn = /:\/\/cn-.+\.bilivideo\.com/.test(left);
    const rightIsCn = /:\/\/cn-.+\.bilivideo\.com/.test(right);

    if (pageConfig.cdn.preferCnBilivideo && leftIsCn !== rightIsCn) {
      return leftIsCn ? -1 : 1;
    }

    return 0;
  }

  function findCdnReplacement(url) {
    /*
     * 从同一个 DASH 音频 / 视频资源中查找替代 URL。
     * 缓存可避免每个 range 请求都重复搜索。
     */
    if (!latestDash || !shouldAvoidCdnUrl(url)) {
      return url;
    }

    if (cdnReplacementCache.has(url)) {
      return cdnReplacementCache.get(url);
    }

    const resourceLists = [latestDash.video || [], latestDash.audio || []];

    for (const list of resourceLists) {
      for (const resource of list) {
        const urls = collectResourceUrls(resource);

        if (!urls.includes(url)) {
          continue;
        }

        const replacement = urls
          .filter((candidate) => !shouldAvoidCdnUrl(candidate))
          .sort(sortCandidateUrls)[0];

        if (replacement) {
          cdnReplacementCache.set(url, replacement);
          return replacement;
        }
      }
    }

    return pageConfig.cdn.fallbackOriginal ? url : url;
  }

  function installPlayInfoHook() {
    /*
     * 部分 B 站页面会通过给 window.__playinfo__ 赋值暴露播放信息。
     * hook setter 可在媒体请求开始前捕获 DASH 候选地址。
     */
    if (ORIGINALS.playInfoHookInstalled) {
      return;
    }

    ORIGINALS.playInfoHookInstalled = true;

    let playInfoValue;

    try {
      Object.defineProperty(window, "__playinfo__", {
        configurable: true,
        get() {
          return playInfoValue;
        },
        set(value) {
          playInfoValue = rememberDashFromPayload(value);
        }
      });
    } catch (error) {
      console.warn("[BilibiliToys] failed to install __playinfo__ hook", error);
    }
  }

  function installFetchPatch() {
    /*
     * fetch 只 patch 一次。运行时开关在 patched 函数内部读取，
     * 因此后续修改设置不需要卸载 patch。
     */
    if (ORIGINALS.fetch) {
      return;
    }

    ORIGINALS.fetch = window.fetch;

    window.fetch = async function patchedFetch(input, init) {
      const url = getUrl(input);

      /*
       * 提前 reject 已知首页模块请求，避免 B 站一开始就渲染轮播 / 直播 / 广告楼层数据。
       */
      if (moduleOn("homeClean") && isBlockedHomeModuleUrl(url)) {
        return Promise.reject(new Error("BilibiliToys blocked homepage module request"));
      }

      if (shouldBlockTrackingRequest(url, "fetch")) {
        return makeEmptyJsonResponse();
      }

      const requestArgs = Array.prototype.slice.call(arguments);

      if (moduleOn("homeClean") && isHomeFeedUrl(url)) {
        requestArgs[0] = tuneHomeFeedUrl(url);
      }

      const response = await ORIGINALS.fetch.apply(this, requestArgs);

      /*
       * 读取 JSON 前先 clone 响应，这样解析或过滤失败时仍能原样返回原响应体。
       */
      if (moduleOn("homeClean") && isHomeFeedUrl(url)) {
        try {
          const data = filterHomeFeedPayload(await response.clone().json());
          return new Response(JSON.stringify(data), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (error) {
          return response;
        }
      }

      if (moduleOn("comments") && url.includes("reply/wbi/main?oid")) {
        /*
         * 评论载荷修改仅限可选的 IP 属地显示和置顶广告评论移除。
         */
        try {
          const data = await response.clone().json();

          if (!pageConfig.comments.showIpLocation && data.data) {
            delete data.data.cm_info;
          }

          if (pageConfig.comments.hidePinnedAdComment && data.data?.top?.upper?.content?.jump_url) {
            delete data.data.top;
            delete data.data.top_replies;
          }

          return new Response(JSON.stringify(data), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (error) {
          return response;
        }
      }

      return response;
    };
  }

  function installXhrPatch() {
    /*
     * patch XHR 用于两件事：请求打开前替换 CDN URL，
     * 以及 playurl 请求完成后捕获播放信息。
     */
    if (ORIGINALS.xhrOpen) {
      return;
    }

    ORIGINALS.xhrOpen = XMLHttpRequest.prototype.open;
    ORIGINALS.xhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      let nextUrl = url;

      /*
       * 将 URL 存在 XHR 实例上，让 send / load 处理器可以判断目标，
       * 同时不改变公开的 XHR API 表面。
       */
      this.__bilibiliToysUrl = String(url || "");

      if (moduleOn("cdn") && typeof nextUrl === "string" && shouldAvoidCdnUrl(nextUrl)) {
        nextUrl = findCdnReplacement(nextUrl);
        this.__bilibiliToysUrl = nextUrl;
      }

      this.addEventListener("load", function onLoad() {
        const responseUrl = this.responseURL || this.__bilibiliToysUrl || "";
        const isPlayUrl = [
          "https://api.bilibili.com/x/player/wbi/playurl",
          "https://api.bilibili.com/pgc/player/web/v2/playurl",
          "https://api.bilibili.com/ogv/player/playview"
        ].some((needle) => responseUrl.startsWith(needle));

        if (!isPlayUrl) {
          return;
        }

        try {
          const parsed = rememberDashFromPayload(JSON.parse(this.responseText));
          Object.defineProperty(this, "responseText", {
            configurable: true,
            value: JSON.stringify(parsed)
          });
        } catch (error) {
          /* 响应可能不是 JSON，这种情况下 BilibiliToys 会保持原样。 */
        }
      });

      return ORIGINALS.xhrOpen.call(this, method, nextUrl, ...Array.prototype.slice.call(arguments, 2));
    };

    XMLHttpRequest.prototype.send = function patchedSend() {
      /*
       * 日志 XHR 会在 send 阶段中止，因为此时 open() 已经记录了目标 URL。
       */
      if (shouldBlockTrackingRequest(this.__bilibiliToysUrl, "xhr")) {
        try {
          this.abort();
        } catch (error) {
          /* 某些 readyState 切换中 abort 可能抛错；吞掉错误可保持页面稳定。 */
        }
        return undefined;
      }

      return ORIGINALS.xhrSend.apply(this, arguments);
    };
  }

  function installBeaconPatch() {
    /*
     * sendBeacon 调用方期望得到布尔值。对被拦截日志返回 true，
     * 可让页面认为入队已成功。
     */
    if (ORIGINALS.sendBeacon) {
      return;
    }

    ORIGINALS.sendBeacon = navigator.sendBeacon;

    navigator.sendBeacon = function patchedSendBeacon(url, data) {
      if (shouldBlockTrackingRequest(url, "beacon")) {
        return true;
      }

      return ORIGINALS.sendBeacon.apply(this, arguments);
    };
  }

  function installWebSocketPatch() {
    /*
     * WebSocket patch 会给追踪端点返回一个假的已关闭 socket。
     * 其结构足够接近 WebSocket，便于页面代码继续挂载处理器。
     */
    if (ORIGINALS.WebSocket) {
      return;
    }

    ORIGINALS.WebSocket = window.WebSocket;

    window.WebSocket = function patchedWebSocket(url, protocols) {
      if (shouldBlockTrackingRequest(url, "websocket")) {
        const fakeSocket = {
          readyState: ORIGINALS.WebSocket.CLOSED,
          url,
          close() {},
          send() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {
            return true;
          },
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null
        };

        Object.setPrototypeOf(fakeSocket, ORIGINALS.WebSocket.prototype);
        return fakeSocket;
      }

      return new ORIGINALS.WebSocket(url, protocols);
    };

    window.WebSocket.prototype = ORIGINALS.WebSocket.prototype;
    window.WebSocket.CONNECTING = ORIGINALS.WebSocket.CONNECTING;
    window.WebSocket.OPEN = ORIGINALS.WebSocket.OPEN;
    window.WebSocket.CLOSING = ORIGINALS.WebSocket.CLOSING;
    window.WebSocket.CLOSED = ORIGINALS.WebSocket.CLOSED;
  }

  function appendShadowStyle(host, id, cssText) {
    if (!host.shadowRoot || host.shadowRoot.getElementById(id)) {
      return;
    }

    const style = document.createElement("style");
    style.id = id;
    style.textContent = cssText;
    host.shadowRoot.appendChild(style);
  }

  function installCustomElementPatch() {
    /*
     * 评论渲染在带 shadow DOM 的 web component 内。
     * 包装 customElements.define 后，BilibiliToys 可在组件连接后添加小段样式，
     * 无需修改 B 站组件源码。
     */
    if (ORIGINALS.customElementsDefine) {
      return;
    }

    ORIGINALS.customElementsDefine = customElements.define;

    customElements.define = function patchedDefine(name, constructor, options) {
      if (name === "bili-comment-action-buttons-renderer") {
        const Wrapped = class extends constructor {
          connectedCallback() {
            if (super.connectedCallback) {
              super.connectedCallback();
            }

            if (!moduleOn("comments") || !pageConfig.comments.showIpLocation || !this.shadowRoot) {
              return;
            }

            const locationText = this.__data?.reply_control?.location;
            if (!locationText) {
              return;
            }

            const style = new CSSStyleSheet();
            style.replaceSync(`#reply::after{content:"${String(locationText).replace(/"/g, '\\"')}";margin-left:12px;font-size:12px;color:#8aa0b4;}`);
            this.shadowRoot.adoptedStyleSheets = [...this.shadowRoot.adoptedStyleSheets, style];
          }
        };

        return ORIGINALS.customElementsDefine.call(this, name, Wrapped, options);
      }

      if (name === "bili-comments-header-renderer") {
        const Wrapped = class extends constructor {
          connectedCallback() {
            if (super.connectedCallback) {
              super.connectedCallback();
            }

            appendShadowStyle(this, "bilibili-toys-comment-area-style", `
              .bili-comments-bottom-fixed-wrapper{margin-bottom:var(--bilibili-toys-comment-fixed-margin);}
              .bili-comments-bottom-fixed-wrapper>div{
                background-color:var(--bilibili-toys-comment-fixed-bg)!important;
                border-radius:var(--bilibili-toys-comment-fixed-radius);
                border:var(--bilibili-toys-comment-fixed-border)!important;
                box-shadow:var(--bilibili-toys-comment-fixed-shadow);
                padding:var(--bilibili-toys-comment-fixed-padding)!important;
              }
            `);
          }
        };

        return ORIGINALS.customElementsDefine.call(this, name, Wrapped, options);
      }

      if (name === "bili-comment-box") {
        const Wrapped = class extends constructor {
          connectedCallback() {
            if (super.connectedCallback) {
              super.connectedCallback();
            }

            appendShadowStyle(this, "bilibili-toys-comment-box-style", `
              #comment-area{margin-right:var(--bilibili-toys-comment-box-margin);}
              #editor{
                background-color:var(--bilibili-toys-comment-editor-bg);
                border:var(--bilibili-toys-comment-editor-border);
                border-radius:var(--bilibili-toys-comment-editor-radius);
              }
              button.tool-btn{border-radius:var(--bilibili-toys-comment-tool-radius);}
            `);
          }
        };

        return ORIGINALS.customElementsDefine.call(this, name, Wrapped, options);
      }

      return ORIGINALS.customElementsDefine.call(this, name, constructor, options);
    };
  }

  function installPatches() {
    /*
     * 幂等安装所有 patch。每个安装器都会在替换前保存原始 API，
     * 后续再次调用会直接跳过。
     */
    installPlayInfoHook();
    installFetchPatch();
    installXhrPatch();
    installBeaconPatch();
    installWebSocketPatch();
    installCustomElementPatch();
  }

  document.addEventListener(CONFIG_EVENT, (event) => {
    /*
     * 设置变化时内容脚本会发送最新配置。patch 动态读取 pageConfig，
     * 因此可立即响应开关变化。
     */
    pageConfig = event.detail || pageConfig;
    installPatches();
  });

  installPatches();
})();
