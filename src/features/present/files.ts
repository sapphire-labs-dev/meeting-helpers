// Binary files (PDF decks) live in IndexedDB: localStorage is capped at ~5 MB
// of text, while IndexedDB stores Blobs and allows hundreds of MB. Both stay in
// this browser only; nothing is uploaded anywhere.

const DB_NAME = 'sapphire-meet';
const STORE = 'files';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export const putFile = (id: string, blob: Blob) => run('readwrite', (s) => s.put(blob, id)).then(() => undefined);
export const getFile = (id: string) => run<Blob | undefined>('readonly', (s) => s.get(id));
export const deleteFile = (id: string) => run('readwrite', (s) => s.delete(id)).then(() => undefined);

/** Ask the browser not to evict our data under storage pressure. */
export function requestPersistence(): void {
  void navigator.storage?.persist?.().catch(() => false);
}
