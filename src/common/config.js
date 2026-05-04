/*
 * BilibiliToys 共享配置辅助模块。
 *
 * SPDX-License-Identifier: MIT
 * 版权所有 (c) 2026 BilibiliToys 贡献者
 *
 * 部分默认值参考了以下扩展的行为：
 * - Better Bilibili 2026.02.13
 * - Bilibili Player Extension 3.0.2，作者 Guokai Han
 *
 * 原 CRX 脚本经过压缩。本文件将配置层重写为带文档、带注释、
 * 可维护并遵循 MIT 许可证的 BilibiliToys 代码。
 */

(function (global) {
  "use strict";

  /*
   * 所有扩展界面读写同一个 storage key。使用单个配置对象能简化导入导出，
   * 也能通过和 DEFAULT_CONFIG 合并来迁移旧配置。
   */
  const STORAGE_KEY = "biliArmConfig";
  const CONFIG_VERSION = 2;

  /*
   * 快捷键按分组保存，设置页可分别渲染“B 站默认快捷键”表格
   * 和可编辑的扩展快捷键表格。
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
    lightsToggle: { group: "全屏 / 显示", label: "关灯 / 开灯", code: "KeyI", ctrl: false, alt: false, shift: false, enabled: true },
    shortcutHelp: { group: "信息显示", label: "显示快捷键帮助", code: "Slash", ctrl: false, alt: true, shift: false, enabled: true }
  };

  /*
   * B 站默认快捷键刻意设为只读。设置页展示它们，
   * 方便用户修改扩展快捷键前了解可能的冲突。
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
   * 每个功能都有开关。模块总开关位于 modules 下，
   * 具体功能开关保存在各自模块对象中。
   */
  const DEFAULT_CONFIG = {
    version: CONFIG_VERSION,
    enabled: true,
    ui: {
      mode: "basic",
      showDanger: false
    },
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
      /* 原扩展未找到“标记当前 UP 主推荐”的对应实现，默认禁用这个未暴露配置项。 */
      markCurrentUp: false,
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

  /*
   * 配置对象只包含 JSON 兼容值，因此 JSON 克隆已经足够，
   * 也能保持设置页、内容脚本和弹窗中的行为一致。
   */
  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /*
   * 将用户已保存设置合并到新的默认值上。这样新版本可以添加开关，
   * 同时保留用户已有选择，不会破坏旧配置。
   */
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

  /*
   * 快捷键记录逐条规范化，因为导入数据可能缺少修饰键字段，
   * 或用字符串 "null" 表示已清空的按键。
   */
  function normalizeShortcut(shortcut, fallback) {
    const merged = deepMerge(fallback, shortcut || {});
    merged.enabled = Boolean(merged.enabled);
    merged.ctrl = Boolean(merged.ctrl);
    merged.alt = Boolean(merged.alt);
    merged.shift = Boolean(merged.shift);
    merged.code = typeof merged.code === "string" && merged.code !== "null" ? merged.code : null;
    return merged;
  }

  /*
   * normalizeConfig 是集中迁移入口。所有读取、写入和导入都会经过这里，
   * 确保 UI 与内容脚本拿到完整配置，并且枚举值都在支持范围内。
   */
  function normalizeConfig(config) {
    const normalized = deepMerge(DEFAULT_CONFIG, config || {});
    normalized.version = CONFIG_VERSION;

    if (!["normal", "wide", "webFullscreen"].includes(normalized.player.defaultViewMode)) {
      normalized.player.defaultViewMode = "normal";
    }

    if (!["basic", "pro"].includes(normalized.ui.mode)) {
      normalized.ui.mode = "basic";
    }

    /*
     * 历史版本里快捷键和样式模块同时存在 modules.* 与模块内部 enabled。
     * 设置页会把它们合并成同一个总开关；导入旧配置时，只要任意一侧为关，
     * 就按关闭处理，避免升级后意外重新启用模块。
     */
    normalized.modules.hotkeys = Boolean(normalized.modules.hotkeys && normalized.hotkeys.enabled);
    normalized.hotkeys.enabled = normalized.modules.hotkeys;
    normalized.modules.styles = Boolean(normalized.modules.styles && normalized.styles.enabled);
    normalized.styles.enabled = normalized.modules.styles;

    if (!normalized.blacklist.accountBlockEnabled) {
      normalized.blacklist.showAccountButton = false;
    }

    if (!["jpg", "png"].includes(normalized.media.screenshotFormat)) {
      normalized.media.screenshotFormat = "jpg";
    }

    Object.keys(DEFAULT_SHORTCUTS).forEach((id) => {
      normalized.hotkeys.shortcuts[id] = normalizeShortcut(normalized.hotkeys.shortcuts[id], DEFAULT_SHORTCUTS[id]);
    });

    return normalized;
  }

  /*
   * 从 sync storage 读取配置。静态检查时如果脚本不在扩展环境中运行，
   * 则回退到默认值而不是抛错。
   */
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

  /*
   * 配置规范化后写入 sync storage。返回规范化后的对象，
   * 让调用方无需再次读取即可立刻重渲染。
   */
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

  /*
   * 解析 "modules.homeClean" 这类点分路径。设置页使用这些路径，
   * 因此新增开关只需要声明数据，不必写专门的渲染代码。
   */
  function getByPath(config, path) {
    return path.split(".").reduce((cursor, part) => {
      if (!cursor || typeof cursor !== "object") {
        return undefined;
      }
      return cursor[part];
    }, config);
  }

  /*
   * 创建一个修改了指定点分路径的配置副本。原对象不被直接修改，
   * 便于理解渲染函数和导入流程。
   */
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
    if (path === "modules.hotkeys") {
      output.hotkeys.enabled = value;
    } else if (path === "hotkeys.enabled") {
      output.modules.hotkeys = value;
    } else if (path === "modules.styles") {
      output.styles.enabled = value;
    } else if (path === "styles.enabled") {
      output.modules.styles = value;
    } else if (path === "blacklist.accountBlockEnabled" && !value) {
      output.blacklist.showAccountButton = false;
    }
    return normalizeConfig(output);
  }

  /*
   * 给只需要更新单个设置项的简单 UI 控件使用的便捷函数。
   */
  async function setConfigValue(path, value) {
    const config = await readStorage();
    return writeStorage(setByPath(config, path, value));
  }

  /*
   * 恢复默认设置时不触碰 IndexedDB 黑名单记录，
   * 因为黑名单属于用户内容，不是普通偏好设置。
   */
  async function resetConfig() {
    return writeStorage(DEFAULT_CONFIG);
  }

  /*
   * 订阅扩展不同界面之间的配置变化。用户在弹窗或设置页切换开关时，
   * 内容脚本可通过它立刻响应。
   */
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

  /*
   * 暴露一个共享命名空间。所有 BilibiliToys 页面都会先加载本文件，
   * 显式列出公共 API 可避免意外产生全局变量。
   */
  global.BilibiliToysConfig = {
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
