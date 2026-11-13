// ==========================================================
// drive.js — สำรอง / กู้คืนข้อมูลกับ Google Drive
//
// เก็บเป็นไฟล์เดียว "Life Planner – สำรองข้อมูล.json" ใน Drive ของผู้ใช้
// (Drive เก็บประวัติเวอร์ชันเก่าของไฟล์ให้ประมาณ 30 วัน)
// ใช้สิทธิ์ drive.file: แอปเห็นเฉพาะไฟล์ที่ตัวเองสร้าง
// ==========================================================
import { store } from '../core/store.js';
import { googleFetch, ensureToken, hasScope, DRIVE_SCOPE, gcalAvailable } from './gcal.js';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const NAME = 'Life Planner – สำรองข้อมูล.json';

const cfg = () => store.state.settings.backup;
const setCfg = (patch) => store.setSettings({ backup: { ...cfg(), ...patch } });

const status = { state: 'idle', error: '' };
const listeners = new Set();
const setStatus = (patch) => {
  Object.assign(status, patch);
  listeners.forEach((fn) => fn({ ...status }));
};
export const backupStatus = () => ({ ...status });
export const onBackupChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const connected = () => store.state.settings.gcal.enabled && gcalAvailable();

async function findFile() {
  if (cfg().fileId) {
    try {
      const f = await googleFetch(`${FILES}/${cfg().fileId}?fields=id,name,modifiedTime,size,trashed`);
      if (!f.trashed) return f;
    } catch (e) {
      if (!e.gone) throw e;
    }
  }
  const q = encodeURIComponent("appProperties has { key='lifePlanner' and value='backup' } and trashed = false");
  const res = await googleFetch(`${FILES}?q=${q}&orderBy=modifiedTime desc&pageSize=1&fields=files(id,name,modifiedTime,size)`);
  return res.files?.[0] || null;
}

let running = null;

async function upload(existing) {
  const data = store.exportJSON();
  if (existing) {
    return googleFetch(`${UPLOAD}/${existing.id}?uploadType=media&fields=id,modifiedTime,size`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: data,
    });
  }
  const boundary = 'lp' + Math.random().toString(36).slice(2);
  const meta = { name: NAME, mimeType: 'application/json', appProperties: { lifePlanner: 'backup' } };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${data}\r\n--${boundary}--`;
  return googleFetch(`${UPLOAD}?uploadType=multipart&fields=id,modifiedTime,size`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
}

/**
 * ซิงก์ข้อมูลระหว่างเครื่อง: ดาวน์โหลดไฟล์ใน Drive -> รวมกับข้อมูลในเครื่อง -> อัปโหลดกลับ
 * (interactive = มาจากการกดปุ่ม ขอเข้าสู่ระบบได้)
 */
export function syncData({ interactive = false } = {}) {
  if (running) return running;
  running = (async () => {
    if (!connected()) throw new Error('ยังไม่ได้เชื่อมต่อ Google');
    setStatus({ state: 'working', error: '' });
    try {
      await ensureToken({ interactive, scope: DRIVE_SCOPE });
      const existing = await findFile();
      let stats = { added: 0, updated: 0, removed: 0 };
      if (existing) {
        const text = await googleFetch(`${FILES}/${existing.id}?alt=media`, { json: false });
        try {
          stats = store.mergeRemote(JSON.parse(text));
        } catch (err) {
          if (err instanceof SyntaxError) console.warn('ไฟล์ใน Drive อ่านไม่ได้ จะเขียนทับด้วยข้อมูลในเครื่อง');
          else throw err;
        }
      }
      const file = await upload(existing);
      setCfg({ fileId: file.id, lastBackup: Date.now() });
      setStatus({ state: 'ok', error: '' });
      return { ...stats, file };
    } catch (e) {
      setStatus({ state: e.needsAuth || e.needsScope ? 'needs-auth' : 'error', error: e.needsAuth ? '' : e.message });
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** ชื่อเดิม (ปุ่ม "สำรองตอนนี้") = ซิงก์ */
export const backupNow = syncData;

/** ข้อมูลไฟล์สำรองล่าสุดใน Drive (ไม่ดาวน์โหลดเนื้อหา) */
export async function latestBackupInfo({ interactive = false } = {}) {
  await ensureToken({ interactive, scope: DRIVE_SCOPE });
  return findFile();
}

/** ดาวน์โหลดไฟล์สำรองล่าสุด แล้วแทนที่ข้อมูลในเครื่อง */
export async function restoreLatest({ interactive = false } = {}) {
  setStatus({ state: 'working', error: '' });
  try {
    await ensureToken({ interactive, scope: DRIVE_SCOPE });
    const f = await findFile();
    if (!f) throw new Error('ยังไม่มีไฟล์สำรองใน Google Drive');
    const text = await googleFetch(`${FILES}/${f.id}?alt=media`, { json: false });
    store.importJSON(text);
    setCfg({ fileId: f.id });
    setStatus({ state: 'ok', error: '' });
    return f;
  } catch (e) {
    setStatus({ state: 'error', error: e.message });
    throw e;
  }
}

export function setAutoBackup(on) {
  setCfg({ auto: !!on });
}

// ---------- ซิงก์อัตโนมัติ ----------
const AFTER_EDIT_MS = 15 * 1000; // ซิงก์หลังแก้ไขล่าสุด 15 วินาที
const EVERY_MS = 3 * 60 * 1000; // และทุก 3 นาทีขณะเปิดแอป
const canAuto = () => connected() && cfg().auto && hasScope(DRIVE_SCOPE);

let timer = null;
function scheduleAuto(delay = AFTER_EDIT_MS) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (canAuto()) syncData().catch(() => {});
  }, delay);
}

/** เรียกเมื่อได้สิทธิ์ Google ใหม่ (เช่น กดปุ่มซิงก์) */
export function syncSoon() {
  scheduleAuto(500);
}

export function setupDrive() {
  store.subscribe((c) => {
    if (c.type === 'settings' || c.type === 'merge') return; // ไม่วนซิงก์ซ้ำ
    if (connected() && cfg().auto) scheduleAuto();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && canAuto()) syncData().catch(() => {});
  }, EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && canAuto()) scheduleAuto(800);
  });
  if (canAuto()) scheduleAuto(1500); // เปิดแอป: ดึงข้อมูลล่าสุดจากเครื่องอื่น
}
