// ==========================================================
// gcal.js — ซิงก์สองทางกับ Google Calendar
//
// - ดึงนัดจาก Google (ย้อนหลัง 30 วัน ถึงล่วงหน้า 120 วัน) มาเป็นนัดในแอป
// - แก้ / ลาก / ลบ นัดที่มาจาก Google ในแอป -> อัปเดตใน Google
// - นัดที่สร้างในแอปหลังเชื่อมต่อ -> สร้างใน Google ด้วย (ปิดได้ในตั้งค่า)
// - บันทึกการประชุม วาระ และสิ่งที่ต้องทำ เก็บในแอปเท่านั้น
// - ไม่แก้ผู้เข้าร่วม และไม่ส่งอีเมลแจ้งใคร (sendUpdates=none)
//
// ใช้ Google Identity Services (token แบบมีอายุ ~1 ชั่วโมง เก็บไว้ในหน่วยความจำเท่านั้น)
// ==========================================================
import { store } from '../core/store.js';
import { uid, toKey, addDays, fromKey, pad } from '../core/utils.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const PAST_DAYS = 30;
const FUTURE_DAYS = 120;
const AUTO_SYNC_MS = 5 * 60 * 1000;
const DELETE_DELAY_MS = 5600; // รอให้กด "เลิกทำ" ได้ก่อนลบใน Google

// สีนัดของ Google (colorId) <-> สีในแอป
const G_TO_APP = {
  1: '#8b5cf6', 2: '#10b981', 3: '#8b5cf6', 4: '#ec4899', 5: '#f59e0b', 6: '#f59e0b',
  7: '#0ea5e9', 8: '#64748b', 9: '#6366f1', 10: '#10b981', 11: '#ef4444',
};
const APP_TO_G = {
  '#6366f1': '9', '#8b5cf6': '3', '#ec4899': '4', '#ef4444': '11',
  '#f59e0b': '5', '#10b981': '2', '#0ea5e9': '7', '#64748b': '8',
};
const DEFAULT_COLOR = '#0ea5e9';

let token = null;
let tokenExp = 0;
let tokenClient = null;
let gisPromise = null;
let syncing = null; // Promise ของการซิงก์ที่กำลังทำ
let timer = null;
let applyingRemote = false;
const pushTimers = new Map(); // eventId -> timeout
const deleteTimers = new Map(); // gId -> timeout

const status = { state: 'off', error: '', lastSync: null };
const listeners = new Set();
const setStatus = (patch) => {
  Object.assign(status, patch);
  listeners.forEach((fn) => fn({ ...status }));
};
export const gcalStatus = () => ({ ...status, connected: cfg().enabled, hasToken: hasToken() });
export const onGcalChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const cfg = () => store.state.settings.gcal;
const setCfg = (patch) => store.setSettings({ gcal: { ...cfg(), ...patch } });
const hasToken = () => !!token && Date.now() < tokenExp - 60000;
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok';

/** ใช้งานได้ไหม (หน้าตัวอย่างใน Claude บล็อกการเชื่อมต่อ Google) */
export function gcalAvailable() {
  try {
    if (window.self !== window.top) return false;
  } catch (_) {
    return false;
  }
  return location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
}

// ---------------- auth ----------------
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('โหลดระบบล็อกอินของ Google ไม่ได้ (ตรวจสอบอินเทอร์เน็ต)'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** ขอ token: ต้องเรียกจากการกดปุ่ม (เบราว์เซอร์จะบล็อก popup ถ้าไม่ได้กด) */
async function requestToken({ consent = false } = {}) {
  const clientId = cfg().clientId?.trim();
  if (!clientId) throw new Error('ยังไม่ได้ใส่ Client ID');
  await loadGis();
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (res) => {
        if (res.error) return reject(new Error(authError(res.error)));
        token = res.access_token;
        tokenExp = Date.now() + Number(res.expires_in || 3600) * 1000;
        resolve(token);
      },
      error_callback: (err) => reject(new Error(authError(err?.type))),
    });
    tokenClient.requestAccessToken({ prompt: consent ? 'consent' : '' });
  });
}

function authError(code) {
  if (code === 'popup_closed' || code === 'access_denied') return 'ยกเลิกการเข้าสู่ระบบ Google';
  if (code === 'popup_failed_to_open') return 'เบราว์เซอร์บล็อกหน้าต่างเข้าสู่ระบบ ลองกดอีกครั้ง';
  return 'เข้าสู่ระบบ Google ไม่สำเร็จ' + (code ? ` (${code})` : '');
}

async function api(path, { method = 'GET', body, query } = {}) {
  if (!hasToken()) {
    const e = new Error('ต้องเข้าสู่ระบบ Google อีกครั้ง');
    e.needsAuth = true;
    throw e;
  }
  const url = new URL(API + path);
  Object.entries(query || {}).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    token = null;
    const e = new Error('ต้องเข้าสู่ระบบ Google อีกครั้ง');
    e.needsAuth = true;
    throw e;
  }
  if (res.status === 404 || res.status === 410) {
    const e = new Error('ไม่พบนัดนี้ใน Google Calendar');
    e.gone = true;
    throw e;
  }
  if (!res.ok) {
    let msg = `Google ตอบกลับ ${res.status}`;
    try {
      msg = (await res.json()).error?.message || msg;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

const calPath = () => `/calendars/${encodeURIComponent(cfg().calendarId || 'primary')}`;

// ---------------- mapping ----------------
function partsOf(gTime) {
  if (gTime.date) return { date: gTime.date, time: null };
  const d = new Date(gTime.dateTime);
  return { date: toKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function findLink(g) {
  if (g.hangoutLink) return g.hangoutLink;
  const ep = g.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video');
  if (ep?.uri) return ep.uri;
  const m = `${g.location || ''} ${g.description || ''}`.match(/https?:\/\/[^\s<>"]*(zoom\.us|teams\.microsoft|teams\.live|meet\.google|webex)[^\s<>"]*/i);
  return m ? m[0] : '';
}

function fromGoogle(g, existing) {
  const s = partsOf(g.start);
  const e = partsOf(g.end);
  const allDay = !s.time;
  let end = e.time || '23:59';
  if (!allDay && e.date !== s.date) end = '23:59'; // นัดข้ามวัน: แสดงถึงสิ้นวันแรก
  const attendees = (g.attendees || [])
    .filter((a) => !a.self && !a.resource)
    .map((a) => a.displayName || (a.email || '').split('@')[0])
    .filter(Boolean);
  const link = findLink(g);
  const looksLikeMeeting = !!link || attendees.length > 0 || /ประชุม|meeting|sync|stand-?up|1:1|review|interview/i.test(g.summary || '');
  const gColor = g.colorId ? G_TO_APP[g.colorId] : null;
  return {
    id: existing?.id || uid(),
    createdAt: existing?.createdAt || Date.now(),
    source: 'google',
    gId: g.id,
    gEtag: g.etag,
    gUpdated: g.updated,
    gColorId: g.colorId || null,
    recurring: !!g.recurringEventId,
    title: g.summary || '(ไม่มีชื่อ)',
    date: s.date,
    start: allDay ? '00:00' : s.time,
    end: allDay ? '23:59' : end,
    allDay,
    color: gColor || existing?.color || DEFAULT_COLOR,
    category: existing?.category || 'work',
    repeat: 'none',
    notes: (g.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
    isMeeting: existing ? existing.isMeeting : looksLikeMeeting,
    location: g.location || '',
    link,
    attendees,
    agenda: existing?.agenda || [],
    minutes: existing?.minutes || {},
    pendingPush: false,
  };
}

function toGoogle(ev) {
  const body = {
    summary: ev.title,
    description: ev.notes || '',
    location: ev.location || '',
  };
  if (ev.allDay) {
    body.start = { date: ev.date };
    body.end = { date: toKey(addDays(fromKey(ev.date), 1)) };
  } else {
    body.start = { dateTime: `${ev.date}T${ev.start}:00`, timeZone: tz() };
    body.end = { dateTime: `${ev.date}T${ev.end}:00`, timeZone: tz() };
  }
  // ส่งสีเฉพาะเมื่อผู้ใช้เลือกสีที่ต่างจากใน Google
  const want = APP_TO_G[ev.color];
  const current = ev.gColorId ? G_TO_APP[ev.gColorId] : DEFAULT_COLOR;
  if (want && ev.color !== current) body.colorId = want;
  if (!ev.gId && ev.repeat && ev.repeat !== 'none') {
    const rule = {
      daily: 'RRULE:FREQ=DAILY',
      weekdays: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      weekly: 'RRULE:FREQ=WEEKLY',
      monthly: 'RRULE:FREQ=MONTHLY',
    }[ev.repeat];
    if (rule) body.recurrence = [rule];
  }
  return body;
}

// ---------------- pull ----------------
async function pull() {
  const now = new Date();
  const timeMin = addDays(now, -PAST_DAYS).toISOString();
  const timeMax = addDays(now, FUTURE_DAYS).toISOString();
  const items = [];
  let pageToken;
  do {
    const res = await api(`${calPath()}/events`, {
      query: { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', pageToken },
    });
    items.push(...(res.items || []));
    pageToken = res.nextPageToken;
  } while (pageToken);

  const winStart = toKey(addDays(now, -PAST_DAYS));
  const winEnd = toKey(addDays(now, FUTURE_DAYS));
  let added = 0;
  let updated = 0;
  let removed = 0;

  applyingRemote = true;
  try {
    store.batch((state) => {
      const byGid = new Map(state.events.filter((e) => e.gId).map((e) => [e.gId, e]));
      const seen = new Set();
      items.forEach((g) => {
        if (g.status === 'cancelled') return;
        seen.add(g.id);
        const ex = byGid.get(g.id);
        if (ex?.pendingPush) return; // มีการแก้ในแอปที่ยังส่งไม่สำเร็จ: ใช้ของในแอป
        if (ex && ex.gEtag === g.etag) return;
        const mapped = fromGoogle(g, ex);
        mapped._gSig = JSON.stringify(toGoogle(mapped));
        if (ex) {
          Object.assign(ex, mapped);
          updated++;
        } else {
          state.events.push(mapped);
          added++;
        }
      });
      // นัดที่ถูกลบใน Google
      const before = state.events.length;
      state.events = state.events.filter(
        (e) => !(e.source === 'google' && !e.pendingPush && e.date >= winStart && e.date <= winEnd && !seen.has(e.gId)),
      );
      removed = before - state.events.length;
    }, { source: 'gcal' });
  } finally {
    applyingRemote = false;
  }
  return { added, updated, removed, total: items.length };
}

// ---------------- push ----------------
async function pushEvent(ev) {
  const body = toGoogle(ev);
  if (ev.gId) {
    try {
      const g = await api(`${calPath()}/events/${encodeURIComponent(ev.gId)}`, {
        method: 'PATCH', body, query: { sendUpdates: 'none' },
      });
      applyRemote(ev.id, { gEtag: g.etag, gUpdated: g.updated, gColorId: g.colorId || null, pendingPush: false });
      return;
    } catch (e) {
      if (!e.gone) throw e;
      // ถูกลบใน Google ไปแล้ว: สร้างใหม่ (เช่น กด "เลิกทำ" หลังลบ)
    }
  }
  const g = await api(`${calPath()}/events`, { method: 'POST', body, query: { sendUpdates: 'none' } });
  if (body.recurrence) {
    // นัดแบบทำซ้ำ: ให้ Google เป็นตัวหลัก แล้วดึงแต่ละครั้งกลับมาตอนซิงก์
    applyingRemote = true;
    try {
      store.batch((state) => {
        state.events = state.events.filter((x) => x.id !== ev.id);
      }, { source: 'gcal' });
    } finally {
      applyingRemote = false;
    }
    await pull();
    return;
  }
  applyRemote(ev.id, {
    source: 'google', gId: g.id, gEtag: g.etag, gUpdated: g.updated, gColorId: g.colorId || null,
    repeat: 'none', pendingPush: false,
  });
}

function applyRemote(id, patch) {
  applyingRemote = true;
  try {
    store.batch((state) => {
      const ev = state.events.find((e) => e.id === id);
      if (ev) Object.assign(ev, patch);
    }, { source: 'gcal' });
  } finally {
    applyingRemote = false;
  }
}

function markPending(id) {
  applyRemote(id, { pendingPush: true });
}

function shouldPush(ev) {
  if (!ev || !cfg().enabled) return false;
  if (ev.source === 'google') return true;
  return cfg().autoCreate && ev.createdAt >= (cfg().connectedAt || Infinity);
}

function schedulePush(id) {
  clearTimeout(pushTimers.get(id));
  pushTimers.set(
    id,
    setTimeout(async () => {
      pushTimers.delete(id);
      const ev = store.find('events', id);
      if (!shouldPush(ev)) return;
      if (!hasToken()) {
        markPending(id);
        setStatus({ state: 'needs-auth', error: '' });
        return;
      }
      try {
        setStatus({ state: 'syncing', error: '' });
        await pushEvent(ev);
        setStatus({ state: 'ok', lastSync: Date.now() });
      } catch (e) {
        markPending(id);
        setStatus({ state: e.needsAuth ? 'needs-auth' : 'error', error: e.needsAuth ? '' : e.message });
      }
    }, 400),
  );
}

function scheduleDelete(gId) {
  clearTimeout(deleteTimers.get(gId));
  deleteTimers.set(
    gId,
    setTimeout(async () => {
      deleteTimers.delete(gId);
      if (store.state.events.some((e) => e.gId === gId)) return; // ถูกกู้คืน
      await deleteRemote(gId);
    }, DELETE_DELAY_MS),
  );
}

async function deleteRemote(gId) {
  if (!hasToken()) {
    setCfg({ pendingDeletes: [...new Set([...(cfg().pendingDeletes || []), gId])] });
    setStatus({ state: 'needs-auth' });
    return;
  }
  try {
    await api(`${calPath()}/events/${encodeURIComponent(gId)}`, { method: 'DELETE', query: { sendUpdates: 'none' } });
  } catch (e) {
    if (!e.gone) {
      setCfg({ pendingDeletes: [...new Set([...(cfg().pendingDeletes || []), gId])] });
      setStatus({ state: e.needsAuth ? 'needs-auth' : 'error', error: e.needsAuth ? '' : e.message });
      return;
    }
  }
  setCfg({ pendingDeletes: (cfg().pendingDeletes || []).filter((x) => x !== gId) });
}

/** ฟังการเปลี่ยนแปลงในแอป แล้วส่งไป Google */
function onStoreChange(change) {
  if (applyingRemote || !cfg().enabled || change.col !== 'events') return;
  if (change.type === 'remove') {
    const item = change.item;
    if (item?.gId) scheduleDelete(item.gId);
    clearTimeout(pushTimers.get(change.id));
    return;
  }
  if (change.type === 'add') {
    const ev = store.find('events', change.id);
    if (ev?.gId && deleteTimers.has(ev.gId)) {
      // กด "เลิกทำ" ทันก่อนลบใน Google
      clearTimeout(deleteTimers.get(ev.gId));
      deleteTimers.delete(ev.gId);
      return;
    }
  }
  if (change.type === 'add' || change.type === 'update') {
    const ev = store.find('events', change.id);
    if (!shouldPush(ev)) return;
    // บันทึก/วาระการประชุมไม่ต้องส่งไป Google: เทียบเฉพาะข้อมูลที่ซิงก์
    const sig = JSON.stringify(toGoogle(ev));
    if (ev._gSig === sig && ev.gId) return;
    ev._gSig = sig;
    schedulePush(change.id);
  }
}

// ---------------- public ----------------
/** ซิงก์ทั้งหมด: ส่งที่ค้าง -> ดึงล่าสุด */
export function syncNow({ interactive = false } = {}) {
  if (!cfg().enabled) return Promise.resolve(null);
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      if (!hasToken()) {
        if (!interactive) {
          setStatus({ state: 'needs-auth', error: '' });
          return null;
        }
        setStatus({ state: 'connecting', error: '' });
        await requestToken();
      }
      setStatus({ state: 'syncing', error: '' });
      for (const gId of [...(cfg().pendingDeletes || [])]) await deleteRemote(gId);
      for (const ev of store.state.events.filter((e) => e.pendingPush && shouldPush(e))) {
        try {
          await pushEvent(ev);
        } catch (e) {
          if (e.needsAuth) throw e;
        }
      }
      const r = await pull();
      setCfg({ lastSync: Date.now() });
      setStatus({ state: 'ok', error: '', lastSync: Date.now() });
      return r;
    } catch (e) {
      setStatus({ state: e.needsAuth ? 'needs-auth' : 'error', error: e.needsAuth ? '' : e.message });
      throw e;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** เชื่อมต่อครั้งแรก (เรียกจากการกดปุ่ม) */
export async function connect(clientId) {
  if (clientId != null) setCfg({ clientId: clientId.trim() });
  setStatus({ state: 'connecting', error: '' });
  try {
    await requestToken({ consent: true });
  } catch (e) {
    setStatus({ state: 'off', error: e.message });
    throw e;
  }
  setCfg({ enabled: true, connectedAt: cfg().connectedAt || Date.now() });
  const r = await syncNow();
  startAuto();
  return r;
}

/** ยกเลิกการเชื่อมต่อ (keepEvents=false จะลบนัดที่มาจาก Google ออกจากแอป) */
export function disconnect({ keepEvents = true } = {}) {
  if (token && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(token, () => {});
    } catch (_) {}
  }
  token = null;
  tokenExp = 0;
  stopAuto();
  applyingRemote = true;
  try {
    store.batch((state) => {
      state.settings.gcal = { ...state.settings.gcal, enabled: false, connectedAt: null, pendingDeletes: [] };
      if (!keepEvents) state.events = state.events.filter((e) => e.source !== 'google');
      else
        state.events.forEach((e) => {
          if (e.source === 'google') {
            e.source = 'local';
            delete e.gId;
            e.pendingPush = false;
          }
        });
    }, { source: 'gcal' });
  } finally {
    applyingRemote = false;
  }
  setStatus({ state: 'off', error: '' });
}

export function setAutoCreate(on) {
  setCfg({ autoCreate: !!on });
}

function startAuto() {
  stopAuto();
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && hasToken()) syncNow().catch(() => {});
  }, AUTO_SYNC_MS);
}
function stopAuto() {
  clearInterval(timer);
  timer = null;
}

/** โหลดสคริปต์ล็อกอินไว้ก่อน เพื่อให้ popup เปิดได้ทันทีเมื่อกดปุ่ม */
export function preloadGcal() {
  if (gcalAvailable() && cfg().clientId) loadGis().catch(() => {});
}

export function setupGcal() {
  store.subscribe(onStoreChange);
  if (!cfg().enabled) return;
  preloadGcal();
  setStatus({ state: 'needs-auth', lastSync: cfg().lastSync });
  startAuto();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cfg().enabled && hasToken()) syncNow().catch(() => {});
  });
}

// สำหรับทดสอบ
export const _internal = { fromGoogle, toGoogle };
