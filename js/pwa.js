// ==========================================================
// pwa.js — ติดตั้งเป็นแอปบนมือถือ (PWA) + ใช้งานออฟไลน์
// ==========================================================
import { toast } from './ui/toast.js';

let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const canPromptInstall = () => !!deferredPrompt;

export const onInstallChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  notify();
  return outcome === 'accepted';
}

/** วิธีติดตั้งแบบทำเอง (เมื่อเบราว์เซอร์ไม่มีปุ่มติดตั้งให้) */
export function installSteps() {
  if (isIOS())
    return [
      'เปิดเว็บนี้ด้วย <b>Safari</b>',
      'แตะปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรชี้ขึ้น) ที่แถบด้านล่าง',
      'เลื่อนลงแล้วเลือก <b>“เพิ่มไปยังหน้าจอโฮม”</b>',
      'แตะ <b>เพิ่ม</b> ไอคอน Planner จะอยู่บนหน้าจอโฮม',
    ];
  return [
    'เปิดเว็บนี้ด้วย <b>Chrome</b>',
    'แตะเมนู <b>⋮</b> มุมขวาบน',
    'เลือก <b>“ติดตั้งแอป”</b> หรือ <b>“เพิ่มลงในหน้าจอหลัก”</b>',
    'กด <b>ติดตั้ง</b> ไอคอน Planner จะอยู่บนหน้าจอหลัก',
  ];
}

export function setupPWA({ onSuggestInstall } = {}) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
    toast('ติดตั้งแอปเรียบร้อย เปิดได้จากหน้าจอโฮมเลย', { icon: '📲', duration: 4500 });
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js');
        const askReload = (sw) =>
          toast('มีเวอร์ชันใหม่ของแอป', {
            icon: '🆕',
            action: 'อัปเดต',
            duration: 10000,
            onAction: () => sw.postMessage('skipWaiting'),
          });
        if (reg.waiting && navigator.serviceWorker.controller) askReload(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) askReload(sw);
          });
        });
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) return;
          reloaded = true;
          location.reload();
        });
      } catch (err) {
        console.warn('ลงทะเบียน service worker ไม่สำเร็จ', err);
      }
    });
  }

  // แนะนำให้ติดตั้งครั้งเดียว เมื่อเปิดบนมือถือในเบราว์เซอร์
  const KEY = 'planner.installHint';
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  let seen = false;
  try { seen = localStorage.getItem(KEY) === '1'; } catch (_) {}
  if (mobile && !isStandalone() && !seen) {
    setTimeout(() => {
      try { localStorage.setItem(KEY, '1'); } catch (_) {}
      toast('ติดตั้ง Planner เป็นแอปบนมือถือได้นะ', {
        icon: '📲',
        action: 'ดูวิธี',
        duration: 8000,
        onAction: () => onSuggestInstall?.(),
      });
    }, 4000);
  }
}
