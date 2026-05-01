(function () {
  "use strict";

  const CONFIG = globalThis.BiliArmConfig;
  const controls = Array.from(document.querySelectorAll("[data-config]"));
  const statusText = document.getElementById("statusText");
  const resetButton = document.getElementById("resetButton");
  let config = CONFIG.normalizeConfig();
  let statusTimer = 0;

  function getByPath(source, path) {
    return path.split(".").reduce((value, key) => (value ? value[key] : undefined), source);
  }

  function showStatus(text, isError) {
    window.clearTimeout(statusTimer);
    statusText.textContent = text;
    statusText.classList.toggle("status-error", Boolean(isError));

    if (!isError) {
      statusTimer = window.setTimeout(() => {
        statusText.textContent = "";
      }, 1600);
    }
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
      saveControl(control).catch(() => showStatus("保存失败", true));
    });
  });

  resetButton.addEventListener("click", async () => {
    config = await CONFIG.resetConfig();
    render();
    showStatus("已恢复默认设置");
  });

  CONFIG.onConfigChanged((nextConfig) => {
    config = nextConfig;
    render();
  });

  CONFIG.readStorage()
    .then((nextConfig) => {
      config = nextConfig;
      render();
    })
    .catch(() => showStatus("读取配置失败", true));
})();
