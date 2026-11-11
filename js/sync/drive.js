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
const AUTO_DELAY_MS = 2 * 60 * 1000; // สำรองหลังแก้ไขข้อมูลล่าสุด 2 นาที
const DAILY_MS = 24 * 60 * 60 * 1000;

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

/** สำรองตอนนี้ (interactive = มาจากการกดปุ่ม ขอเข้าสู่ระบบได้) */
export async function backupNow({ interactive = false } = {}) {
  if (!connected()) throw new Error('ยังไม่ได้เชื่อมต่อ Google');
  setStatus({ state: 'working', error: '' });
  try {
    await ensureToken({ interactive, scope: DRIVE_SCOPE });
    const data = store.exportJSON();
    const existing = await findFile();
    let file;
    if (existing) {
      file = await googleFetch(`${UPLOAD}/${existing.id}?uploadType=media&fields=id,modifiedTime,size`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: data,
      });
    } else {
      const boundary = 'lp' + Math.random().toString(36).slice(2);
      const meta = { name: NAME, mimeType: 'application/json', appProperties: { lifePlanner: 'backup' } };
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${data}\r\n--${boundary}--`;
      file = await googleFetch(`${UPLOAD}?uploadType=multipart&fields=id,modifiedTime,size`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
      });
    }
    setCfg({ fileId: file.id, lastBackup: Date.now() });
    setStatus({ state: 'ok', error: '' });
    return file;
  } catch (e) {
    setStatus({ state: e.needsAuth || e.needsScope ? 'needs-auth' : 'error', error: e.needsAuth ? '' : e.message });
    throw e;
  }
}

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

// ---------- สำรองอัตโนมัติ ----------
let timer = null;
function scheduleAuto(delay = AUTO_DELAY_MS) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!connected() || !cfg().auto || !hasScope(DRIVE_SCOPE)) return;
    try {
      await backupNow();
    } catch (_) {
      /* แสดงสถานะในหน้าตั้งค่า */
    }
  }, delay);
}

export function setupDrive() {
  store.subscribe((c) => {
    if (c.type === 'settings') return; // การเปลี่ยนค่าตั้งค่าเล็ก ๆ ไม่ต้องสำรองทันที
    if (connected() && cfg().auto) scheduleAuto();
  });
  // สำรองรายวัน: เมื่อเปิดแอปและมีสิทธิ์อยู่แล้ว
  setInterval(() => {
    if (connected() && cfg().auto && hasScope(DRIVE_SCOPE) && Date.now() - (cfg().lastBackup || 0) > DAILY_MS) {
      scheduleAuto(1000);
    }
  }, 60 * 1000);
}
