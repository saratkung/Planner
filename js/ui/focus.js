// ==========================================================
// focus.js — จับเวลาโฟกัส (Pomodoro): โฟกัส 25 นาที → พัก 5 นาที
// นาฬิกาลอยอยู่ทุกหน้า, แตะเพื่อเข้าโหมดเต็มจอ, บันทึกเวลาโฟกัสต่องานและต่อวัน
// ==========================================================
import { store } from '../core/store.js';
import { esc, todayKey, $ } from '../core/utils.js';
import { toast } from './toast.js';
import { icon } from './icons.js';
import { confetti } from './confetti.js';

const KEY = 'planner.focus';
const cfg = () => ({ mins: 25, breakMins: 5, autoBreak: true, ...(store.state.settings.focus || {}) });
export const setFocusCfg = (patch) => store.setSettings({ focus: { ...cfg(), ...patch } });

let st = load(); // { taskId, title, mode, total, endAt, remaining, paused, startedAt }
let tick = null;
let full = false;

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (_) {
    return null;
  }
}
function persist() {
  try {
    if (st) localStorage.setItem(KEY, JSON.stringify(st));
    else localStorage.removeItem(KEY);
  } catch (_) {}
}

const remaining = () => (!st ? 0 : st.paused ? st.remaining : Math.max(0, Math.round((st.endAt - Date.now()) / 1000)));
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
export const focusActive = () => !!st;

/** เริ่มโฟกัส (taskId ไม่บังคับ) */
export function startFocus(taskId = null, mode = 'focus', mins) {
  const t = taskId && store.find('tasks', taskId);
  const total = Math.round((mins ?? (mode === 'focus' ? cfg().mins : cfg().breakMins)) * 60);
  st = {
    taskId: t ? t.id : null,
    title: t ? t.title : mode === 'focus' ? 'โฟกัส' : 'พัก',
    mode,
    total,
    endAt: Date.now() + total * 1000,
    remaining: total,
    paused: false,
    startedAt: Date.now(),
  };
  persist();
  primeAudio();
  run();
  if (mode === 'focus') toast(`เริ่มโฟกัส ${Math.round(total / 60)} นาที${t ? ` · ${t.title}` : ''}`, { icon: '⏱️' });
}

function pause() {
  if (!st || st.paused) return;
  st.remaining = remaining();
  st.paused = true;
  persist();
  render();
}
function resume() {
  if (!st || !st.paused) return;
  st.endAt = Date.now() + st.remaining * 1000;
  st.paused = false;
  persist();
  render();
}
function addMinutes(n) {
  if (!st) return;
  if (st.paused) st.remaining += n * 60;
  else st.endAt += n * 60 * 1000;
  st.total += n * 60;
  persist();
  render();
}

/** หยุด: ถ้าโฟกัสไปแล้วอย่างน้อย 1 นาที บันทึกเวลาไว้ */
export function stopFocus({ log = true } = {}) {
  if (!st) return;
  if (log && st.mode === 'focus') {
    const spent = Math.round((st.total - remaining()) / 60);
    if (spent >= 1) record(spent);
  }
  st = null;
  persist();
  closeFull();
  run();
}

function record(mins) {
  const k = todayKey();
  const day = store.day(k);
  store.setDay(k, { focusMins: (day.focusMins || 0) + mins, focusSessions: (day.focusSessions || 0) + 1 });
  if (st?.taskId && store.find('tasks', st.taskId)) {
    store.update('tasks', st.taskId, (t) => ({ focusMins: (t.focusMins || 0) + mins }));
  }
}

function finished() {
  const s = st;
  chime();
  navigator.vibrate?.([200, 100, 200]);
  if (s.mode === 'focus') {
    record(Math.round(s.total / 60));
    confetti({ x: innerWidth / 2, y: innerHeight / 2, count: 50, power: 10 });
    systemNotify('🎉 จบรอบโฟกัสแล้ว', `${s.title} · พักสักครู่นะ`);
    const taskId = s.taskId;
    st = null;
    if (cfg().autoBreak) {
      startFocus(null, 'break');
      st.title = 'พักสายตา';
      st.taskId = taskId; // จำงานไว้ เริ่มรอบถัดไปได้
      persist();
      toast('จบรอบโฟกัส! เริ่มพัก ' + cfg().breakMins + ' นาที', { icon: '☕', duration: 5000 });
    } else {
      persist();
      toast('จบรอบโฟกัสแล้ว', { icon: '🎉', action: 'โฟกัสต่อ', onAction: () => startFocus(taskId), duration: 8000 });
    }
  } else {
    const taskId = s.taskId;
    st = null;
    persist();
    systemNotify('☕ พักเสร็จแล้ว', 'พร้อมเริ่มรอบใหม่');
    toast('พักเสร็จแล้ว เริ่มรอบใหม่ไหม?', { icon: '⏱️', action: 'เริ่มโฟกัส', onAction: () => startFocus(taskId), duration: 10000 });
  }
  closeFull();
  run();
}

async function systemNotify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, { body, tag: 'focus', icon: 'icons/icon-192.png', data: { url: './#tasks' } });
    new Notification(title, { body });
  } catch (_) {}
}

// ---------- เสียงเตือน (เล่นได้หลังผู้ใช้แตะปุ่มแล้ว) ----------
let audio = null;
function primeAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch (_) {}
}
function chime() {
  if (!audio) return;
  try {
    [0, 0.18, 0.36].forEach((t, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = [660, 880, 990][i];
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.35);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + t);
      o.stop(audio.currentTime + t + 0.4);
    });
  } catch (_) {}
}

// ---------- UI ----------
const R = 22;
const C = 2 * Math.PI * R;

function dockHTML() {
  const left = remaining();
  const pct = st.total ? left / st.total : 0;
  return `
    <button type="button" class="fd-main" data-fd="open" aria-label="เปิดโหมดโฟกัส">
      <svg class="fd-ring" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="${R}" class="fd-track"/><circle cx="26" cy="26" r="${R}" class="fd-bar" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
      <span class="fd-text"><b>${fmt(left)}</b><small>${st.mode === 'focus' ? '⏱️' : '☕'} ${esc(st.title)}</small></span>
    </button>
    <button type="button" class="icon-btn sm" data-fd="${st.paused ? 'resume' : 'pause'}" aria-label="${st.paused ? 'ทำต่อ' : 'หยุดชั่วคราว'}">${st.paused ? '▶' : '❚❚'}</button>
    <button type="button" class="icon-btn sm" data-fd="stop" aria-label="หยุด">${icon('x')}</button>`;
}

function fullHTML() {
  const left = remaining();
  const big = 2 * Math.PI * 120;
  const pct = st.total ? left / st.total : 0;
  const t = st.taskId && store.find('tasks', st.taskId);
  return `
    <div class="ff-inner">
      <p class="ff-mode">${st.mode === 'focus' ? '⏱️ โหมดโฟกัส' : '☕ เวลาพัก'}</p>
      <div class="ff-ring${st.paused ? ' paused' : ''}">
        <svg viewBox="0 0 260 260" aria-hidden="true"><circle cx="130" cy="130" r="120" class="fd-track"/><circle cx="130" cy="130" r="120" class="fd-bar" stroke-dasharray="${big}" stroke-dashoffset="${big * (1 - pct)}"/></svg>
        <div class="ff-time"><b>${fmt(left)}</b><span>${st.paused ? 'หยุดชั่วคราว' : st.mode === 'focus' ? 'หายใจลึก ๆ แล้วลุย' : 'ลุกยืดเส้นยืดสาย'}</span></div>
      </div>
      <p class="ff-title">${esc(st.title)}</p>
      ${t?.focusMins ? `<p class="ff-sub">โฟกัสงานนี้ไปแล้ว ${t.focusMins} นาที</p>` : ''}
      <div class="ff-actions">
        <button type="button" class="btn btn-glass" data-fd="${st.paused ? 'resume' : 'pause'}">${st.paused ? '▶ ทำต่อ' : '❚❚ หยุดชั่วคราว'}</button>
        <button type="button" class="btn btn-glass" data-fd="plus">+5 นาที</button>
        ${t && !t.done && st.mode === 'focus' ? `<button type="button" class="btn btn-light" data-fd="done">✓ งานเสร็จแล้ว</button>` : ''}
      </div>
      <div class="ff-bottom">
        <button type="button" class="btn btn-ghost ff-ghost" data-fd="stop">หยุดรอบนี้</button>
        <button type="button" class="btn btn-ghost ff-ghost" data-fd="close">ย่อ ↓</button>
      </div>
    </div>`;
}

function dock() {
  let el = document.getElementById('focus-dock');
  if (!el) {
    el = document.createElement('div');
    el.id = 'focus-dock';
    el.className = 'focus-dock';
    el.addEventListener('click', onClick);
    document.body.appendChild(el);
  }
  return el;
}

function openFull() {
  full = true;
  let el = document.getElementById('focus-full');
  if (!el) {
    el = document.createElement('div');
    el.id = 'focus-full';
    el.className = 'focus-full';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'โหมดโฟกัส');
    el.addEventListener('click', onClick);
    document.body.appendChild(el);
  }
  render();
}
function closeFull() {
  full = false;
  const el = document.getElementById('focus-full');
  if (el) {
    el.classList.add('closing');
    setTimeout(() => el.remove(), 300);
  }
}

function onClick(e) {
  const act = e.target.closest('[data-fd]')?.dataset.fd;
  if (!act) return;
  if (act === 'open') openFull();
  if (act === 'close') closeFull();
  if (act === 'pause') pause();
  if (act === 'resume') resume();
  if (act === 'plus') addMinutes(5);
  if (act === 'stop') stopFocus();
  if (act === 'done' && st?.taskId) {
    const id = st.taskId;
    stopFocus();
    import('../core/actions.js').then(({ toggleTask }) => toggleTask(id));
  }
}

function render() {
  const d = dock();
  if (!st) {
    d.hidden = true;
    return;
  }
  d.hidden = false;
  d.className = `focus-dock ${st.mode}${st.paused ? ' paused' : ''}`;
  d.innerHTML = dockHTML();
  const f = document.getElementById('focus-full');
  if (f && full) {
    f.className = `focus-full ${st.mode}`;
    f.innerHTML = fullHTML();
  }
}

function run() {
  clearInterval(tick);
  render();
  if (!st) return;
  tick = setInterval(() => {
    if (!st) return clearInterval(tick);
    if (!st.paused && remaining() <= 0) return finished();
    render();
  }, 1000);
}

export function setupFocus() {
  if (st && !st.paused && remaining() <= 0) {
    // จบไปแล้วระหว่างปิดแอป
    if (st.mode === 'focus') record(Math.round(st.total / 60));
    st = null;
    persist();
  }
  run();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && full) closeFull();
  });
}
