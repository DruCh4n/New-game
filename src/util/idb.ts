/** Minimal IndexedDB key/value store (for blobs too large for localStorage). */
const DB_NAME = 'kotabaru';
const STORE = 'blobs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const idb = {
  get: <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key)).catch(() => undefined),
  set: (key: string, value: unknown) => tx('readwrite', (s) => s.put(value, key)).then(() => undefined),
  del: (key: string) => tx('readwrite', (s) => s.delete(key)).then(() => undefined),
};
