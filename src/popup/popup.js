(function () {
  "use strict";

  const CONFIG = globalThis.BiliArmConfig;
  const controls = Array.from(document.querySelectorAll("[data-config]"));
  const statusText = document.getElementById("statusText");
  const openOptions = document.getElementById("openOptions");
  let config = CONFIG.normalizeConfig();
  let statusTimer = 0;

  function getByPath(source, path) {
    return path.split(".").reduce((value, key) => (value ? value[key] : undefined), source);
  }

  function showStatus(text) {
    window.clearTimeout(statusTimer);
    statusText.textContent = text;
    statusTimer = window.setTimeout(() => {
      statusText.textContent = "";
    }, 1400);
  }

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
