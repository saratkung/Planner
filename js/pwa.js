// ==========================================================
// pwa.js — ติดตั้งเป็นแอปบนมือถือ (PWA) + ใช้งานออฟไลน์
// ==========================================================
import { toast } from './ui/toast.js';

let deferredPrompt = null;
let swOk = false; // service worker registered (needed for install/offline)

/** หน้านี้ถูกเปิดอยู่ใน iframe (เช่นหน้าตัวอย่าง) ซึ่งดาวน์โหลดไฟล์/ติดตั้งไม่ได้ */
export const isEmbedded = () => {
  try { return window.self !== window.top; } catch (_) { return true; }
};
export const pwaSupported = () => swOk;
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

/** โหลดฟอนต์ผ่าน service worker อีกรอบ เพื่อเก็บไว้ใช้ตอนออฟไลน์ (ครั้งแรกที่ติดตั้ง) */
async function warmFontCache() {
  try {
    const links = [...document.querySelectorAll('link[rel="stylesheet"][href*="fonts.googleapis.com"]')];
    for (const l of links) {
      const css = await (await fetch(l.href)).text();
      const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g)].map((m) => m[1]);
      await Promise.all(urls.map((u) => fetch(u).catch(() => {})));
    }
  } catch (_) {
    /* ไม่มีอินเทอร์เน็ต: ไว้ครั้งหน้า */
  }
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
        const hadController = !!navigator.serviceWorker.controller;
        const reg = await navigator.serviceWorker.register('./sw.js');
        swOk = true;
        notify();
        maybeHint();
        // มีเวอร์ชันใหม่: ติดตั้งให้เลยโดยไม่ต้องกด
        const activate = (sw) => sw?.postMessage('skipWaiting');
        if (reg.waiting && navigator.serviceWorker.controller) activate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) activate(sw);
          });
        });
        // กลับเข้าแอป (มือถือที่เปิดค้างไว้นาน ๆ): เช็กเวอร์ชันใหม่
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
        setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
        let reloaded = false;
        const busy = () => !!document.querySelector('.modal-overlay, .lockscreen') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
        const reloadWhenIdle = () => {
          if (reloaded) return;
          if (busy()) {
            // กำลังกรอกข้อมูลอยู่: ไม่รีโหลดทันที ถามก่อน
            toast('อัปเดตแอปเป็นเวอร์ชันใหม่แล้ว', { icon: '🆕', action: 'รีโหลด', duration: 15000, onAction: () => location.reload() });
            return;
          }
          reloaded = true;
          location.reload();
        };
        let hasController = hadController;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          // ครั้งแรกที่ service worker เริ่มคุมหน้า ไม่ต้องรีโหลด: รีโหลดเฉพาะตอนเปลี่ยนเป็นเวอร์ชันใหม่
          if (!hasController) {
            hasController = true;
            return warmFontCache();
          }
          reloadWhenIdle();
        });
      } catch (err) {
        console.warn('ลงทะเบียน service worker ไม่สำเร็จ', err);
      }
    });
  }

  // แนะนำให้ติดตั้งครั้งเดียว เมื่อเปิดบนมือถือในเบราว์เซอร์ (และติดตั้งได้จริง)
  function maybeHint() {
    const KEY = 'planner.installHint';
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    let seen = false;
    try { seen = localStorage.getItem(KEY) === '1'; } catch (_) {}
    if (!mobile || isStandalone() || seen || isEmbedded()) return;
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
