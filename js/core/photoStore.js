// ==========================================================
// photoStore.js — เก็บรูปความละเอียดดีของแฟ้มผลงานไว้ในเครื่อง (IndexedDB)
//
// รูปย่อเล็ก ๆ อยู่ในข้อมูลแอป (ซิงก์ทุกเครื่อง) ส่วนรูปชัดอยู่ที่นี่ (เฉพาะเครื่องนี้)
// เครื่องที่ไม่มีรูปชัด จะดึงรูปเต็มจาก Google Drive มาเก็บไว้เมื่อเปิดดู (ถ้าเชื่อม Google)
// ==========================================================
const DB = 'planner-photos';
const STORE = 'photos';
const MAX = 1600; // ด้านยาวสุดของรูปที่เก็บ (พอสำหรับดูเต็มจอ)

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
};

/** ย่อรูปให้ด้านยาวไม่เกิน MAX (พื้นขาวสำหรับ PNG โปร่งใส) → Blob JPEG */
export async function makePreview(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    if (s === 1 && blob.size < 600 * 1024 && /jpe?g/.test(blob.type)) return blob;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b || blob), 'image/jpeg', 0.86));
  } catch (_) {
    return blob;
  }
}

/** ขอให้เบราว์เซอร์ไม่ลบข้อมูลของแอปเอง (ทำครั้งเดียว) */
let asked = false;
function persist() {
  if (asked) return;
  asked = true;
  try {
    navigator.storage?.persist?.();
  } catch (_) {}
}

export async function putPhoto(key, blob) {
  if (!key || !blob) return;
  persist();
  try {
    await tx('readwrite', (s) => s.put(blob, key));
    urls.delete(key);
  } catch (_) {}
}

const urls = new Map();
/** URL ของรูปชัดในเครื่อง (ไม่มี → null) */
export async function photoURL(key) {
  if (!key) return null;
  if (urls.has(key)) return urls.get(key);
  try {
    const blob = await tx('readonly', (s) => s.get(key));
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    urls.set(key, u);
    return u;
  } catch (_) {
    return null;
  }
}

/** กุญแจของรูปในไฟล์แนบ: รูปจาก Drive ใช้ id ของ Drive (ทุกเครื่องตรงกัน) */
export const photoKey = (f) => (f?.id ? `d:${f.id}` : f?.pid ? `l:${f.pid}` : null);
export const isPhoto = (f) => /^image\//.test(f?.mime || '') || (!!f?.thumb && !/pdf|word|sheet|presentation/.test(f?.mime || ''));

/**
 * รูปที่ดีที่สุดที่หาได้: ในเครื่อง → ดึงจาก Drive (ถ้าเข้าสู่ระบบอยู่ ไม่เด้งหน้าล็อกอิน) → null
 */
export async function bestPhotoURL(f, { fromDrive = true } = {}) {
  const key = photoKey(f);
  const local = await photoURL(key) || (f?.pid && f?.id ? await photoURL(`l:${f.pid}`) : null);
  if (local) return local;
  if (!fromDrive || !f?.id) return null;
  try {
    const { googleFetch, hasScope, DRIVE_SCOPE } = await import('../sync/gcal.js');
    if (!hasScope(DRIVE_SCOPE)) return null;
    const blob = await googleFetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, { as: 'blob' });
    const prev = await makePreview(blob);
    await putPhoto(key, prev);
    return await photoURL(key);
  } catch (_) {
    return null;
  }
}

/** ลบรูปในเครื่องที่ไม่มีผลงานไหนใช้แล้ว */
export async function cleanupPhotos(usedKeys) {
  try {
    const keys = await tx('readonly', (s) => s.getAllKeys());
    const dead = (keys || []).filter((k) => !usedKeys.has(k));
    if (dead.length) await tx('readwrite', (s) => dead.forEach((k) => s.delete(k)));
    return dead.length;
  } catch (_) {
    return 0;
  }
}
