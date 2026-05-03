/*
 * BiliArm background service worker.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 BiliArm contributors
 *
 * This file is original BiliArm glue code. The feature set is derived from
 * the MIT-licensed BiliArm project goal and from statically reviewed behavior
 * in Better Bilibili 2026.02.13 and Bilibili Player Extension 3.0.2.
 */

(function () {
  "use strict";

  const DB_NAME = "BiliArmDB";
  const DB_VERSION = 1;
  const STORE_BLOCKED_USERS = "blockedUsers";

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_BLOCKED_USERS)) {
          const store = db.createObjectStore(STORE_BLOCKED_USERS, { keyPath: "uid" });

          store.createIndex("mark", "mark", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withStore(mode, callback) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_BLOCKED_USERS, mode);
      const store = transaction.objectStore(STORE_BLOCKED_USERS);
      let callbackResult;

      transaction.oncomplete = () => resolve(callbackResult);
      transaction.onerror = () => reject(transaction.error);

      callbackResult = callback(store);
    });
  }

  async function putBlockedUser(user) {
    const now = Date.now();
    const uid = String(user.uid || "").trim();

    if (!uid) {
      throw new Error("uid is required");
    }

    const existing = await getBlockedUser(uid);
    const record = {
      uid,
      mark: String(user.mark || existing?.mark || ""),
      source: String(user.source || existing?.source || "manual"),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    await withStore("readwrite", (store) => store.put(record));
    return record;
  }

  async function getBlockedUser(uid) {
    return new Promise(async (resolve, reject) => {
      try {
        await withStore("readonly", (store) => {
          const request = store.get(String(uid));

          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function removeBlockedUser(uid) {
    await withStore("readwrite", (store) => store.delete(String(uid)));
    return true;
  }

  async function listBlockedUsers() {
    return new Promise(async (resolve, reject) => {
      try {
        await withStore("readonly", (store) => {
          const request = store.getAll();

          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function importBlockedUsers(users) {
    const list = Array.isArray(users) ? users : [];
    const imported = [];

    for (const user of list) {
      if (user && user.uid) {
        imported.push(await putBlockedUser({ ...user, source: user.source || "import" }));
      }
    }

    return imported;
  }

  /*
   * The background worker intentionally stays small.
   *
   * Most extension behavior is page-specific and belongs in content scripts.
   * Keeping the worker minimal lowers the chance that hidden long-running
   * logic continues after users disable features on a page.
   */
  chrome.runtime.onInstalled.addListener((details) => {
    /*
     * On first install we open the options page so the user can review every
     * switch. This matches the design requirement that every feature is
     * visible and controllable.
     */
    if (details.reason === "install") {
      chrome.runtime.openOptionsPage();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    const run = async () => {
      switch (message.type) {
        case "blacklist:get":
          return getBlockedUser(message.uid);
        case "blacklist:put":
          return putBlockedUser(message.user || {});
        case "blacklist:remove":
          return removeBlockedUser(message.uid);
        case "blacklist:list":
          return listBlockedUsers();
        case "blacklist:import":
          return importBlockedUsers(message.users);
        default:
          throw new Error(`Unknown BiliArm message: ${message.type}`);
      }
    };

    run()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));

    return true;
  });
})();
