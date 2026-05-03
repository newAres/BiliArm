/*
 * BiliArm shared configuration helpers.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 BiliArm contributors
 *
 * Portions of the defaults mirror behavior observed in:
 * - Better Bilibili 2026.02.13
 * - Bilibili Player Extension 3.0.2 by Guokai Han
 *
 * The original CRX scripts were minified. This file rewrites the configuration
 * layer as documented, commented, maintainable MIT-licensed BiliArm code.
 */

(function (global) {
  "use strict";

  /*
   * All extension surfaces read and write the same storage key. Using one
   * object makes import/export simple and allows old configs to be migrated by
   * merging them with DEFAULT_CONFIG.
   */
  const STORAGE_KEY = "biliArmConfig";
  const CONFIG_VERSION = 2;

  /*
   * The shortcuts are separated into groups so the options page can render a
   * clear "B site defaults" table and a separate editable extension table.
   */
  const DEFAULT_SHORTCUTS = {
    danmakuToggle: { group: "弹幕 / 字幕", label: "切换弹幕", code: "KeyD", ctrl: false, alt: false, shift: false, enabled: true },
    danmakuStatus: { group: "弹幕 / 字幕", label: "显示弹幕状态", code: "KeyD", ctrl: false, alt: false, shift: true, enabled: true },
    captionToggle: { group: "弹幕 / 字幕", label: "切换字幕", code: "KeyC", ctrl: false, alt: false, shift: false, enabled: true },
    fullscreen: { group: "全屏 / 显示", label: "切换全屏", code: "KeyF", ctrl: false, alt: false, shift: false, enabled: true },
    webFullscreen: { group: "全屏 / 显示", label: "切换网页全屏", code: "KeyW", ctrl: false, alt: false, shift: false, enabled: true },
    widescreen: { group: "全屏 / 显示", label: "切换宽屏", code: "KeyT", ctrl: false, alt: false, shift: false, enabled: true },
    playPause: { group: "播放控制", label: "播放 / 暂停", code: "KeyK", ctrl: false, alt: false, shift: false, enabled: true },
    mute: { group: "播放控制", label: "静音 / 取消静音", code: "KeyM", ctrl: false, alt: false, shift: false, enabled: true },
    nextVideo: { group: "播放控制", label: "播放下一个视频", code: "KeyN", ctrl: false, alt: false, shift: false, enabled: true },
    shortBackward: { group: "跳转 / 逐帧", label: "短后退", code: "KeyJ", ctrl: false, alt: false, shift: false, enabled: true },
    longBackward: { group: "跳转 / 逐帧", label: "长后退", code: "KeyJ", ctrl: false, alt: false, shift: true, enabled: true },
    shortForward: { group: "跳转 / 逐帧", label: "短快进", code: "KeyL", ctrl: false, alt: false, shift: false, enabled: true },
    longForward: { group: "跳转 / 逐帧", label: "长快进", code: "KeyL", ctrl: false, alt: false, shift: true, enabled: true },
    previousFrame: { group: "跳转 / 逐帧", label: "上一帧", code: "Comma", ctrl: false, alt: false, shift: false, enabled: true },
    nextFrame: { group: "跳转 / 逐帧", label: "下一帧", code: "Period", ctrl: false, alt: false, shift: false, enabled: true },
    replay: { group: "跳转 / 逐帧", label: "从头播放", code: "Backspace", ctrl: false, alt: false, shift: true, enabled: true },
    pip: { group: "媒体增强", label: "画中画", code: "KeyP", ctrl: false, alt: false, shift: false, enabled: true },
    screenshotFile: { group: "媒体增强", label: "截图到文件", code: "KeyS", ctrl: false, alt: false, shift: true, enabled: true },
    screenshotClipboard: { group: "媒体增强", label: "截图到剪贴板", code: "KeyS", ctrl: false, alt: true, shift: true, enabled: true },
    speedUp: { group: "倍速", label: "提高倍速", code: "Equal", ctrl: false, alt: false, shift: false, enabled: true },
    speedDown: { group: "倍速", label: "降低倍速", code: "Minus", ctrl: false, alt: false, shift: false, enabled: true },
    speedReset: { group: "倍速", label: "恢复 1 倍速", code: "Digit0", ctrl: false, alt: false, shift: false, enabled: true },
    videoScaleUp: { group: "画面缩放", label: "放大视频", code: "Equal", ctrl: false, alt: false, shift: true, enabled: true },
    videoScaleDown: { group: "画面缩放", label: "缩小视频", code: "Minus", ctrl: false, alt: false, shift: true, enabled: true },
    videoScaleReset: { group: "画面缩放", label: "恢复视频大小", code: "Digit0", ctrl: false, alt: false, shift: true, enabled: true },
    titleOverlay: { group: "信息显示", label: "显示视频标题", code: "KeyB", ctrl: false, alt: false, shift: false, enabled: true },
    progressOverlay: { group: "信息显示", label: "显示播放进度", code: "KeyG", ctrl: false, alt: false, shift: false, enabled: true },
    clockOverlay: { group: "信息显示", label: "显示当前时间", code: "KeyH", ctrl: false, alt: false, shift: false, enabled: true },
    lightsToggle: { group: "全屏 / 显示", label: "关灯 / 开灯", code: "KeyI", ctrl: false, alt: false, shift: false, enabled: true }
  };

  /*
   * B site default shortcuts are intentionally read-only. They are displayed in
   * the settings UI so users understand collisions before changing extension
   * shortcuts.
   */
  const BILIBILI_DEFAULT_SHORTCUTS = [
    { label: "播放 / 暂停", shortcut: "Space", note: "B 站播放器默认快捷键" },
    { label: "后退", shortcut: "ArrowLeft", note: "B 站播放器默认快捷键" },
    { label: "前进", shortcut: "ArrowRight", note: "B 站播放器默认快捷键" },
    { label: "增加音量", shortcut: "ArrowUp", note: "B 站播放器默认快捷键" },
    { label: "降低音量", shortcut: "ArrowDown", note: "B 站播放器默认快捷键" },
    { label: "全屏", shortcut: "F", note: "B 站播放器常见默认快捷键" },
    { label: "退出全屏", shortcut: "Esc", note: "浏览器 / 播放器默认行为" },
    { label: "跳转 10% - 90%", shortcut: "1 - 9", note: "B 站播放器默认快捷键" },
    { label: "输入弹幕", shortcut: "Enter", note: "B 站播放器默认快捷键" }
  ];

  /*
   * Every feature has a switch. Module switches are under "modules"; detailed
   * feature switches live in their own module objects.
   */
  const DEFAULT_CONFIG = {
    version: CONFIG_VERSION,
    enabled: true,
    modules: {
      homeClean: true,
      blacklist: true,
      playRecommend: true,
      hotkeys: true,
      playerDefaults: true,
      danmaku: true,
      media: true,
      tracking: false,
      cdn: false,
      comments: true,
      styles: true
    },
    homeClean: {
      filterAds: true,
      filterLive: true,
      filterPromotions: true,
      filterNoDate: true,
      filterNoAuthor: true,
      filterAdLikeUsers: true,
      filterAdLikeTitles: true,
      keepFollowed: true,
      dynamicScan: true,
      showReasons: false
    },
    blacklist: {
      localEnabled: true,
      showLocalButton: true,
      showAccountButton: true,
      accountBlockEnabled: false,
      accountBlockConfirm: true,
      preferLocalBlock: true,
      importEnabled: true,
      exportEnabled: true
    },
    playRecommend: {
      hideBlockedUsers: true,
      dynamicScan: true,
      markCurrentUp: true,
      showReasons: false
    },
    hotkeys: {
      enabled: true,
      disableAll: false,
      spacePlayPause: true,
      groups: {
        danmaku: true,
        playback: true,
        fullscreen: true,
        pip: true,
        screenshot: true,
        speed: true,
        frame: true,
        scale: true,
        overlays: true
      },
      shortcuts: DEFAULT_SHORTCUTS
    },
    player: {
      defaultDanmakuOff: true,
      defaultViewModeEnabled: true,
      defaultViewMode: "normal",
      disableWideMode: false,
      autoPlay: false,
      exitFullscreenOnEnded: false,
      defaultLightsOff: false,
      smartLights: false
    },
    danmaku: {
      preventBottomDanmaku: false,
      subtitleHotkey: true,
      rememberCaption: true,
      titleOverlay: true,
      progressOverlay: true,
      clockOverlay: true,
      time24Hour: false,
      showSeconds: false,
      videoScaleHotkeys: true
    },
    media: {
      screenshotFile: true,
      screenshotClipboard: true,
      screenshotFormat: "jpg",
      pip: true,
      frameControl: true,
      replay: true,
      speedControl: true,
      shortStep: 5,
      longStep: 30,
      speedStep: 0.25
    },
    tracking: {
      blockWebSocket: false,
      blockSendBeacon: false,
      blockHomeLogs: false,
      blockPlayerLogs: false,
      blockXhrLogs: false,
      blockFetchLogs: false,
      keepFeedback: true
    },
    cdn: {
      avoidMcdn: false,
      avoidMountaintoys: false,
      preferCnBilivideo: true,
      fallbackOriginal: true
    },
    comments: {
      showIpLocation: false,
      showTopicTags: false,
      hidePinnedAdComment: false,
      commentAreaStyle: true,
      commentBoxStyle: true
    },
    styles: {
      enabled: true,
      home: true,
      play: true,
      search: true,
      bangumi: true,
      list: true
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
      const baseValue = output[key];
      const extraValue = extra[key];

      if (isPlainObject(baseValue) && isPlainObject(extraValue)) {
        output[key] = deepMerge(baseValue, extraValue);
      } else {
        output[key] = extraValue;
      }
    });

    return output;
  }

  function normalizeShortcut(shortcut, fallback) {
    const merged = deepMerge(fallback, shortcut || {});
    merged.enabled = Boolean(merged.enabled);
    merged.ctrl = Boolean(merged.ctrl);
    merged.alt = Boolean(merged.alt);
    merged.shift = Boolean(merged.shift);
    merged.code = typeof merged.code === "string" && merged.code !== "null" ? merged.code : null;
    return merged;
  }

  function normalizeConfig(config) {
    const normalized = deepMerge(DEFAULT_CONFIG, config || {});
    normalized.version = CONFIG_VERSION;

    if (!["normal", "wide", "webFullscreen"].includes(normalized.player.defaultViewMode)) {
      normalized.player.defaultViewMode = "normal";
    }

    if (!["jpg", "png"].includes(normalized.media.screenshotFormat)) {
      normalized.media.screenshotFormat = "jpg";
    }

    Object.keys(DEFAULT_SHORTCUTS).forEach((id) => {
      normalized.hotkeys.shortcuts[id] = normalizeShortcut(normalized.hotkeys.shortcuts[id], DEFAULT_SHORTCUTS[id]);
    });

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

  function getByPath(config, path) {
    return path.split(".").reduce((cursor, part) => {
      if (!cursor || typeof cursor !== "object") {
        return undefined;
      }
      return cursor[part];
    }, config);
  }

  function setByPath(config, path, value) {
    const output = deepClone(config);
    const parts = path.split(".");
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
    CONFIG_VERSION,
    DEFAULT_CONFIG,
    DEFAULT_SHORTCUTS,
    BILIBILI_DEFAULT_SHORTCUTS,
    deepClone,
    getByPath,
    setByPath,
    normalizeConfig,
    readStorage,
    writeStorage,
    setConfigValue,
    resetConfig,
    onConfigChanged
  };
})(globalThis);
