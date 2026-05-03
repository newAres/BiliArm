/*
 * BiliArm popup script.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 BiliArm contributors
 */

(function () {
  "use strict";

  const CONFIG = globalThis.BiliArmConfig;

  let config = CONFIG.normalizeConfig();
  let theme = localStorage.getItem("biliarm-theme") || "light";

  async function save(nextConfig) {
    config = await CONFIG.writeStorage(nextConfig);
    render();
  }

  function toggle(path) {
    const current = Boolean(CONFIG.getByPath(config, path));
    return save(CONFIG.setByPath(config, path, !current));
  }

  function renderButton(id, path) {
    const button = document.getElementById(id);
    button.classList.toggle("is-on", Boolean(CONFIG.getByPath(config, path)));
  }

  function render() {
    document.documentElement.dataset.theme = theme;
    document.getElementById("themeToggle").textContent = theme === "dark" ? "☀" : "☾";
    renderButton("toggleEnabled", "enabled");
    renderButton("toggleClean", "modules.homeClean");
    renderButton("toggleHotkeys", "modules.hotkeys");
    document.getElementById("versionText").textContent = `版本 ${chrome.runtime.getManifest().version}`;
  }

  async function start() {
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
