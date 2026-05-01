importScripts("common/config.js");

// 插件安装或更新时写入一次规范化配置，补齐新增字段。
chrome.runtime.onInstalled.addListener(async () => {
  const config = await globalThis.BiliArmConfig.readStorage();
  await globalThis.BiliArmConfig.writeStorage(config);
});

// popup/options/content script 共用轻量消息入口，当前主要保留给后续扩展。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.source !== "biliarm") {
    return false;
  }

  if (message.type === "getConfig") {
    globalThis.BiliArmConfig.readStorage().then((config) => {
      sendResponse({ ok: true, config });
    });
    return true;
  }

  if (message.type === "setConfigValue") {
    globalThis.BiliArmConfig.setConfigValue(message.path, message.value).then((config) => {
      sendResponse({ ok: true, config });
    });
    return true;
  }

  return false;
});
