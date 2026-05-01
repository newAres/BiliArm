(function (global) {
  "use strict";

  // 所有页面共享同一份配置键，避免 popup、设置页和 content script 读写不同步。
  const STORAGE_KEY = "biliArmConfig";
  const CONFIG_VERSION = 1;

  // 默认配置只表达用户偏好，不直接依赖任何页面 DOM，便于后续迁移。
  const DEFAULT_CONFIG = {
    version: CONFIG_VERSION,
    enabled: true,
    hotkeys: {
      enabled: false,
      spacePlayPause: false
    },
    player: {
      defaultDanmakuOff: false,
      autoPlay: false,
      exitFullscreenOnEnded: false,
      defaultViewMode: "normal"
    },
    danmaku: {
      hideBottomDanmaku: false
    },
    light: {
      defaultLightsOff: false,
      autoToggleOnScroll: false
    },
    pageCleanup: {
      removeLargeCarousel: false,
      keepHomeFeedOnRefresh: false
    },
    betterBilibili: {
      tweakLayout: true,
      purifyPage: true,
      showCommentIp: false,
      hideTopAdComments: false,
      showTopicTags: false,
      removeEndingPanel: true,
      preferPlaybackUrl: false,
      blockTrackingWebSocket: false,
      localBlacklistEnabled: true,
      filterRecommendations: true,
      homeHoverBlacklist: true,
      accountBlacklistAssist: false,
      playerQuadClickBlacklist: true,
      homeTripleClickTop: true
    },
    blacklist: {
      localText: ""
    }
  };

  // 只合并普通对象，数组和基础类型直接覆盖，防止配置结构被意外展开。
  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // 配置对象很小，JSON 克隆足够直接，也能去掉原型链上的噪音。
  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // 用默认配置兜底历史版本缺失字段，新增开关不会让老用户配置报错。
  function deepMerge(base, extra) {
    const output = deepClone(base);

    if (!isPlainObject(extra)) {
      return output;
    }

    Object.keys(extra).forEach((key) => {
      const extraValue = extra[key];
      const baseValue = output[key];

      if (isPlainObject(baseValue) && isPlainObject(extraValue)) {
        output[key] = deepMerge(baseValue, extraValue);
      } else {
        output[key] = extraValue;
      }
    });

    return output;
  }

  // 读取到的任意配置都必须经过规范化，保证 content script 可以安全使用。
  function normalizeConfig(config) {
    const normalized = deepMerge(DEFAULT_CONFIG, config || {});
    normalized.version = CONFIG_VERSION;

    if (!["normal", "wide", "webFullscreen"].includes(normalized.player.defaultViewMode)) {
      normalized.player.defaultViewMode = DEFAULT_CONFIG.player.defaultViewMode;
    }

    return normalized;
  }

  // 从浏览器同步存储读取配置；非扩展环境下返回默认值，方便本地语法检查。
  function readStorage() {
    return new Promise((resolve) => {
      if (!global.chrome || !chrome.storage || !chrome.storage.sync) {
        resolve(normalizeConfig());
        return;
      }

      chrome.storage.sync.get(STORAGE_KEY, (result) => {
        resolve(normalizeConfig(result && result[STORAGE_KEY]));
      });
    });
  }

  // 写入前再次规范化，避免设置页把非法枚举或残缺对象持久化。
  function writeStorage(config) {
    const normalized = normalizeConfig(config);

    return new Promise((resolve) => {
      if (!global.chrome || !chrome.storage || !chrome.storage.sync) {
        resolve(normalized);
        return;
      }

      chrome.storage.sync.set({ [STORAGE_KEY]: normalized }, () => {
        resolve(normalized);
      });
    });
  }

  // 支持用 dotted path 更新嵌套配置，设置页控件可以直接声明 data-config。
  function setByPath(config, path, value) {
    const parts = path.split(".");
    const output = deepClone(config);
    let cursor = output;

    parts.slice(0, -1).forEach((part) => {
      if (!isPlainObject(cursor[part])) {
        cursor[part] = {};
      }
      cursor = cursor[part];
    });

    cursor[parts[parts.length - 1]] = value;
    return normalizeConfig(output);
  }

  // 读取当前配置后只更新一个字段，减少 UI 侧手动合并配置的代码。
  async function setConfigValue(path, value) {
    const config = await readStorage();
    return writeStorage(setByPath(config, path, value));
  }

  // 恢复默认设置时保留统一的写入路径，方便后续加迁移逻辑。
  async function resetConfig() {
    return writeStorage(DEFAULT_CONFIG);
  }

  // 监听 storage 变化，让 popup、设置页、内容脚本能实时同步。
  function onConfigChanged(callback) {
    if (!global.chrome || !chrome.storage || !chrome.storage.onChanged) {
      return function noop() {};
    }

    const listener = (changes, areaName) => {
      if (areaName !== "sync" || !changes[STORAGE_KEY]) {
        return;
      }

      callback(normalizeConfig(changes[STORAGE_KEY].newValue));
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  global.BiliArmConfig = {
    STORAGE_KEY,
    DEFAULT_CONFIG,
    normalizeConfig,
    readStorage,
    writeStorage,
    setConfigValue,
    resetConfig,
    onConfigChanged
  };
})(globalThis);
