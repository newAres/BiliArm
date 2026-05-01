(function () {
  "use strict";

  // popup 只承载高频开关，完整配置交给 options 页面。
  const CONFIG = globalThis.BiliArmConfig;
  const controls = Array.from(document.querySelectorAll("[data-config]"));
  const statusText = document.getElementById("statusText");
  const openOptions = document.getElementById("openOptions");
  let config = CONFIG.normalizeConfig();
  let statusTimer = 0;

  // 根据 data-config 的 dotted path 读取当前配置值。
  function getByPath(source, path) {
    return path.split(".").reduce((value, key) => (value ? value[key] : undefined), source);
  }

  // popup 空间有限，保存状态自动淡出。
  function showStatus(text) {
    window.clearTimeout(statusTimer);
    statusText.textContent = text;
    statusTimer = window.setTimeout(() => {
      statusText.textContent = "";
    }, 1400);
  }

  // 渲染所有快速配置控件，并跟随总开关禁用子项。
  function render() {
    controls.forEach((control) => {
      const path = control.dataset.config;
      const value = getByPath(config, path);

      if (control.type === "checkbox") {
        control.checked = Boolean(value);
      } else {
        control.value = String(value);
      }

      control.disabled = !config.enabled && path !== "enabled";
    });
  }

  // 单项写入配置，storage 监听会同步到其它页面。
  async function saveControl(control) {
    const path = control.dataset.config;
    const value = control.type === "checkbox" ? control.checked : control.value;
    config = await CONFIG.setConfigValue(path, value);
    render();
    showStatus("已保存");
  }

  controls.forEach((control) => {
    control.addEventListener("change", () => {
      saveControl(control).catch(() => showStatus("保存失败"));
    });
  });

  openOptions.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  CONFIG.onConfigChanged((nextConfig) => {
    config = nextConfig;
    render();
  });

  CONFIG.readStorage().then((nextConfig) => {
    config = nextConfig;
    render();
  });
})();
