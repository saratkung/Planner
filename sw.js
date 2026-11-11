// ==========================================================
// sw.js — service worker: ทำให้แอปเปิดได้แม้ไม่มีอินเทอร์เน็ต
// เปลี่ยน VERSION ทุกครั้งที่แก้ไฟล์ เพื่อให้มือถือโหลดเวอร์ชันใหม่
// ==========================================================
const VERSION = 'planner-v10';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/animations.css',
  './css/components.css',
  './css/layout.css',
  './css/views.css',
  './js/app.js',
  './js/pwa.js',
  './js/sync/gcal.js',
  './js/sync/gcalPanel.js',
  './js/sync/drive.js',
  './js/core/actions.js',
  './js/core/constants.js',
  './js/core/selectors.js',
  './js/core/store.js',
  './js/core/utils.js',
  './js/ui/confetti.js',
  './js/ui/icons.js',
  './js/ui/modal.js',
  './js/ui/splash.js',
  './js/ui/toast.js',
  './js/ui/widgets.js',
  './js/forms/eventForm.js',
  './js/forms/goalForm.js',
  './js/forms/meetingRoom.js',
  './js/forms/taskForm.js',
  './js/features/calendar.js',
  './js/features/dashboard.js',
  './js/features/goals.js',
  './js/features/meetings.js',
  './js/features/dayplan.js',
  './js/features/schedule.js',
  './js/features/settings.js',
  './js/features/tasks.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
  './icons/splash-logo.webp',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP_SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'planner-fonts').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: ใช้ของที่แคชไว้ก่อน แล้วอัปเดตเบื้องหลัง
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open('planner-fonts').then(async (cache) => {
        const hit = await cache.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // หน้าเว็บ: ลองโหลดจากเน็ตก่อน ถ้าออฟไลน์ใช้ของในแคช
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // ไฟล์อื่น ๆ: ใช้แคชก่อน (เร็ว) ถ้าไม่มีค่อยโหลด
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
