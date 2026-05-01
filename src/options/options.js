(function () {
  "use strict";

  // 设置页负责把声明式控件 data-config 映射到统一配置对象。
  const CONFIG = globalThis.BiliArmConfig;
  const controls = Array.from(document.querySelectorAll("[data-config]"));
  const statusText = document.getElementById("statusText");
  const resetButton = document.getElementById("resetButton");
  const closeOptions = document.getElementById("closeOptions");
  let config = CONFIG.normalizeConfig();
  let statusTimer = 0;

  // 根据 dotted path 从嵌套配置中取值。
  function getByPath(source, path) {
    return path.split(".").reduce((value, key) => (value ? value[key] : undefined), source);
  }

  // 保存反馈只短暂展示，避免状态文本长期占据注意力。
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

  // 用配置刷新所有控件状态；总开关关闭时禁用其它配置但保留值。
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

  // 任一控件变化后只写入对应字段，减少并发编辑时互相覆盖。
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

  if (closeOptions) {
    closeOptions.addEventListener("click", () => {
      window.close();
    });
  }

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
