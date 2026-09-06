const DATABASE = 'duofinance';
const VERSION = 1;

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'queueId', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(storeName, mode, operation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export const cacheGet = (key) => transact('cache', 'readonly', (store) => store.get(key));
export const cacheSet = (key, value) => transact('cache', 'readwrite', (store) => store.put(value, key));
export const queueAdd = (value) => transact('queue', 'readwrite', (store) => store.add(value));
export const queueAll = () => transact('queue', 'readonly', (store) => store.getAll());
export const queueDelete = (key) => transact('queue', 'readwrite', (store) => store.delete(key));
