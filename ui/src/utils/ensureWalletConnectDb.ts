const WC_DB = "WALLET_CONNECT_V2_INDEXED_DB";
const WC_STORE = "keyvaluestorage";

/**
 * WalletConnect opens its IndexedDB without a version, so the object store is
 * only created when the database is first created. If the database exists
 * without that store (aborted first open, another app on the same origin,
 * etc.), every read fails until the database is deleted. Run before
 * `createAppKit` so a broken database is dropped and recreated cleanly.
 */
export function ensureWalletConnectDb(): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();

  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(WC_DB);
    } catch {
      resolve();
      return;
    }

    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(WC_STORE)) {
        req.result.createObjectStore(WC_STORE);
      }
    };
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
    req.onsuccess = () => {
      const db = req.result;
      const healthy = db.objectStoreNames.contains(WC_STORE);
      db.close();
      if (healthy) {
        resolve();
        return;
      }
      const del = indexedDB.deleteDatabase(WC_DB);
      del.onsuccess = () => resolve();
      del.onerror = () => resolve();
      del.onblocked = () => resolve();
    };
  });
}
