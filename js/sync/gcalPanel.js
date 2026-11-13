// ==========================================================
// gcalPanel.js — ส่วน "Google Calendar" ในหน้าตั้งค่า
// ==========================================================
import { store } from '../core/store.js';
import { esc, $ } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import {
  gcalStatus, onGcalChange, gcalAvailable, activeClientId, usingDefaultClientId, connect, disconnect, syncNow, setAutoCreate, preloadGcal,
} from './gcal.js';
import { backupNow, restoreLatest, setAutoBackup, backupStatus, onBackupChange } from './drive.js';

export function timeAgo(ts) {
  if (!ts) return 'ยังไม่เคย';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'เมื่อสักครู่';
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  return `${Math.round(h / 24)} วันที่แล้ว`;
}

const GLOGO = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="#fff" stroke="#dadce0"/><path d="M3 8h18" stroke="#4285f4" stroke-width="2.4"/><text x="12" y="18.2" text-anchor="middle" font-size="8.5" font-weight="700" fill="#4285f4" font-family="Arial, sans-serif">31</text></svg>`;

function steps() {
  const origin = location.origin;
  return `
    <details class="gc-help">
      <summary>วิธีขอ Client ID (ทำครั้งเดียว ประมาณ 5 นาที)</summary>
      <ol class="install-steps">
        <li>เปิด <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">Google Cloud Console</a> แล้วสร้างโปรเจกต์ใหม่ (ตั้งชื่ออะไรก็ได้ เช่น Planner)</li>
        <li>เปิดใช้ <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener">Google Calendar API</a> และ <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener">Google Drive API</a> (กด <b>Enable</b> ทั้งสองอัน)</li>
        <li>ไปที่ <a href="https://console.cloud.google.com/auth/branding" target="_blank" rel="noopener">OAuth consent screen</a> → กรอกชื่อแอปและอีเมล → เลือกประเภท <b>External</b></li>
        <li>ในหัวข้อ <b>Audience</b> กด <b>Add users</b> แล้วใส่อีเมล Gmail ของคุณเป็น Test user</li>
        <li>ไปที่ <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Credentials</a> → <b>Create credentials → OAuth client ID</b> → เลือก <b>Web application</b></li>
        <li>ในช่อง <b>Authorized JavaScript origins</b> ใส่ <code class="gc-origin">${esc(origin)}</code></li>
        <li>กด Create แล้วคัดลอก <b>Client ID</b> (ลงท้ายด้วย <code>.apps.googleusercontent.com</code>) มาวางด้านบน</li>
      </ol>
      <p class="muted gc-note">ตอนเข้าสู่ระบบครั้งแรก Google อาจเตือนว่า "แอปยังไม่ได้รับการยืนยัน" เพราะเป็นแอปส่วนตัวของคุณเอง ให้กด <b>ดำเนินการต่อ</b></p>
    </details>`;
}

export function gcalSectionHTML() {
  return `<div class="gc-box" id="gc-box">${inner()}</div>`;
}

function inner() {
  const st = gcalStatus();
  const c = store.state.settings.gcal;
  const head = `<div class="install-head">${GLOGO}<div><b>Google Calendar</b><p class="muted">ซิงก์นัดและการประชุมสองทาง</p></div></div>`;

  if (!gcalAvailable())
    return `${head}<p class="muted gc-note">หน้านี้เป็นเวอร์ชันทดลองใช้ จึงเชื่อมต่อ Google ไม่ได้ เมื่อเปิดจากเว็บจริง (GitHub Pages) จะเชื่อมต่อได้ที่ตรงนี้</p>`;

  if (!st.connected) {
    const ready = usingDefaultClientId();
    const field = `<div class="field">
        <label for="gc-client">Client ID</label>
        <input class="input" id="gc-client" value="${esc(c.clientId)}" placeholder="${ready ? 'ใช้ค่าที่ตั้งไว้ในแอป' : 'xxxxxxxx.apps.googleusercontent.com'}" autocomplete="off" spellcheck="false" />
      </div>`;
    return `${head}
      ${ready ? '<p class="muted gc-note">กดปุ่มด้านล่าง แล้วเลือกบัญชี Gmail ของคุณ ตอนที่ Google เตือนว่า "แอปยังไม่ได้รับการยืนยัน" ให้กด Continue</p>' : field}
      ${st.error ? `<p class="gc-error">${icon('alert')}${esc(st.error)}</p>` : ''}
      <button class="btn btn-primary btn-sm" type="button" data-gc="connect" ${st.state === 'connecting' ? 'disabled' : ''}>
        ${icon('link')}${st.state === 'connecting' ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ Google Calendar'}</button>
      ${ready ? `<details class="gc-help"><summary>ใช้ Client ID ของตัวเอง (ขั้นสูง)</summary>${field}</details>` : steps()}`;
  }

  const count = store.state.events.filter((e) => e.source === 'google').length;
  const pending = store.state.events.filter((e) => e.pendingPush).length + (c.pendingDeletes || []).length;
  const stateLine = {
    syncing: `<span class="gc-dot spin"></span>กำลังซิงก์…`,
    connecting: `<span class="gc-dot spin"></span>กำลังเข้าสู่ระบบ…`,
    ok: `<span class="gc-dot ok"></span>เชื่อมต่อแล้ว`,
    'needs-auth': `<span class="gc-dot warn"></span>กด "ซิงก์ตอนนี้" เพื่อเข้าสู่ระบบ Google อีกครั้ง`,
    error: `<span class="gc-dot bad"></span>ซิงก์ไม่สำเร็จ`,
  }[st.state] || `<span class="gc-dot ok"></span>เชื่อมต่อแล้ว`;

  return `${head}
    <p class="gc-state">${stateLine}</p>
    ${st.error ? `<p class="gc-error">${icon('alert')}${esc(st.error)}</p>` : ''}
    <p class="muted gc-note">นัดจาก Google ${count} รายการ · ซิงก์ล่าสุด ${timeAgo(c.lastSync)}${pending ? ` · รอส่ง ${pending} รายการ` : ''}</p>
    <label class="switch-row">
      <input type="checkbox" id="gc-auto" ${c.autoCreate ? 'checked' : ''} />
      <span class="switch" aria-hidden="true"></span>
      <span>บันทึกนัดที่สร้างในแอปลง Google Calendar ด้วย</span>
    </label>
    <div class="chips">
      <button class="btn btn-primary btn-sm" type="button" data-gc="sync" ${st.state === 'syncing' ? 'disabled' : ''}>${icon('repeat')}ซิงก์ตอนนี้</button>
      <button class="btn btn-ghost btn-sm" type="button" data-gc="disconnect">ยกเลิกการเชื่อมต่อ</button>
    </div>
    ${driveSection()}`;
}

function driveSection() {
  const b = store.state.settings.backup;
  const st = backupStatus();
  const line =
    st.state === 'working'
      ? '<span class="gc-dot spin"></span>กำลังทำงานกับ Google Drive…'
      : st.state === 'error'
      ? '<span class="gc-dot bad"></span>ซิงก์ไม่สำเร็จ'
      : st.state === 'needs-auth'
      ? '<span class="gc-dot warn"></span>กด "ซิงก์ตอนนี้" เพื่อเข้าสู่ระบบ Google อีกครั้ง'
      : b.lastBackup
      ? `<span class="gc-dot ok"></span>ซิงก์ล่าสุด ${timeAgo(b.lastBackup)}`
      : '<span class="gc-dot warn"></span>ยังไม่เคยซิงก์ กด "ซิงก์ตอนนี้" ในทุกเครื่อง';
  return `
    <div class="gc-sub">
      <div class="install-head"><span class="gc-sub-ico">💾</span><div><b>ซิงก์ข้อมูลระหว่างเครื่อง</b>
        <p class="muted">งาน นัด บันทึกประชุม และเป้าหมาย ตรงกันทั้งมือถือและคอม (ผ่านไฟล์ใน Google Drive ของคุณ)</p></div></div>
      <p class="gc-state">${line}</p>
      ${st.error ? `<p class="gc-error">${icon('alert')}${esc(st.error)}</p>` : ''}
      <label class="switch-row">
        <input type="checkbox" id="bk-auto" ${b.auto ? 'checked' : ''} />
        <span class="switch" aria-hidden="true"></span>
        <span>ซิงก์อัตโนมัติ (เมื่อเปิดแอป เมื่อแก้ไข และทุก 3 นาที)</span>
      </label>
      <div class="chips">
        <button class="btn btn-outline btn-sm" type="button" data-gc="backup" ${st.state === 'working' ? 'disabled' : ''}>${icon('repeat')}ซิงก์ตอนนี้</button>
        <button class="btn btn-ghost btn-sm" type="button" data-gc="restore" ${st.state === 'working' ? 'disabled' : ''}>${icon('download')}กู้คืนจาก Drive (แทนที่ทั้งหมด)</button>
      </div>
    </div>`;
}

/** ผูกปุ่มต่าง ๆ; คืนฟังก์ชันสำหรับเลิกฟังสถานะ */
export function bindGcalSection(root, { closeSettings } = {}) {
  const box = $('#gc-box', root);
  if (!box) return () => {};
  preloadGcal();
  const rerender = () => {
    const focusedClient = document.activeElement?.id === 'gc-client';
    const val = $('#gc-client', box)?.value;
    box.innerHTML = inner();
    if (val != null && $('#gc-client', box)) $('#gc-client', box).value = val;
    if (focusedClient) $('#gc-client', box)?.focus();
  };
  const offs = [onGcalChange(rerender), onBackupChange(rerender)];
  const off = () => offs.forEach((f) => f());

  box.addEventListener('change', (e) => {
    if (e.target.id === 'gc-auto') setAutoCreate(e.target.checked);
    if (e.target.id === 'bk-auto') setAutoBackup(e.target.checked);
    if (e.target.id === 'gc-client') {
      store.setSettings({ gcal: { ...store.state.settings.gcal, clientId: e.target.value.trim() } });
      preloadGcal();
    }
  });

  box.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-gc]')?.dataset.gc;
    if (!act) return;
    if (act === 'connect') {
      const typed = $('#gc-client', box)?.value.trim() || '';
      const id = typed || (usingDefaultClientId() ? '' : activeClientId());
      if (!usingDefaultClientId() && !/\.apps\.googleusercontent\.com$/.test(id) || (typed && !/\.apps\.googleusercontent\.com$/.test(typed))) {
        const input = $('#gc-client', box);
        input.classList.add('invalid', 'shake');
        setTimeout(() => input.classList.remove('shake'), 400);
        toast('Client ID ต้องลงท้ายด้วย .apps.googleusercontent.com', { icon: '⚠️' });
        return;
      }
      try {
        const r = await connect(id);
        toast(`เชื่อมต่อแล้ว ดึงนัดมา ${r?.total ?? 0} รายการ`, { icon: '✅', duration: 4000 });
      } catch (err) {
        toast(err.message, { icon: '⚠️' });
      }
      rerender();
    }
    if (act === 'sync') {
      try {
        const r = await syncNow({ interactive: true });
        if (r) toast(syncSummary(r), { icon: '🔄' });
      } catch (err) {
        toast(err.message, { icon: '⚠️' });
      }
      rerender();
    }
    if (act === 'backup') {
      try {
        await backupNow({ interactive: true });
        toast('ซิงก์ข้อมูลแล้ว', { icon: '🔄' });
      } catch (err) {
        toast(err.message, { icon: '⚠️' });
      }
      rerender();
    }
    if (act === 'restore') {
      closeSettings?.();
      const ok = await confirmDialog({
        title: 'กู้คืนข้อมูลจาก Google Drive?',
        message: 'ข้อมูลในเครื่องนี้ (งาน นัดหมาย เป้าหมาย บันทึกประชุม) จะถูกแทนที่ด้วยไฟล์สำรองล่าสุดใน Drive',
        okLabel: 'กู้คืนข้อมูล',
      });
      if (!ok) return;
      try {
        const f = await restoreLatest({ interactive: true });
        toast(`กู้คืนข้อมูลแล้ว (สำรองไว้${timeAgo(new Date(f.modifiedTime).getTime())})`, { icon: '📥', duration: 4500 });
      } catch (err) {
        toast(err.message, { icon: '⚠️' });
      }
    }
    if (act === 'disconnect') {
      closeSettings?.();
      const ok = await confirmDialog({
        title: 'ยกเลิกการเชื่อมต่อ Google Calendar?',
        message: 'นัดที่ดึงมาจะยังอยู่ในแอป แต่จะไม่ซิงก์กับ Google อีก และนัดใน Google จะไม่ถูกลบ',
        okLabel: 'ยกเลิกการเชื่อมต่อ',
        danger: true,
      });
      if (ok) {
        disconnect({ keepEvents: true });
        toast('ยกเลิกการเชื่อมต่อแล้ว', { icon: '🔌' });
      }
    }
  });
  return off;
}

export function syncSummary(r) {
  const parts = [];
  if (r.added) parts.push(`ใหม่ ${r.added}`);
  if (r.updated) parts.push(`อัปเดต ${r.updated}`);
  if (r.removed) parts.push(`ลบ ${r.removed}`);
  return parts.length ? `ซิงก์แล้ว: ${parts.join(' · ')}` : 'ซิงก์แล้ว ข้อมูลเป็นปัจจุบัน';
}
