// ==========================================================
// notify.js — แจ้งเตือนก่อนประชุม / นัดหมาย / งานที่มีเวลา / วางแผนตอนเช้า
//
// ทำงานขณะที่แอปเปิดอยู่ หรือเพิ่งสลับออกไปไม่นาน
// (ถ้าปิดแอปสนิท ให้ Google Calendar เป็นคนเตือนแทน: ดู gcal.js)
// ==========================================================
import { store } from '../core/store.js';
import { todayKey, toKey, addDays, timeToMin } from '../core/utils.js';
import { eventsOn } from '../core/selectors.js';
import { toast } from './toast.js';

const SENT_KEY = 'planner.notified';
const CHECK_MS = 30 * 1000;

const cfg = () => store.state.settings.notify;
const setCfg = (patch) => store.setSettings({ notify: { ...cfg(), ...patch } });

export const notifySupported = () => 'Notification' in window;
export const notifyPermission = () => (notifySupported() ? Notification.permission : 'unsupported');
export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function loadSent() {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) || '{}');
  } catch (_) {
    return {};
  }
}
function saveSent(sent) {
  // เก็บแค่ 2 วันล่าสุด
  const keep = toKey(addDays(new Date(), -1));
  Object.keys(sent).forEach((k) => {
    if (sent[k] < keep) delete sent[k];
  });
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(sent));
  } catch (_) {}
}

async function show(title, { body = '', tag, url = './', link = '' } = {}) {
  const visible = document.visibilityState === 'visible';
  if (visible) {
    // เปิดแอปอยู่: แสดงในแอป + สั่นเบา ๆ
    navigator.vibrate?.([80, 60, 80]);
    toast(`${title}${body ? ' · ' + body : ''}`, {
      icon: '🔔',
      duration: 9000,
      action: link ? 'เข้าร่วม' : 'เปิด',
      onAction: () => (link ? window.open(link, '_blank', 'noopener') : (location.hash = url.split('#')[1] || '')),
    });
  }
  if (notifyPermission() !== 'granted' || (visible && document.hasFocus())) return;
  const opts = {
    body,
    tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/favicon-64.png',
    data: { url, link },
    actions: link ? [{ action: 'join', title: 'เข้าร่วมประชุม' }, { action: 'open', title: 'เปิด Planner' }] : [],
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification(title, opts);
  } catch (_) {
    /* ใช้แบบธรรมดาแทน */
  }
  try {
    const n = new Notification(title, opts);
    n.onclick = () => {
      window.focus();
      location.hash = url.split('#')[1] || '';
    };
  } catch (_) {}
}

/** รายการที่ควรแจ้งเตือนตอนนี้ */
export function dueReminders(now = new Date()) {
  const c = cfg();
  const lead = (Number(c.lead) || 10) * 60000;
  const out = [];
  // เตือนตั้งแต่ถึงเวลาเตือน จนถึงเวลาเริ่ม (เปิดแอปช้าก็ยังเตือน ถ้ายังไม่เริ่ม)
  const consider = (when, item) => {
    if (now >= when - lead && now < when) {
      const mins = Math.max(1, Math.round((when - now) / 60000));
      out.push({ ...item, body: `เริ่มในอีก ${mins} นาที · ${item.body}` });
    }
  };
  const days = [todayKey(), toKey(addDays(now, 1))];
  if (c.events) {
    days.forEach((k) => {
      eventsOn(k)
        .filter((e) => !e.allDay)
        .forEach((e) => {
          const d = new Date(`${k}T${e.start}:00`);
          consider(d.getTime(), {
            key: `e:${e.id}:${k}`,
            title: `${e.isMeeting ? '👥' : '📅'} ${e.title}`,
            body: `${e.start}–${e.end}${e.location ? ' · ' + e.location : ''}${e.isMeeting && e.link ? ' · ออนไลน์' : ''}`,
            url: e.isMeeting ? './#meetings' : './#schedule',
            link: e.isMeeting ? e.link : '',
          });
        });
    });
  }
  if (c.tasks) {
    store.state.tasks
      .filter((t) => !t.done && t.due && t.time && days.includes(t.due))
      .forEach((t) => {
        const d = new Date(`${t.due}T${t.time}:00`);
        consider(d.getTime(), { key: `t:${t.id}:${t.due}`, title: `✅ ${t.title}`, body: `เวลา ${t.time}`, url: './#tasks' });
      });
  }
  if (c.morning) {
    const key = todayKey();
    const ws = store.state.settings.workStart || '08:30';
    const d = new Date(`${key}T${ws}:00`);
    const day = store.day(key);
    if (!day.planned && now >= d && now - d <= 2 * 60 * 60000) {
      const meetings = eventsOn(key).filter((e) => e.isMeeting && !e.allDay).length;
      out.push({
        key: `m:${key}`,
        title: '🌅 วางแผนวันนี้กัน',
        body: meetings ? `วันนี้มีประชุม ${meetings} นัด เลือก 3 งานสำคัญก่อนเริ่มวัน` : 'เลือก 3 งานสำคัญก่อนเริ่มวัน',
        url: './#dashboard',
      });
    }
  }
  return out;
}

export function checkNow(now = new Date()) {
  if (!cfg().enabled) return [];
  const sent = loadSent();
  const fired = [];
  dueReminders(now).forEach((r) => {
    if (sent[r.key]) return;
    sent[r.key] = todayKey();
    fired.push(r);
    show(r.title, { body: r.body, tag: r.key, url: r.url, link: r.link });
  });
  if (fired.length) saveSent(sent);
  return fired;
}

/** เปิดการแจ้งเตือน (เรียกจากการกดปุ่ม) */
export async function enableNotify() {
  if (!notifySupported()) {
    throw new Error(isIOS() ? 'บน iPhone ต้องติดตั้งแอปลงหน้าจอโฮมก่อน แล้วเปิดจากไอคอน' : 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน');
  }
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (p !== 'granted') throw new Error('ยังไม่ได้อนุญาตการแจ้งเตือน เปิดได้ในการตั้งค่าของเบราว์เซอร์/โทรศัพท์');
  setCfg({ enabled: true });
  checkNow();
}

export function disableNotify() {
  setCfg({ enabled: false });
}

export function setNotifyOption(patch) {
  setCfg(patch);
}

export function testNotify() {
  show('🔔 ทดสอบการแจ้งเตือน', { body: 'Planner จะเตือนแบบนี้ก่อนประชุมและนัดหมาย', tag: 'test', url: './#meetings' });
}

let timer = null;
export function setupNotify() {
  clearInterval(timer);
  timer = setInterval(() => checkNow(), CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkNow();
  });
  setTimeout(() => checkNow(), 3000);
}
