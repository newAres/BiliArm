/*
 * BiliArm 完整设置页。
 *
 * SPDX-License-Identifier: MIT
 * 版权所有 (c) 2026 BiliArm 贡献者
 *
 * 本文件根据声明式元数据渲染全部设置，确保每个功能都有可见开关。
 * 快捷键编辑器参考原 Bilibili Player Extension 快捷键页重写，
 * 便于维护。
 */

(function () {
  "use strict";

  const CONFIG = globalThis.BiliArmConfig;

  let config = CONFIG.normalizeConfig();
  let activeSection = "basic";
  let editingShortcutId = "";
  let pendingShortcut = null;
  let theme = localStorage.getItem("biliarm-theme") || "light";

  /*
   * 左侧导航元数据。渲染器同时用它生成导航按钮和章节标题，
   * 让标签与说明集中维护。
   */
  const sections = [
    { id: "basic", label: "基本设置", description: "控制扩展总开关和主要模块开关。" },
    { id: "home", label: "首页净化", description: "过滤首页推荐流中的广告、直播、推广和疑似低质量内容。" },
    { id: "blacklist", label: "黑名单", description: "管理本地黑名单和账号拉黑行为。" },
    { id: "player", label: "播放器", description: "设置播放器默认状态和播放行为。" },
    { id: "danmaku", label: "弹幕 / 字幕", description: "控制弹幕、字幕、信息浮层和画面缩放。" },
    { id: "media", label: "截图 / 媒体", description: "设置截图、画中画、逐帧、倍速等媒体增强功能。" },
    { id: "shortcuts", label: "快捷键", description: "查看 B 站默认快捷键，并修改扩展功能快捷键。" },
    { id: "tracking", label: "反追踪", description: "控制日志、埋点、WebSocket 追踪和网络拦截。" },
    { id: "cdn", label: "CDN 优化", description: "避开指定播放 CDN 地址，并在失败时回退。" },
    { id: "comments", label: "评论增强", description: "控制评论 IP 属地、话题标签和置顶广告评论。" },
    { id: "styles", label: "页面样式", description: "按页面控制样式优化和隐藏规则。" },
    { id: "data", label: "导入 / 导出", description: "导入导出黑名单和全部设置。" },
    { id: "advanced", label: "高级设置", description: "重置配置和查看许可证说明。" }
  ];

  /*
   * 声明式设置结构。每个条目都会渲染成一行 UI，
   * 新增开关时不需要再写专门的渲染函数。
   */
  const settingGroups = {
    basic: [
      switchSetting("enabled", "启用 BiliArm", "关闭后所有模块都停止执行。"),
      switchSetting("modules.homeClean", "首页净化模块", "控制首页推荐流过滤。"),
      switchSetting("modules.blacklist", "黑名单模块", "控制本地黑名单、拉黑按钮和账号拉黑。"),
      switchSetting("modules.playRecommend", "播放页推荐屏蔽模块", "根据黑名单隐藏播放页右侧推荐。"),
      switchSetting("modules.hotkeys", "快捷键模块", "控制全部扩展快捷键。"),
      switchSetting("modules.playerDefaults", "播放器默认状态模块", "控制默认弹幕、显示模式、自动播放等。"),
      switchSetting("modules.tracking", "反追踪模块", "高风险功能，默认关闭。"),
      switchSetting("modules.cdn", "CDN 优化模块", "高风险功能，默认关闭。")
    ],
    home: [
      switchSetting("homeClean.filterAds", "过滤广告内容", "隐藏带广告标识或广告类名的推荐卡片。"),
      switchSetting("homeClean.filterLive", "过滤直播内容", "隐藏直播卡片和直播推荐。"),
      switchSetting("homeClean.filterPromotions", "过滤推广卡片", "隐藏推广、创意广告、商业卡片。"),
      switchSetting("homeClean.filterNoDate", "过滤无日期信息内容", "无发布时间信息的卡片通常质量较低。"),
      switchSetting("homeClean.filterNoAuthor", "过滤无 UP 信息内容", "无 UP 主信息的卡片将被隐藏。"),
      switchSetting("homeClean.filterAdLikeUsers", "过滤疑似广告账号", "例如 bili_ 加数字的账号名。"),
      switchSetting("homeClean.filterAdLikeTitles", "过滤疑似广告标题", "例如 4K、蓝光、原盘等组合标题。"),
      switchSetting("homeClean.keepFollowed", "保留已关注 UP 内容", "即使命中过滤规则，也尽量保留已关注内容。"),
      switchSetting("homeClean.dynamicScan", "动态处理新加载内容", "首页刷新或滚动加载后继续过滤。"),
      switchSetting("homeClean.showReasons", "显示过滤原因", "调试用，会用粉色标注隐藏原因。")
    ],
    blacklist: [
      switchSetting("blacklist.localEnabled", "启用本地黑名单", "黑名单保存在扩展 IndexedDB 中。"),
      switchSetting("blacklist.showLocalButton", "显示拉黑本地按钮", "在卡片上添加本地拉黑按钮。"),
      switchSetting("blacklist.showAccountButton", "显示账号拉黑按钮", "仅在账号拉黑启用时显示。"),
      switchSetting("blacklist.accountBlockEnabled", "启用账号拉黑", "会调用 B 站账号接口，属于高风险功能。", true),
      switchSetting("blacklist.accountBlockConfirm", "账号拉黑二次确认", "执行账号拉黑前弹窗确认。"),
      switchSetting("blacklist.preferLocalBlock", "默认使用本地拉黑", "优先将用户加入本地黑名单。"),
      switchSetting("blacklist.importEnabled", "启用黑名单导入", "允许从 JSON 文件导入。"),
      switchSetting("blacklist.exportEnabled", "启用黑名单导出", "允许导出 JSON 文件。")
    ],
    player: [
      switchSetting("player.defaultDanmakuOff", "默认关闭弹幕", "进入播放页后自动关闭弹幕。"),
      switchSetting("player.defaultViewModeEnabled", "启用默认显示模式", "自动切换正常、宽屏或网页全屏。"),
      selectSetting("player.defaultViewMode", "默认显示模式", "宽屏禁用后，宽屏选项不会自动执行。", [["normal", "正常"], ["wide", "宽屏"], ["webFullscreen", "网页全屏"]]),
      switchSetting("player.disableWideMode", "禁用宽屏模式", "关闭自动宽屏，并让宽屏快捷键不执行。"),
      switchSetting("player.autoPlay", "自动播放", "进入播放页后尝试自动播放。"),
      switchSetting("player.exitFullscreenOnEnded", "播放结束自动退出全屏", "视频结束时退出全屏或网页全屏。"),
      switchSetting("player.defaultLightsOff", "默认关灯", "进入播放页后自动开启关灯。"),
      switchSetting("player.smartLights", "智能关灯", "根据播放器可见状态自动开关关灯效果。开启后会自动启用默认关灯。")
    ],
    danmaku: [
      switchSetting("danmaku.preventBottomDanmaku", "防底部弹幕挡字幕", "尽量隐藏底部弹幕区域。"),
      switchSetting("danmaku.subtitleHotkey", "启用字幕快捷键", "允许快捷键切换字幕。"),
      switchSetting("danmaku.rememberCaption", "记住上次字幕语言", "保留字幕语言选择状态。"),
      switchSetting("danmaku.titleOverlay", "启用标题显示快捷键", "允许快捷键显示视频标题。"),
      switchSetting("danmaku.progressOverlay", "启用进度显示快捷键", "允许快捷键显示当前进度。"),
      switchSetting("danmaku.clockOverlay", "启用当前时间显示快捷键", "允许快捷键显示当前时间。"),
      switchSetting("danmaku.time24Hour", "当前时间使用 24 小时制", "影响时间浮层格式。"),
      switchSetting("danmaku.showSeconds", "显示秒数", "当前时间浮层显示秒。"),
      switchSetting("danmaku.videoScaleHotkeys", "启用视频缩放快捷键", "允许快捷键缩放播放器画面。")
    ],
    media: [
      switchSetting("media.screenshotFile", "启用截图到文件", "允许快捷键保存当前视频画面。"),
      switchSetting("media.screenshotClipboard", "启用截图到剪贴板", "允许快捷键复制当前视频画面。"),
      selectSetting("media.screenshotFormat", "截图格式", "截图文件使用的图片格式。", [["jpg", "JPG"], ["png", "PNG"]]),
      switchSetting("media.pip", "启用画中画", "允许快捷键打开 PiP。"),
      switchSetting("media.frameControl", "启用逐帧控制", "视频暂停时可上一帧 / 下一帧。"),
      switchSetting("media.replay", "启用从头播放", "允许快捷键回到视频开头。"),
      switchSetting("media.speedControl", "启用倍速调整", "允许快捷键改变播放速度。"),
      numberSetting("media.shortStep", "短跳转秒数", "短快进 / 短后退使用。", 1, 120),
      numberSetting("media.longStep", "长跳转秒数", "长快进 / 长后退使用。", 1, 600),
      numberSetting("media.speedStep", "倍速步进", "每次调整播放速度的幅度。", 0.05, 2, 0.05)
    ],
    tracking: [
      notice("反追踪会改写页面网络 API，遇到播放、评论、推荐异常时请先关闭本模块。"),
      switchSetting("tracking.blockWebSocket", "阻止播放追踪 WebSocket", "阻止 web-player-tracker.biliapi.net。", true),
      switchSetting("tracking.blockSendBeacon", "阻止日志上报 sendBeacon", "拦截部分 data.bilibili.com 日志。", true),
      switchSetting("tracking.blockHomeLogs", "阻止首页日志请求", "仅在首页拦截已知 B 站日志请求。", true),
      switchSetting("tracking.blockPlayerLogs", "阻止播放器日志请求", "仅在播放页拦截已知 B 站日志和播放器追踪请求。", true),
      switchSetting("tracking.blockXhrLogs", "阻止部分 XHR 日志请求", "拦截 XMLHttpRequest 日志请求。", true),
      switchSetting("tracking.blockFetchLogs", "拦截部分 fetch 日志请求", "返回空 JSON 响应。", true),
      switchSetting("tracking.keepFeedback", "保留必要反馈行为", "保留 dislike / feedback 类行为。")
    ],
    cdn: [
      notice("CDN 优化会改写播放资源 URL，播放失败时请关闭本模块。"),
      switchSetting("cdn.avoidMcdn", "避开 mcdn.bilivideo", "从 DASH 备选地址中选择其他节点。", true),
      switchSetting("cdn.avoidMountaintoys", "避开 edge.mountaintoys.cn", "从 DASH 备选地址中选择其他节点。", true),
      switchSetting("cdn.preferCnBilivideo", "优先 cn-* bilivideo 节点", "选择候选地址时优先国内 bilivideo 节点。"),
      switchSetting("cdn.fallbackOriginal", "播放失败时回退原始 URL", "找不到替代地址时保留原地址。")
    ],
    comments: [
      switchSetting("comments.showIpLocation", "显示评论 IP 属地", "在评论按钮区域补充 IP 属地。"),
      switchSetting("comments.showTopicTags", "显示话题标签", "显示播放页话题标签区域。"),
      switchSetting("comments.hidePinnedAdComment", "隐藏置顶广告评论", "识别带跳转链接的置顶广告评论。"),
      switchSetting("comments.commentAreaStyle", "启用评论区样式优化", "优化评论区固定区域样式。"),
      switchSetting("comments.commentBoxStyle", "启用评论框样式优化", "优化评论输入框样式。")
    ],
    styles: [
      switchSetting("styles.enabled", "启用页面样式优化", "样式优化总开关。"),
      switchSetting("styles.home", "启用首页样式优化", "隐藏首页轮播等干扰区域。"),
      switchSetting("styles.play", "启用播放页样式优化", "优化播放页部分视觉细节。"),
      switchSetting("styles.search", "启用搜索页样式优化", "隐藏搜索页广告区域。"),
      switchSetting("styles.bangumi", "启用番剧页样式优化", "隐藏番剧页固定回复框和反馈入口。"),
      switchSetting("styles.list", "启用播放列表页样式优化", "优化播放列表右侧推荐卡片样式。")
    ]
  };

  function switchSetting(path, title, desc, danger) {
    /*
     * switch 设置直接映射到布尔配置路径，
     * 并渲染为参考 UI 样例中的右对齐开关样式。
     */
    return { type: "switch", path, title, desc, danger: Boolean(danger) };
  }

  function selectSetting(path, title, desc, options) {
    /*
     * select 设置用于播放器显示模式、截图格式等枚举值。
     */
    return { type: "select", path, title, desc, options };
  }

  function numberSetting(path, title, desc, min, max, step) {
    /*
     * number 设置把 min / max 元数据和标签放在一起，
     * 便于同时生成校验规则和输入框属性。
     */
    return { type: "number", path, title, desc, min, max, step: step || 1 };
  }

  function notice(text) {
    /*
     * notice 行用于说明风险功能，不绑定具体配置路径。
     */
    return { type: "notice", text };
  }

  function shortcutText(shortcut) {
    /*
     * 设置表中快捷键以 KeyboardEvent.code 保存，
     * 本格式化函数将它们转成面向用户的标签。
     */
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

  function isSameShortcut(a, b) {
    /*
     * 比较物理按键和完整修饰键集合；
     * 只有组合的每一部分都相同才算冲突。
     */
    return Boolean(a && b && a.code && b.code && a.code === b.code && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift);
  }

  function findShortcutConflict(id, shortcut) {
    /*
     * 冲突检测会忽略当前正在编辑的快捷键，
     * 并且只考虑已启用的快捷键。
     */
    const shortcuts = config.hotkeys.shortcuts;

    return Object.keys(shortcuts).find((otherId) => {
      return otherId !== id && shortcuts[otherId].enabled && isSameShortcut(shortcuts[otherId], shortcut);
    });
  }

  function create(tag, className, text) {
    /*
     * 渲染器使用的小型 DOM 工厂。它能保持生成节点一致，
     * 同时不引入框架依赖。
     */
    const node = document.createElement(tag);

    if (className) {
      node.className = className;
    }

    if (text !== undefined) {
      node.textContent = text;
    }

    return node;
  }

  async function saveConfig(nextConfig) {
    /*
     * 先持久化，再用共享配置模块返回的规范化配置重新渲染。
     */
    config = await CONFIG.writeStorage(nextConfig);
    render();
  }

  async function setValue(path, value) {
    /*
     * 设置变化的集中处理器。网络 / 账号类风险功能在保存新值前会显式确认。
     */
    const next = CONFIG.setByPath(config, path, value);

    if (path === "blacklist.accountBlockEnabled" && value && !confirm("账号拉黑会调用 B 站接口并修改你的账号关系，确认开启？")) {
      return;
    }

    if ((path.startsWith("tracking.") || path.startsWith("cdn.")) && value && !confirm("该功能会改写页面网络行为，可能影响播放或评论，确认开启？")) {
      return;
    }

    if (path === "player.smartLights" && value) {
      next.player.defaultLightsOff = true;
    }

    await saveConfig(next);
  }

  function renderNav() {
    /*
     * 每次渲染都重建导航，确保激活状态始终反映 activeSection。
     */
    const nav = document.getElementById("navList");
    nav.textContent = "";

    sections.forEach((section) => {
      const button = create("button", `nav-button ${section.id === activeSection ? "active" : ""}`, section.label);
      button.type = "button";
      button.addEventListener("click", () => {
        activeSection = section.id;
        render();
      });
      nav.appendChild(button);
    });
  }

  function renderSetting(item) {
    /*
     * 渲染一行声明式设置。第一列为文字，第二列为控件，
     * 与用户提供的设置页样例一致。
     */
    if (item.type === "notice") {
      return create("div", "notice", item.text);
    }

    const row = create("div", "setting-row");
    const text = create("div");
    const title = create("div", `setting-title ${item.danger ? "danger" : ""}`, item.danger ? `⚠️ ${item.title}` : item.title);
    const desc = create("div", "setting-desc", item.desc);

    text.append(title, desc);
    row.appendChild(text);

    if (item.type === "switch") {
      const label = create("label", "switch");
      const input = document.createElement("input");
      const knob = document.createElement("span");

      input.type = "checkbox";
      input.checked = Boolean(CONFIG.getByPath(config, item.path));
      input.addEventListener("change", () => setValue(item.path, input.checked));
      label.append(input, knob);
      row.appendChild(label);
    }

    if (item.type === "select") {
      const select = document.createElement("select");

      item.options.forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      });

      select.value = CONFIG.getByPath(config, item.path);
      select.addEventListener("change", () => setValue(item.path, select.value));
      row.appendChild(select);
    }

    if (item.type === "number") {
      const input = document.createElement("input");

      input.type = "number";
      input.min = item.min;
      input.max = item.max;
      input.step = item.step;
      input.value = CONFIG.getByPath(config, item.path);
      input.addEventListener("change", () => setValue(item.path, Number(input.value)));
      row.appendChild(input);
    }

    return row;
  }

  function renderSettingsSection(sectionId) {
    /*
     * 用于普通 switch / select / number 章节的通用渲染器。
     */
    const body = document.getElementById("sectionBody");
    body.textContent = "";

    (settingGroups[sectionId] || []).forEach((item) => {
      body.appendChild(renderSetting(item));
    });
  }

  function renderShortcutsSection() {
    /*
     * 快捷键章节需要自定义渲染，因为它包含两张表：
     * 只读的 B 站默认快捷键，以及可编辑的 BiliArm 功能快捷键。
     */
    const body = document.getElementById("sectionBody");
    body.textContent = "";

    body.appendChild(renderSetting(switchSetting("hotkeys.enabled", "启用扩展快捷键", "关闭后所有扩展快捷键不再响应。")));
    body.appendChild(renderSetting(switchSetting("hotkeys.disableAll", "禁用全部扩展快捷键", "临时关闭全部扩展快捷键。")));
    body.appendChild(renderSetting(switchSetting("hotkeys.spacePlayPause", "空格键始终播放 / 暂停", "输入框聚焦时不会触发。")));

    const officialTitle = create("h2", "", "B 站默认快捷键");
    const officialTable = create("table", "table");
    officialTable.innerHTML = "<thead><tr><th>功能</th><th>快捷键</th><th>说明</th></tr></thead>";
    const officialBody = create("tbody");

    CONFIG.BILIBILI_DEFAULT_SHORTCUTS.forEach((item) => {
      const row = create("tr");
      row.innerHTML = `<td>${item.label}</td><td><kbd>${item.shortcut}</kbd></td><td>${item.note}</td>`;
      officialBody.appendChild(row);
    });

    officialTable.appendChild(officialBody);
    body.append(officialTitle, officialTable);

    const extTitle = create("h2", "", "扩展功能快捷键");
    const extTable = create("table", "table");
    extTable.innerHTML = "<thead><tr><th>分组</th><th>功能</th><th>快捷键</th><th>启用</th><th>冲突</th><th>操作</th></tr></thead>";
    const extBody = create("tbody");

    Object.entries(config.hotkeys.shortcuts).forEach(([id, shortcut]) => {
      const row = create("tr");
      const conflict = findShortcutConflict(id, shortcut);
      const enabled = document.createElement("input");
      const edit = create("button", "linkish", "编辑");
      const reset = create("button", "linkish", "恢复");

      enabled.type = "checkbox";
      enabled.checked = shortcut.enabled;
      enabled.addEventListener("change", () => {
        const next = CONFIG.deepClone(config);
        next.hotkeys.shortcuts[id].enabled = enabled.checked;
        saveConfig(next);
      });

      edit.type = "button";
      edit.addEventListener("click", () => openShortcutDialog(id));

      reset.type = "button";
      reset.addEventListener("click", () => {
        const next = CONFIG.deepClone(config);
        next.hotkeys.shortcuts[id] = CONFIG.deepClone(CONFIG.DEFAULT_SHORTCUTS[id]);
        saveConfig(next);
      });

      row.append(
        tableCell(shortcut.group),
        tableCell(shortcut.label),
        tableCell(shortcutText(shortcut), true),
        tableNodeCell(enabled),
        tableCell(conflict ? `与 ${config.hotkeys.shortcuts[conflict].label} 冲突` : "无", false, conflict ? "danger" : ""),
        tableNodeCell(edit, reset)
      );
      extBody.appendChild(row);
    });

    extTable.appendChild(extBody);
    body.append(extTitle, extTable);
  }

  function tableCell(text, asKbd, className) {
    /*
     * 构建表格单元格；快捷键文本可选用 <kbd> 包裹，
     * 呈现为键盘按键样式。
     */
    const td = create("td", className || "");

    if (asKbd) {
      td.appendChild(create("kbd", "", text));
    } else {
      td.textContent = text;
    }

    return td;
  }

  function tableNodeCell() {
    /*
     * 表格辅助函数，用于包含复选框、编辑按钮等控件的单元格。
     */
    const td = create("td");
    td.append(...Array.from(arguments));
    return td;
  }

  async function exportBlacklist() {
    /*
     * 黑名单数据存放在后台 IndexedDB 中，因此导出时通过后台消息 API 获取。
     */
    const response = await sendMessage({ type: "blacklist:list" });
    downloadJson(response, `biliarm-blacklist-${dateStamp()}.json`);
  }

  async function importBlacklist(file) {
    /*
     * 同时接受原始数组或包含 blockedUsers 的对象，
     * 让导出数据结构后续演进时也不破坏简单导入文件。
     */
    const text = await file.text();
    const data = JSON.parse(text);
    const imported = await sendMessage({ type: "blacklist:import", users: Array.isArray(data) ? data : data.blockedUsers });
    alert(`已导入 ${imported.length} 条黑名单记录。`);
  }

  async function importSettings(file) {
    /*
     * 设置导入会覆盖开关和快捷键。共享配置模块会在 writeStorage 后补齐缺失字段。
     */
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data || typeof data !== "object") {
      throw new Error("设置文件格式不正确");
    }

    if (!confirm("确认导入设置？当前开关和快捷键会被配置文件覆盖。")) {
      return;
    }

    config = await CONFIG.writeStorage(data);
    render();
  }

  function sendMessage(message) {
    /*
     * 给数据导入 / 导出控件使用的 chrome.runtime.sendMessage Promise 包装。
     */
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        if (!response || !response.ok) {
          reject(new Error(response && response.error ? response.error : "操作失败"));
          return;
        }

        resolve(response.data);
      });
    });
  }

  function downloadJson(data, name) {
    /*
     * 创建临时 object URL，点击模拟链接后撤销 URL，
     * 避免重复导出时泄漏 blob。
     */
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  function dateStamp() {
    /*
     * 导出文件名使用的紧凑时间戳：yyyyMMddHHmmss。
     */
    return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  }

  function renderDataSection() {
    /*
     * 数据章节手动渲染，因为它需要组合可见按钮和用于 JSON 导入的隐藏文件输入框。
     */
    const body = document.getElementById("sectionBody");
    body.textContent = "";

    const blacklistRow = create("div", "setting-row");
    const text = create("div");
    text.append(
      create("div", "setting-title", "黑名单导入 / 导出"),
      create("div", "setting-desc", "导出或导入扩展 IndexedDB 中的本地黑名单。")
    );

    const buttons = create("div", "button-row");
    const exportButton = create("button", "primary", "导出");
    const importButton = create("button", "secondary", "导入");
    const importFile = document.getElementById("importFile");

    exportButton.type = "button";
    importButton.type = "button";
    exportButton.disabled = !config.blacklist.exportEnabled;
    importButton.disabled = !config.blacklist.importEnabled;
    exportButton.addEventListener("click", exportBlacklist);
    importButton.addEventListener("click", () => importFile.click());
    importFile.onchange = () => importFile.files[0] && importBlacklist(importFile.files[0]);

    buttons.append(exportButton, importButton);
    blacklistRow.append(text, buttons);
    body.appendChild(blacklistRow);

    const settingsRow = create("div", "setting-row");
    const settingsText = create("div");
    settingsText.append(
      create("div", "setting-title", "全部设置导入 / 导出"),
      create("div", "setting-desc", "导出当前配置，或从 JSON 配置文件恢复。")
    );

    const settingsButtons = create("div", "button-row");
    const exportSettings = create("button", "primary", "导出设置");
    const importSettingsButton = create("button", "secondary", "导入设置");
    const settingsFile = document.createElement("input");

    settingsFile.type = "file";
    settingsFile.accept = "application/json";
    settingsFile.hidden = true;
    exportSettings.type = "button";
    importSettingsButton.type = "button";
    exportSettings.addEventListener("click", () => downloadJson(config, `biliarm-settings-${dateStamp()}.json`));
    importSettingsButton.addEventListener("click", () => settingsFile.click());
    settingsFile.addEventListener("change", () => settingsFile.files[0] && importSettings(settingsFile.files[0]));
    settingsButtons.append(exportSettings, importSettingsButton, settingsFile);
    settingsRow.append(settingsText, settingsButtons);
    body.appendChild(settingsRow);
  }

  function renderAdvancedSection() {
    /*
     * 高级章节用于放置许可证说明和恢复默认等不属于普通功能模块的操作。
     */
    const body = document.getElementById("sectionBody");
    body.textContent = "";

    body.appendChild(create("div", "notice", "BiliArm 使用 MIT 许可证发布。部分功能行为参考 Better Bilibili 2026.02.13 与 Bilibili Player Extension 3.0.2，并已在源码文件头标注。"));

    const resetRow = create("div", "setting-row");
    const text = create("div");
    text.append(
      create("div", "setting-title danger", "恢复默认设置"),
      create("div", "setting-desc", "会重置所有开关和快捷键，但不会删除本地黑名单。")
    );

    const buttonWrap = create("div", "button-row");
    const button = create("button", "primary", "恢复默认");
    button.type = "button";
    button.addEventListener("click", async () => {
      if (confirm("确认恢复默认设置？")) {
        config = await CONFIG.resetConfig();
        render();
      }
    });

    buttonWrap.appendChild(button);
    resetRow.append(text, buttonWrap);
    body.appendChild(resetRow);
  }

  function openShortcutDialog(id) {
    /*
     * 将快捷键克隆到 pendingShortcut，用户取消弹窗时不会修改当前配置。
     */
    editingShortcutId = id;
    pendingShortcut = CONFIG.deepClone(config.hotkeys.shortcuts[id]);

    document.getElementById("shortcutPreview").textContent = shortcutText(pendingShortcut);
    document.getElementById("shortcutDialogHelp").textContent = `正在修改：${pendingShortcut.label}`;
    document.getElementById("shortcutDialog").showModal();
  }

  function bindShortcutDialog() {
    /*
     * 弹窗直接捕获 keydown。preventDefault 可避免用户录入 BiliArm 快捷键时
     * 触发浏览器自身快捷键。
     */
    const dialog = document.getElementById("shortcutDialog");
    const preview = document.getElementById("shortcutPreview");

    dialog.addEventListener("keydown", (event) => {
      event.preventDefault();
      pendingShortcut = {
        ...pendingShortcut,
        code: event.code,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey
      };
      preview.textContent = shortcutText(pendingShortcut);
    });

    document.getElementById("clearShortcut").addEventListener("click", () => {
      pendingShortcut.code = null;
      pendingShortcut.ctrl = false;
      pendingShortcut.alt = false;
      pendingShortcut.shift = false;
      preview.textContent = "未设置";
    });

    document.getElementById("saveShortcut").addEventListener("click", (event) => {
      event.preventDefault();

      const conflict = findShortcutConflict(editingShortcutId, pendingShortcut);
      if (conflict && !confirm(`该快捷键与「${config.hotkeys.shortcuts[conflict].label}」冲突，仍然保存？`)) {
        return;
      }

      const next = CONFIG.deepClone(config);
      next.hotkeys.shortcuts[editingShortcutId] = pendingShortcut;
      dialog.close();
      saveConfig(next);
    });
  }

  function render() {
    /*
     * 顶层渲染会选择当前章节并委托给对应章节渲染器，
     * 同时应用主题和全局开关状态。
     */
    const section = sections.find((item) => item.id === activeSection) || sections[0];

    document.getElementById("sectionTitle").textContent = section.label;
    document.getElementById("sectionDescription").textContent = section.description;
    document.getElementById("globalEnabled").checked = config.enabled;
    document.documentElement.dataset.theme = theme;
    document.getElementById("themeToggle").textContent = theme === "dark" ? "☀" : "☾";

    renderNav();

    if (activeSection === "shortcuts") {
      renderShortcutsSection();
    } else if (activeSection === "data") {
      renderDataSection();
    } else if (activeSection === "advanced") {
      renderAdvancedSection();
    } else {
      renderSettingsSection(activeSection);
    }
  }

  async function start() {
    /*
     * 存储配置加载完成后启动设置页，
     * 再绑定静态 HTML 中长期存在的控件。
     */
    config = await CONFIG.readStorage();
    document.getElementById("globalEnabled").addEventListener("change", (event) => setValue("enabled", event.target.checked));
    document.getElementById("themeToggle").addEventListener("click", () => {
      theme = theme === "dark" ? "light" : "dark";
      localStorage.setItem("biliarm-theme", theme);
      render();
    });
    bindShortcutDialog();
    render();
  }

  start().catch((error) => {
    document.body.textContent = `BiliArm 设置页加载失败：${error.message}`;
  });
})();
