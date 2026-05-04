/*
 * BilibiliToys 后台 Service Worker。
 *
 * SPDX-License-Identifier: MIT
 * 版权所有 (c) 2026 BilibiliToys 贡献者
 *
 * 本文件是 BilibiliToys 的后台衔接代码。功能集合来自 BilibiliToys 项目目标，
 * 并参考了 Better Bilibili 2026.02.13 与 Bilibili Player Extension
 * 3.0.2 的静态分析结果。
 */

(function () {
  "use strict";

  const DB_NAME = "BilibiliToysDB";
  const DB_VERSION = 1;
  const STORE_BLOCKED_USERS = "blockedUsers";

  /*
   * 打开扩展本地 IndexedDB 数据库。黑名单数据可能比普通同步设置更大，
   * 且需要按 uid 索引查询，因此不放在 chrome.storage 中。
   */
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_BLOCKED_USERS)) {
          /*
           * uid 是稳定主键。mark 保存可见的 UP 名称或用户备注，
           * 时间戳用于让导出的记录具备可追溯性。
           */
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

  /*
   * 小型事务辅助函数。回调会拿到 object store 并排队 IndexedDB 操作；
   * Promise 会在事务完成后 resolve，避免调用方和未完成的写入互相抢跑。
   */
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

  /*
   * 新增或更新一条本地黑名单记录。已有 createdAt 会被保留，
   * 避免导入或重复拉黑覆盖最初加入时间。
   */
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

  /*
   * 按 uid 读取一条本地黑名单记录。不存在时返回 null，
   * 方便内容脚本直接做布尔判断。
   */
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

  /*
   * 从本地黑名单删除一个 uid。这里固定返回 true，
   * 因为 IndexedDB 删除操作不会区分记录是否原本存在。
   */
  async function removeBlockedUser(uid) {
    await withStore("readwrite", (store) => store.delete(String(uid)));
    return true;
  }

  /*
   * 返回全部本地黑名单记录，供设置页导出功能使用。
   */
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

  /*
   * 导入逻辑刻意保持宽容：跳过无效条目，有效条目统一走 putBlockedUser，
   * 这样数据规范化只集中在一个地方。
   */
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
   * 后台 worker 有意保持精简。
   *
   * 大多数扩展行为都和具体页面有关，应该放在内容脚本中。
   * 后台逻辑越少，越不容易在用户关闭页面功能后继续残留隐藏的长任务。
   */
  chrome.runtime.onInstalled.addListener((details) => {
    /*
     * 首次安装时打开设置页，让用户检查每个开关。
     * 这符合“所有功能都可见且可控”的设计要求。
     */
    if (details.reason === "install") {
      chrome.runtime.openOptionsPage();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    /*
     * 消息是内容脚本 / 设置页访问 IndexedDB 的唯一桥梁。
     * 命令名保持显式，便于审计哪些界面操作会修改本地黑名单数据。
     */
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
          throw new Error(`Unknown BilibiliToys message: ${message.type}`);
      }
    };

    run()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));

    return true;
  });
})();
