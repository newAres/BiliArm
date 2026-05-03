/*
 * BiliArm page agent.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 BiliArm contributors
 *
 * This file runs in the web page MAIN world. It is intentionally isolated from
 * normal content-script logic because it patches page APIs such as fetch,
 * XMLHttpRequest, sendBeacon and WebSocket. The approach is inspired by the
 * reviewed Better Bilibili 2026.02.13 main-world scripts, rewritten with
 * explicit switches and comments for BiliArm.
 */

(function () {
  "use strict";

  const CONFIG_EVENT = "BiliArmPageConfig";
  const ORIGINALS = {};

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

  function moduleOn(name) {
    return Boolean(pageConfig.enabled && pageConfig.modules && pageConfig.modules[name]);
  }

  function getUrl(input) {
    if (typeof input === "string") {
      return input;
    }

    if (input && typeof input.url === "string") {
      return input.url;
    }

    return "";
  }

  function isTrackingLogUrl(url) {
    return [
      "data.bilibili.com/log/web",
      "data.bilibili.com/v2/log/web",
      "data.bilibili.com/v2/log/web?content_type=pbrequest",
      "api.bilibili.com/x/click-interface",
      "web-player-tracker.biliapi.net"
    ].some((needle) => String(url).includes(needle));
  }

  function isAllowedFeedbackUrl(url) {
    if (!pageConfig.tracking.keepFeedback) {
      return false;
    }

    return String(url).includes("dislike.click") || String(url).includes("dislike-cancel.click");
  }

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
    return HOME_FEED_ENDPOINTS.some((endpoint) => String(url).startsWith(endpoint));
  }

  function isBlockedHomeModuleUrl(url) {
    return HOME_BLOCKED_ENDPOINTS.some((endpoint) => String(url).includes(endpoint));
  }

  function tuneHomeFeedUrl(url) {
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
     * This follows Better Bilibili's request-level home feed filter. Removing
     * live/ad items before Vue renders the grid prevents empty cards and
     * late-hide flicker.
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
    const dash = extractDashFromPayload(payload);

    if (dash && dash.video && dash.audio) {
      latestDash = dash;
    }

    return payload;
  }

  function collectResourceUrls(resource) {
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
    const leftIsCn = /:\/\/cn-.+\.bilivideo\.com/.test(left);
    const rightIsCn = /:\/\/cn-.+\.bilivideo\.com/.test(right);

    if (pageConfig.cdn.preferCnBilivideo && leftIsCn !== rightIsCn) {
      return leftIsCn ? -1 : 1;
    }

    return 0;
  }

  function findCdnReplacement(url) {
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
      console.warn("[BiliArm] failed to install __playinfo__ hook", error);
    }
  }

  function installFetchPatch() {
    if (ORIGINALS.fetch) {
      return;
    }

    ORIGINALS.fetch = window.fetch;

    window.fetch = async function patchedFetch(input, init) {
      const url = getUrl(input);

      if (moduleOn("homeClean") && isBlockedHomeModuleUrl(url)) {
        return Promise.reject(new Error("BiliArm blocked homepage module request"));
      }

      if (moduleOn("tracking") && pageConfig.tracking.blockFetchLogs && isTrackingLogUrl(url) && !isAllowedFeedbackUrl(url)) {
        return makeEmptyJsonResponse();
      }

      const requestArgs = Array.prototype.slice.call(arguments);

      if (moduleOn("homeClean") && isHomeFeedUrl(url)) {
        requestArgs[0] = tuneHomeFeedUrl(url);
      }

      const response = await ORIGINALS.fetch.apply(this, requestArgs);

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
    if (ORIGINALS.xhrOpen) {
      return;
    }

    ORIGINALS.xhrOpen = XMLHttpRequest.prototype.open;
    ORIGINALS.xhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      let nextUrl = url;

      this.__biliarmUrl = String(url || "");

      if (moduleOn("cdn") && typeof nextUrl === "string" && shouldAvoidCdnUrl(nextUrl)) {
        nextUrl = findCdnReplacement(nextUrl);
        this.__biliarmUrl = nextUrl;
      }

      this.addEventListener("load", function onLoad() {
        const responseUrl = this.responseURL || this.__biliarmUrl || "";
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
          /* The response may not be JSON. In that case BiliArm leaves it alone. */
        }
      });

      return ORIGINALS.xhrOpen.call(this, method, nextUrl, ...Array.prototype.slice.call(arguments, 2));
    };

    XMLHttpRequest.prototype.send = function patchedSend() {
      if (moduleOn("tracking") && pageConfig.tracking.blockXhrLogs && isTrackingLogUrl(this.__biliarmUrl) && !isAllowedFeedbackUrl(this.__biliarmUrl)) {
        try {
          this.abort();
        } catch (error) {
          /* Abort can throw on some readyState transitions; swallowing keeps the page stable. */
        }
        return undefined;
      }

      return ORIGINALS.xhrSend.apply(this, arguments);
    };
  }

  function installBeaconPatch() {
    if (ORIGINALS.sendBeacon) {
      return;
    }

    ORIGINALS.sendBeacon = navigator.sendBeacon;

    navigator.sendBeacon = function patchedSendBeacon(url, data) {
      if (moduleOn("tracking") && pageConfig.tracking.blockSendBeacon && isTrackingLogUrl(url) && !isAllowedFeedbackUrl(url)) {
        return true;
      }

      return ORIGINALS.sendBeacon.apply(this, arguments);
    };
  }

  function installWebSocketPatch() {
    if (ORIGINALS.WebSocket) {
      return;
    }

    ORIGINALS.WebSocket = window.WebSocket;

    window.WebSocket = function patchedWebSocket(url, protocols) {
      if (moduleOn("tracking") && pageConfig.tracking.blockWebSocket && String(url).includes("web-player-tracker.biliapi.net")) {
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

  function installCustomElementPatch() {
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

      return ORIGINALS.customElementsDefine.call(this, name, constructor, options);
    };
  }

  function installPatches() {
    installPlayInfoHook();
    installFetchPatch();
    installXhrPatch();
    installBeaconPatch();
    installWebSocketPatch();
    installCustomElementPatch();
  }

  document.addEventListener(CONFIG_EVENT, (event) => {
    pageConfig = event.detail || pageConfig;
    installPatches();
  });

  installPatches();
})();
