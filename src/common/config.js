(function (global) {
  "use strict";

  const STORAGE_KEY = "biliArmConfig";
  const CONFIG_VERSION = 1;

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
    }
  };

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

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

  function normalizeConfig(config) {
    const normalized = deepMerge(DEFAULT_CONFIG, config || {});
    normalized.version = CONFIG_VERSION;

    if (!["normal", "wide", "webFullscreen"].includes(normalized.player.defaultViewMode)) {
      normalized.player.defaultViewMode = DEFAULT_CONFIG.player.defaultViewMode;
    }

    return normalized;
  }

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

  async function setConfigValue(path, value) {
    const config = await readStorage();
    return writeStorage(setByPath(config, path, value));
  }

  async function resetConfig() {
    return writeStorage(DEFAULT_CONFIG);
  }

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
