// ==========================================================
// dataSafety.js — "ข้อมูลในเครื่อง": พื้นที่ที่ใช้, การป้องกันไม่ให้เบราว์เซอร์ลบข้อมูล, การสำรอง
//                + เตือนเมื่อไม่ได้สำรองนาน
// ==========================================================
import { store } from '../core/store.js';
import { esc, $ } from '../core/utils.js';
import { requestPersist } from '../core/persist.js';
import { photoStats } from '../core/photoStore.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

const EXPORT_KEY = 'planner.lastExport';
const NAG_KEY = 'planner.backupNag';
const DAY = 86400000;

const mb = (b) => (b == null ? '–' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const ago = (t) => {
  if (!t) return null;
  const d = Math.floor((Date.now() - t) / DAY);
  if (d <= 0) {
    const h = Math.floor((Date.now() - t) / 3600000);
    return h <= 0 ? 'เมื่อสักครู่' : `${h} ชม.ที่แล้ว`;
  }
  return `${d} วันที่แล้ว`;
};

export const markExported = () => {
  try {
    localStorage.setItem(EXPORT_KEY, String(Date.now()));
  } catch (_) {}
};
const lastExport = () => {
  try {
    return Number(localStorage.getItem(EXPORT_KEY)) || 0;
  } catch (_) {
    return 0;
  }
};
export const lastBackupAt = () => Math.max(store.state.settings.backup?.lastBackup || 0, lastExport());
const googleOn = () => !!store.state.settings.gcal?.enabled;

/** มีข้อมูลจริง (ไม่ใช่ข้อมูลตัวอย่าง) แล้วหรือยัง */
function hasRealData() {
  const s = store.state;
  return ['tasks', 'events', 'goals', 'learnings', 'portfolio'].some((c) => (s[c] || []).some((x) => !x.seed));
}

export function dataSafetyHTML() {
  return `<div class="gc-box ds-box" id="ds-box"><div class="install-head"><span class="gc-sub-ico">🛡️</span><div><b>ข้อมูลในเครื่อง</b>
    <p class="muted">กำลังตรวจสอบ…</p></div></div></div>`;
}

export async function renderDataSafety(root, { onBackup, onExport } = {}) {
  const box = $('#ds-box', root);
  if (!box) return;
  const [info, photos] = await Promise.all([store.storageInfo(), photoStats()]);
  const last = lastBackupAt();
  const stale = !last || Date.now() - last > 7 * DAY;
  // ตัวเลขจากเบราว์เซอร์เป็นค่าประมาณ (บางครั้งน้อยกว่าข้อมูลจริง) ใช้ค่าที่มากกว่า
  const used = Math.max(info.usage || 0, info.dataBytes + photos.bytes);
  const pct = info.quota ? Math.min(100, Math.round((used / info.quota) * 100)) : null;
  box.innerHTML = `
    <div class="install-head"><span class="gc-sub-ico">🛡️</span><div><b>ข้อมูลในเครื่อง</b>
      <p class="muted">${info.backend === 'idb' ? 'เก็บในฐานข้อมูลของเบราว์เซอร์ (IndexedDB) จุได้มาก' : 'เก็บใน localStorage (จำกัดประมาณ 5 MB)'}</p></div></div>
    <ul class="ds-list">
      <li><span>${icon('note')}</span>ข้อมูลแอป <b>${mb(info.dataBytes)}</b></li>
      <li><span>${icon('image')}</span>รูปชัดแฟ้มผลงาน <b>${photos.count ? `${photos.count} รูป · ${mb(photos.bytes)}` : 'ยังไม่มี'}</b></li>
      ${pct != null ? `<li class="ds-usage"><span>${icon('chart')}</span><div>ใช้ไปประมาณ <b>${mb(used)}</b> จากพื้นที่ที่เบราว์เซอร์ให้ ${info.quota >= 1024 ** 3 ? `${(info.quota / 1024 ** 3).toFixed(1)} GB` : mb(info.quota)}
        <div class="progress"><span style="--p:${Math.max(pct, 1)}%;--c:${pct > 80 ? 'var(--bad)' : 'var(--accent)'}"></span></div></div></li>` : ''}
      <li class="${info.persisted ? 'ok' : 'warn'}"><span>${icon(info.persisted ? 'check' : 'alert')}</span>${
        info.persisted
          ? 'เบราว์เซอร์จะ<b>ไม่ลบ</b>ข้อมูลของแอปเอง'
          : `ยังไม่ได้รับการยืนยันว่าเบราว์เซอร์จะไม่ลบข้อมูล <button type="button" class="link-btn" data-ds="persist">ขออีกครั้ง</button>
             <small>ติดตั้งแอปลงหน้าจอโฮม และเปิดใช้บ่อย ๆ ช่วยได้</small>`
      }</li>
      <li class="${stale ? 'warn' : 'ok'}"><span>${icon(stale ? 'alert' : 'check')}</span>${
        last ? `สำรองข้อมูลล่าสุด <b>${esc(ago(last))}</b>` : '<b>ยังไม่เคยสำรองข้อมูล</b> ข้อมูลอยู่ในเครื่องนี้เครื่องเดียว'
      }</li>
    </ul>
    <div class="chips">
      ${googleOn() ? `<button type="button" class="btn btn-primary btn-sm" data-ds="backup">${icon('repeat')}สำรองขึ้น Google Drive ตอนนี้</button>` : ''}
      <button type="button" class="btn btn-outline btn-sm" data-ds="export">${icon('download')}ดาวน์โหลดไฟล์สำรอง (.json)</button>
    </div>
    ${googleOn() ? '' : '<p class="muted gc-note">แนะนำ: เชื่อม Google ด้านบน แอปจะสำรองขึ้น Drive ให้อัตโนมัติ และใช้ข้อมูลเดียวกันได้ทั้งมือถือและคอม</p>'}`;
  box.onclick = async (e) => {
    const act = e.target.closest('[data-ds]')?.dataset.ds;
    if (act === 'persist') {
      const ok = await requestPersist();
      toast(ok ? 'เบราว์เซอร์ยืนยันว่าจะไม่ลบข้อมูลแล้ว' : 'เบราว์เซอร์ยังไม่อนุญาต ลองติดตั้งแอปลงหน้าจอโฮมก่อน', { icon: ok ? '🛡️' : 'ℹ️' });
      renderDataSafety(root, { onBackup, onExport });
    }
    if (act === 'backup' && onBackup) {
      e.target.closest('button').disabled = true;
      await onBackup();
      renderDataSafety(root, { onBackup, onExport });
    }
    if (act === 'export' && onExport) {
      onExport();
      renderDataSafety(root, { onBackup, onExport });
    }
  };
}

/** เตือนสำรองข้อมูล: มีข้อมูลจริง และไม่ได้สำรองเกิน 7 วัน (เตือนไม่เกิน 3 วันครั้ง) */
export function checkBackupReminder({ onBackup, onOpenSettings } = {}) {
  if (!hasRealData()) return;
  const last = lastBackupAt();
  if (last && Date.now() - last < 7 * DAY) return;
  let nag = 0;
  try {
    nag = Number(localStorage.getItem(NAG_KEY)) || 0;
  } catch (_) {}
  if (Date.now() - nag < 3 * DAY) return;
  try {
    localStorage.setItem(NAG_KEY, String(Date.now()));
  } catch (_) {}
  const days = last ? Math.floor((Date.now() - last) / DAY) : null;
  if (googleOn()) {
    toast(days ? `ไม่ได้สำรองข้อมูลขึ้น Drive มา ${days} วัน` : 'ยังไม่เคยสำรองข้อมูลขึ้น Drive', { icon: '🛡️', action: 'สำรองเลย', onAction: onBackup, duration: 9000 });
  } else {
    toast('ข้อมูลอยู่ในเครื่องนี้เครื่องเดียว ควรสำรองไว้กันหาย', { icon: '🛡️', action: 'วิธีสำรอง', onAction: onOpenSettings, duration: 9000 });
  }
}
