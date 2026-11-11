// ==========================================================
// lock.js — ล็อกแอปด้วย PIN 4 หลัก
//
// หมายเหตุ: เป็นการ "ซ่อนหน้าจอ" กันคนที่หยิบเครื่องไปเปิดดู
// ข้อมูลในเบราว์เซอร์ไม่ได้ถูกเข้ารหัส (เก็บเฉพาะค่า hash ของ PIN)
// ==========================================================
import { store } from '../core/store.js';
import { $ } from '../core/utils.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';

const PIN_LEN = 4;
const MAX_TRIES = 5;
const COOLDOWN_MS = 30000;

const cfg = () => store.state.settings.lock;
const setCfg = (patch) => store.setSettings({ lock: { ...cfg(), ...patch } });

let locked = false;
let hiddenAt = null;
export const isLocked = () => locked;
export const lockSupported = () => !!(window.crypto && crypto.subtle);

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}:life-planner`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const newSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function checkPin(pin) {
  const c = cfg();
  return c.enabled && (await hashPin(pin, c.salt)) === c.hash;
}

// ---------------- keypad ----------------
function padHTML({ title, sub = '', forgot = false }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return `
    <p class="pin-title">${title}</p>
    <p class="pin-sub" data-sub>${sub}</p>
    <div class="pin-dots" data-dots aria-hidden="true">${'<i></i>'.repeat(PIN_LEN)}</div>
    <div class="pin-pad" role="group" aria-label="แป้นตัวเลข">
      ${keys
        .map((k) =>
          k === ''
            ? '<span></span>'
            : k === 'del'
            ? '<button type="button" class="pin-key pin-del" data-key="del" aria-label="ลบ">⌫</button>'
            : `<button type="button" class="pin-key" data-key="${k}">${k}</button>`,
        )
        .join('')}
    </div>
    ${forgot ? '<button type="button" class="link-btn pin-forgot" data-forgot>ลืม PIN?</button>' : ''}`;
}

/** ผูกแป้นตัวเลขกับ container; onComplete(pin) คืน true ถ้าถูก */
function bindPad(root, onComplete) {
  let value = '';
  let busy = false;
  const dots = $('[data-dots]', root);
  const render = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < value.length));
  const press = async (k) => {
    if (busy || root.classList.contains('cooldown')) return;
    if (k === 'del') value = value.slice(0, -1);
    else if (/^\d$/.test(k) && value.length < PIN_LEN) value += k;
    render();
    if (value.length === PIN_LEN) {
      busy = true;
      const ok = await onComplete(value);
      if (ok === false) {
        dots.classList.add('wrong');
        navigator.vibrate?.(120);
        setTimeout(() => {
          dots.classList.remove('wrong');
          value = '';
          render();
          busy = false;
        }, 450);
      } else {
        busy = false;
        value = '';
        if (ok !== true) render();
      }
    }
  };
  root.addEventListener('click', (e) => {
    const k = e.target.closest('[data-key]');
    if (k) {
      k.classList.remove('tap');
      void k.offsetWidth;
      k.classList.add('tap');
      press(k.dataset.key);
    }
  });
  const onKey = (e) => {
    if (!root.isConnected) return document.removeEventListener('keydown', onKey);
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);
  return { reset: () => ((value = ''), render()), off: () => document.removeEventListener('keydown', onKey, true) };
}

// ---------------- lock screen ----------------
export function lockNow() {
  if (!cfg().enabled || locked || !lockSupported()) return;
  locked = true;
  let tries = 0;
  const el = document.createElement('div');
  el.className = 'lockscreen';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'ใส่ PIN เพื่อเปิดแอป');
  el.innerHTML = `
    <div class="lock-inner">
      <img class="lock-logo" src="icons/splash-logo.webp" alt="" width="84" height="84" />
      ${padHTML({ title: 'ใส่ PIN เพื่อเปิด Life Planner', forgot: true })}
    </div>`;
  document.body.appendChild(el);
  document.querySelector('.app')?.setAttribute('inert', '');
  const sub = $('[data-sub]', el);

  const pad = bindPad(el, async (pin) => {
    if (await checkPin(pin)) {
      unlock(el, pad);
      return true;
    }
    tries++;
    if (tries >= MAX_TRIES) {
      tries = 0;
      el.classList.add('cooldown');
      let left = COOLDOWN_MS / 1000;
      sub.textContent = `ใส่ผิดหลายครั้ง รอ ${left} วินาที`;
      const t = setInterval(() => {
        left--;
        sub.textContent = left > 0 ? `ใส่ผิดหลายครั้ง รอ ${left} วินาที` : '';
        if (left <= 0) {
          clearInterval(t);
          el.classList.remove('cooldown');
        }
      }, 1000);
    } else sub.textContent = `PIN ไม่ถูกต้อง (เหลืออีก ${MAX_TRIES - tries} ครั้ง)`;
    return false;
  });

  $('[data-forgot]', el).addEventListener('click', async () => {
    el.classList.add('behind');
    const ok = await confirmDialog({
      title: 'ลืม PIN?',
      message:
        'ปลดล็อกได้ด้วยการล้างข้อมูลทั้งหมดในเครื่องนี้ แล้วกู้คืนจาก Google Drive (ตั้งค่า → Google → กู้คืนจาก Drive) ถ้าไม่เคยสำรองไว้ ข้อมูลจะหายถาวร',
      okLabel: 'ล้างข้อมูลในเครื่องนี้',
      danger: true,
    });
    el.classList.remove('behind');
    if (!ok) return;
    try {
      localStorage.removeItem('planner.v1');
    } catch (_) {}
    location.reload();
  });
}

function unlock(el, pad) {
  pad.off();
  el.classList.add('unlocking');
  document.querySelector('.app')?.removeAttribute('inert');
  locked = false;
  setTimeout(() => el.remove(), 650);
}

// ---------------- setup / change / disable ----------------
function pinModal(title, onComplete, sub = '') {
  return openModal({
    title,
    size: 380,
    body: `<div class="pin-modal">${padHTML({ title: '', sub })}</div>`,
    onMount(root, close) {
      const box = $('.pin-modal', root);
      bindPad(box, (pin) => onComplete(pin, close, box));
    },
  });
}

/** ตั้ง PIN ใหม่ (หรือเปลี่ยน PIN) */
export function setupPin() {
  if (!lockSupported()) {
    toast('เบราว์เซอร์นี้ไม่รองรับการล็อก (ต้องเปิดผ่าน https)', { icon: '⚠️' });
    return;
  }
  let first = null;
  pinModal(
    '🔒 ตั้ง PIN 4 หลัก',
    async (pin, close, box) => {
      const sub = $('[data-sub]', box);
      if (!first) {
        first = pin;
        $('.pin-title', box).textContent = 'ใส่ PIN อีกครั้งเพื่อยืนยัน';
        sub.textContent = '';
        return null;
      }
      if (pin !== first) {
        first = null;
        $('.pin-title', box).textContent = '';
        sub.textContent = 'PIN ไม่ตรงกัน ลองตั้งใหม่อีกครั้ง';
        return false;
      }
      const salt = newSalt();
      setCfg({ enabled: true, salt, hash: await hashPin(pin, salt) });
      close();
      toast('ตั้ง PIN แล้ว แอปจะล็อกเมื่อเปิดใหม่หรือออกจากแอปไปนาน', { icon: '🔒', duration: 4500 });
      return true;
    },
    'จำ PIN นี้ไว้ให้ดี ถ้าลืมต้องกู้ข้อมูลจาก Google Drive',
  );
}

/** ยืนยัน PIN เดิมก่อนทำ action (เปลี่ยน / ปิดการล็อก) */
export function verifyPin(title, then) {
  pinModal(title, async (pin, close, box) => {
    if (await checkPin(pin)) {
      close();
      setTimeout(then, 280);
      return true;
    }
    $('[data-sub]', box).textContent = 'PIN ไม่ถูกต้อง';
    return false;
  });
}

export function disablePin() {
  verifyPin('ใส่ PIN เดิมเพื่อปิดการล็อก', () => {
    setCfg({ enabled: false, salt: '', hash: '' });
    toast('ปิดการล็อกด้วย PIN แล้ว', { icon: '🔓' });
  });
}

export function setLockAfter(mins) {
  setCfg({ after: Number(mins) });
}

export function setupLock() {
  if (cfg().enabled) lockNow();
  document.addEventListener('visibilitychange', () => {
    if (!cfg().enabled) return;
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt != null) {
      const away = Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= (cfg().after || 0) * 60000) lockNow();
    }
  });
}
