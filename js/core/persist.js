// ==========================================================
// persist.js — ที่เก็บข้อมูลหลักของแอปในเครื่อง
//
// หลัก: IndexedDB (จุได้มาก ไม่ติดเพดาน ~5 MB ของ localStorage)
// สำเนาสำรอง: localStorage (เฉพาะตอนข้อมูลยังเล็ก) ใช้เมื่อ IndexedDB ใช้ไม่ได้
// ตอนเปิดแอปเลือกฉบับที่บันทึกล่าสุด (savedAt) เสมอ
// ==========================================================
const DB = 'planner-data';
const STORE = 'kv';
const MIRROR_MAX = 1.5 * 1024 * 1024; // ตัวอักษร (~3 MB ใน localStorage)

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
  return dbp;
}
function run(mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('aborted'));
      }),
  );
}

export const idbGet = (key) => run('readonly', (s) => s.get(key));
export const idbPut = (key, val) => run('readwrite', (s) => s.put(val, key));
export const idbDel = (key) => run('readwrite', (s) => s.delete(key));

// ---------- เขียนทีละครั้ง: ถ้ามีงานค้าง เก็บฉบับล่าสุดไว้เขียนต่อ ----------
let writing = null;
let next = null;
const errorListeners = new Set();
export const onSaveError = (fn) => {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
};
const fail = (e) => errorListeners.forEach((fn) => fn(e));

export function writeState(key, json, savedAt) {
  next = { json, savedAt };
  if (writing) return writing;
  writing = (async () => {
    while (next) {
      const job = next;
      next = null;
      try {
        await idbPut(key, job);
      } catch (e) {
        fail(e);
      }
    }
    writing = null;
  })();
  return writing;
}
export const flushWrites = () => writing || Promise.resolve();

/** สำเนาใน localStorage: เก็บเมื่อข้อมูลไม่ใหญ่ ถ้าใหญ่/เต็มก็ลบทิ้ง (จะได้ไม่ใช้ฉบับเก่าโดยไม่ตั้งใจ) */
export function writeMirror(key, json, { required = false } = {}) {
  try {
    if (json.length <= MIRROR_MAX || required) {
      localStorage.setItem(key, json);
      return true;
    }
    localStorage.removeItem(key);
  } catch (e) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
    if (required) fail(e);
  }
  return false;
}

// ---------- ขอให้เบราว์เซอร์ไม่ลบข้อมูลเอง / ขนาดที่ใช้ ----------
export async function requestPersist() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (_) {
    return false;
  }
}

export async function storageEstimate() {
  const out = { persisted: null, usage: null, quota: null };
  try {
    out.persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    const e = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    if (e) {
      out.usage = e.usage ?? null;
      out.quota = e.quota ?? null;
    }
  } catch (_) {}
  return out;
}

/** ล้างทุกอย่างในเครื่อง (ลืม PIN) */
export async function wipeAll(key) {
  try {
    localStorage.removeItem(key);
  } catch (_) {}
  try {
    await idbDel(key);
  } catch (_) {}
}
