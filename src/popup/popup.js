/*
 * BiliArm 弹窗脚本。
 *
 * SPDX-License-Identifier: MIT
 * 版权所有 (c) 2026 BiliArm 贡献者
 */

(function () {
  "use strict";

  const CONFIG = globalThis.BiliArmConfig;

  /*
   * 弹窗状态生命周期很短。每次打开弹窗都会读取存储、
   * 渲染四个快捷控件，并在弹窗关闭后销毁。
   */
  let config = CONFIG.normalizeConfig();
  let theme = localStorage.getItem("biliarm-theme") || "light";

  async function save(nextConfig) {
    /*
     * 保存变更后的配置，并用共享配置辅助函数返回的规范化值重新渲染。
     */
    config = await CONFIG.writeStorage(nextConfig);
    render();
  }

  function toggle(path) {
    /*
     * 所有快捷设置按钮共用的布尔值切换函数。
     */
    const current = Boolean(CONFIG.getByPath(config, path));
    return save(CONFIG.setByPath(config, path, !current));
  }

  function renderButton(id, path) {
    /*
     * 视觉状态由 is-on 类表示；CSS 负责移动胶囊开关的圆点。
     */
    const button = document.getElementById(id);
    button.classList.toggle("is-on", Boolean(CONFIG.getByPath(config, path)));
  }

  function render() {
    /*
     * 每次快捷开关变化时，同步弹窗主题和来自 manifest 元数据的版本文本。
     */
    document.documentElement.dataset.theme = theme;
    document.getElementById("themeToggle").textContent = theme === "dark" ? "☀" : "☾";
    renderButton("toggleEnabled", "enabled");
    renderButton("toggleClean", "modules.homeClean");
    renderButton("toggleHotkeys", "modules.hotkeys");
    document.getElementById("versionText").textContent = `版本 ${chrome.runtime.getManifest().version}`;
  }

  async function start() {
    /*
     * 配置加载后绑定静态弹窗按钮。
     * 完整设置按钮委托给 Chrome options page API，而不是硬编码 URL。
     */
    config = await CONFIG.readStorage();
    document.getElementById("toggleEnabled").addEventListener("click", () => toggle("enabled"));
    document.getElementById("themeToggle").addEventListener("click", () => {
      theme = theme === "dark" ? "light" : "dark";
      localStorage.setItem("biliarm-theme", theme);
      render();
    });
    document.getElementById("toggleClean").addEventListener("click", () => toggle("modules.homeClean"));
    document.getElementById("toggleHotkeys").addEventListener("click", () => toggle("modules.hotkeys"));
    document.getElementById("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
    render();
  }

  start().catch((error) => {
    document.body.textContent = `BiliArm 弹窗加载失败：${error.message}`;
  });
})();
