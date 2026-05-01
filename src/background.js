importScripts("common/config.js");

chrome.runtime.onInstalled.addListener(async () => {
  const config = await globalThis.BiliArmConfig.readStorage();
  await globalThis.BiliArmConfig.writeStorage(config);
});

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
