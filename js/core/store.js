// ==========================================================
// store.js — app state, persistence (IndexedDB + สำเนาใน localStorage), pub/sub
// ==========================================================
import { uid, todayKey, toKey, addDays } from './utils.js';
import { idbGet, idbPut, writeState, writeMirror, flushWrites, requestPersist, storageEstimate, wipeAll } from './persist.js';

const KEY = 'planner.v1';
const VERSION = 2;
const COLLECTIONS = ['tasks', 'events', 'goals', 'templates', 'learnings', 'portfolio'];

const defaultGcal = () => ({
  enabled: false, // เชื่อมต่อ Google Calendar อยู่หรือไม่
  clientId: '', // OAuth Client ID (ไม่ใช่ความลับ)
  calendarId: 'primary',
  autoCreate: true, // นัดที่สร้างในแอปหลังเชื่อมต่อ จะถูกบันทึกลง Google ด้วย
  connectedAt: null,
  lastSync: null,
  pendingDeletes: [], // id ของนัดใน Google ที่รอลบ (กรณีออฟไลน์)
});
const defaultBackup = () => ({ auto: true, lastBackup: null, fileId: null });
const defaultLock = () => ({ enabled: false, salt: '', hash: '', after: 1 }); // after = ล็อกเมื่อออกจากแอปเกินกี่นาที
// การแจ้งเตือน: lead = เตือนก่อนกี่นาที, gcal = ใส่การแจ้งเตือนในนัดที่ส่งไป Google ด้วย
const defaultNotify = () => ({ enabled: false, lead: 10, events: true, tasks: true, morning: true, learn: true, gcal: true });
const defaultSettings = () => ({
  name: '', theme: 'auto', weekStart: 0, workStart: '08:30', workEnd: '17:30',
  gcal: defaultGcal(), backup: defaultBackup(), lock: defaultLock(), notify: defaultNotify(),
  ai: { enabled: false, code: '' }, // AI ช่วยอ่านข้อความ (รหัสเก็บเฉพาะเครื่องนี้)
  profile: { rank: '', fullName: '', position: '', unit: '' }, // ใช้ในรายงานแฟ้มผลงาน
  // Notion: ตั้งค่าร่วมทุกเครื่อง (หน้าและตารางที่ใช้) / notionLocal: รหัสใช้งานของเครื่องนี้
  notion: { enabled: false, pageId: '', pageUrl: '', title: '', dbs: {}, auto: true, archivedAt: 0, kinds: { portfolio: true, learnings: true, meetings: true, tasks: true } },
  notionLocal: { code: '', lastSync: null, lastError: '' },
});
// ค่าที่เป็นของเครื่องนี้ ไม่ทับตอนนำเข้า/กู้คืนข้อมูล
const DEVICE_KEYS = ['gcal', 'backup', 'lock', 'notify', 'ai', 'focus', 'notionLocal'];

const IDB_KEY = 'state';
// ⚠️ ตัวแปรทั้งหมดที่ load() ใช้ ต้องประกาศก่อนบรรทัด `let state = load()`
let loadedFromLocal = false;
let brokenRaw = null; // ข้อมูลเดิมที่อ่านไม่ได้: เก็บสำรองไว้ก่อน ไม่บันทึกทับ
let booted = false; // อ่านข้อมูลจาก IndexedDB เสร็จแล้วหรือยัง (ก่อนหน้านั้นไม่บันทึก กันทับข้อมูลจริงด้วยข้อมูลตัวอย่าง)
let pendingSave = false;
let backend = 'local'; // 'idb' เมื่อใช้ IndexedDB ได้
let lastSize = 0;
const listeners = new Set();
let state = load();

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (_) {}
  if (raw) {
    try {
      const s = normalize(JSON.parse(raw));
      loadedFromLocal = true;
      lastSize = raw.length;
      return s;
    } catch (e) {
      brokenRaw = raw;
      console.warn('อ่านข้อมูลใน localStorage ไม่ได้ (เก็บสำรองไว้ให้แล้ว)', e);
    }
  }
  return seed();
}

/**
 * เปิดแอป: อ่านจาก IndexedDB แล้วใช้ฉบับที่บันทึกล่าสุด
 * ข้อมูลเก่าที่อยู่แค่ใน localStorage จะถูกย้ายเข้า IndexedDB ให้อัตโนมัติ
 */
export const storeReady = (async () => {
  const localSaved = loadedFromLocal ? state.savedAt || 1 : 0;
  let rec = null;
  try {
    rec = await idbGet(IDB_KEY);
    backend = 'idb';
  } catch (_) {
    backend = 'local';
  }
  // ข้อมูลเดิมที่อ่านไม่ได้: เก็บต้นฉบับไว้ก่อนเสมอ (กู้ได้ภายหลัง)
  if (brokenRaw) {
    try {
      localStorage.setItem(`${KEY}.broken`, brokenRaw);
    } catch (_) {}
    if (backend === 'idb') await idbPut(`broken-${Date.now()}`, brokenRaw).catch(() => {});
  }
  let needSave = !loadedFromLocal; // เปิดครั้งแรก: บันทึกข้อมูลตัวอย่าง (id จะได้ไม่เปลี่ยนเมื่อรีโหลด)
  if (backend === 'idb') {
    if (rec?.json && (rec.savedAt || 0) > localSaved) {
      try {
        state = normalize(JSON.parse(rec.json));
        state.savedAt = rec.savedAt;
        sigs = null;
        lastSize = rec.json.length;
        writeMirror(KEY, rec.json);
        needSave = false;
      } catch (e) {
        console.warn('อ่านข้อมูลใน IndexedDB ไม่ได้ ใช้สำเนาใน localStorage แทน', e);
        await idbPut(`broken-${Date.now()}`, rec.json).catch(() => {});
        needSave = loadedFromLocal;
      }
    } else if (loadedFromLocal) needSave = true; // ย้ายข้อมูลเดิมเข้า IndexedDB / สำเนาใหม่กว่า
  }
  if (brokenRaw && !loadedFromLocal && !(rec?.json)) needSave = false;
  booted = true;
  if (needSave || pendingSave) save();
  requestPersist();
})();

function normalize(data) {
  const s = {
    version: VERSION,
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    events: Array.isArray(data.events) ? data.events : [],
    goals: Array.isArray(data.goals) ? data.goals : [],
    templates: Array.isArray(data.templates) ? data.templates : [],
    learnings: Array.isArray(data.learnings) ? data.learnings : [], // วันนี้เรียนรู้อะไร
    portfolio: Array.isArray(data.portfolio) ? data.portfolio : [], // แฟ้มสะสมผลงาน
    days: data.days && typeof data.days === 'object' ? data.days : {},
    settings: { ...defaultSettings(), ...(data.settings || {}) },
    // การลบที่ต้องซิงก์ไปเครื่องอื่น: { tasks: { id: เวลาที่ลบ }, ... }
    deleted: { tasks: {}, events: {}, goals: {}, templates: {}, learnings: {}, portfolio: {}, days: {}, ...(data.deleted || {}) },
    settingsUpdatedAt: data.settingsUpdatedAt || 0,
    demoClearedAt: data.demoClearedAt || 0,
    savedAt: data.savedAt || 0,
  };
  [...COLLECTIONS].forEach((c) => s[c].forEach((it) => (it.updatedAt = it.updatedAt || it.createdAt || 0)));
  s.settings.gcal = { ...defaultGcal(), ...(s.settings.gcal || {}) };
  s.settings.backup = { ...defaultBackup(), ...(s.settings.backup || {}) };
  s.settings.lock = { ...defaultLock(), ...(s.settings.lock || {}) };
  s.settings.notify = { ...defaultNotify(), ...(s.settings.notify || {}) };
  s.settings.profile = { ...defaultSettings().profile, ...(s.settings.profile || {}) };
  s.settings.notion = { ...defaultSettings().notion, ...(s.settings.notion || {}) };
  s.settings.notion.kinds = { ...defaultSettings().notion.kinds, ...(s.settings.notion.kinds || {}) };
  s.settings.notionLocal = { ...defaultSettings().notionLocal, ...(s.settings.notionLocal || {}) };
  s.portfolio.forEach((p) => {
    if (!Array.isArray(p.figures)) p.figures = [];
    if (!Array.isArray(p.files)) p.files = [];
    if (!Array.isArray(p.links)) p.links = [];
  });
  s.goals.forEach((g) => (g.milestones = Array.isArray(g.milestones) ? g.milestones : []));
  s.events.forEach((e) => {
    // v1 -> v2: นัดที่ชื่อมีคำว่า "ประชุม" ถือเป็นการประชุม
    if (e.isMeeting === undefined) e.isMeeting = /ประชุม|meeting/i.test(e.title || '');
    if (!Array.isArray(e.attendees)) e.attendees = [];
    if (!Array.isArray(e.agenda)) e.agenda = [];
    if (!e.minutes || typeof e.minutes !== 'object') e.minutes = {};
    e.location = e.location || '';
    e.link = e.link || '';
  });
  return s;
}

// ---------- ติดตามการเปลี่ยนแปลง (สำหรับซิงก์ระหว่างเครื่อง) ----------
// เทียบกับครั้งก่อน: รายการที่เปลี่ยนได้ updatedAt ใหม่, รายการที่หายไปถูกบันทึกว่า "ลบ"
const SHARED_SETTINGS = ['name', 'theme', 'weekStart', 'workStart', 'workEnd', 'profile', 'notion'];
let sigs = null;
const sigOf = (o) => {
  const { updatedAt, ...rest } = o || {};
  return JSON.stringify(rest);
};
const sharedSettingsSig = () => JSON.stringify(SHARED_SETTINGS.map((k) => state.settings[k]));

function snapshotSigs() {
  sigs = { settings: sharedSettingsSig() };
  [...COLLECTIONS].forEach((c) => (sigs[c] = new Map(state[c].map((it) => [it.id, sigOf(it)]))));
  sigs.days = new Map(Object.entries(state.days).map(([k, v]) => [k, sigOf(v)]));
}

function stamp() {
  if (!sigs) return snapshotSigs();
  const now = Date.now();
  const del = state.deleted;
  COLLECTIONS.forEach((c) => {
    const seen = new Set();
    state[c].forEach((it) => {
      seen.add(it.id);
      const sig = sigOf(it);
      if (sigs[c].get(it.id) !== sig) {
        it.updatedAt = now;
        sigs[c].set(it.id, sig);
        delete del[c][it.id];
      }
    });
    [...sigs[c].keys()].forEach((id) => {
      if (!seen.has(id)) {
        del[c][id] = now;
        sigs[c].delete(id);
      }
    });
  });
  const seenDays = new Set();
  Object.entries(state.days).forEach(([k, v]) => {
    seenDays.add(k);
    const sig = sigOf(v);
    if (sigs.days.get(k) !== sig) {
      v.updatedAt = now;
      sigs.days.set(k, sig);
      delete del.days[k];
    }
  });
  [...sigs.days.keys()].forEach((k) => {
    if (!seenDays.has(k)) {
      del.days[k] = now;
      sigs.days.delete(k);
    }
  });
  const ss = sharedSettingsSig();
  if (ss !== sigs.settings) {
    state.settingsUpdatedAt = now;
    sigs.settings = ss;
  }
}

function save() {
  stamp();
  if (!booted) {
    pendingSave = true;
    return;
  }
  state.savedAt = Date.now();
  const json = JSON.stringify(state);
  lastSize = json.length;
  if (backend === 'idb') {
    writeState(IDB_KEY, json, state.savedAt);
    writeMirror(KEY, json);
  } else writeMirror(KEY, json, { required: true });
}

function emit(change) {
  save();
  listeners.forEach((fn) => fn(change));
}

export const store = {
  get state() {
    return state;
  },

  /** สถานะที่เก็บข้อมูลในเครื่อง (หน้าตั้งค่า) */
  async storageInfo() {
    const est = await storageEstimate();
    return { backend, dataBytes: new Blob([JSON.stringify(state)]).size, ...est };
  },
  flush: () => flushWrites(),
  /** ล้างข้อมูลทั้งหมดในเครื่อง (ลืม PIN) */
  wipeAll: () => wipeAll(KEY).then(() => wipeAll(IDB_KEY)),

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  find(col, id) {
    return state[col].find((x) => x.id === id);
  },

  add(col, item) {
    const it = { id: uid(), createdAt: Date.now(), ...item };
    state[col].push(it);
    emit({ type: 'add', col, id: it.id });
    return it;
  },

  update(col, id, patch) {
    const it = this.find(col, id);
    if (!it) return null;
    Object.assign(it, typeof patch === 'function' ? patch(it) : patch);
    emit({ type: 'update', col, id });
    return it;
  },

  /** removes and returns a snapshot that can be passed to restore() */
  remove(col, id) {
    const idx = state[col].findIndex((x) => x.id === id);
    if (idx < 0) return null;
    const [item] = state[col].splice(idx, 1);
    const unlinked = [];
    const linkKey = col === 'goals' ? 'goalId' : col === 'events' ? 'meetingId' : null;
    if (linkKey) {
      state.tasks.forEach((t) => {
        if (t[linkKey] === id) {
          t[linkKey] = null;
          unlinked.push(t.id);
        }
      });
    }
    emit({ type: 'remove', col, id, item });
    return { col, idx, item, unlinked };
  },

  restore(snap) {
    if (!snap) return;
    state[snap.col].splice(snap.idx, 0, snap.item);
    const linkKey = snap.col === 'goals' ? 'goalId' : 'meetingId';
    snap.unlinked.forEach((tid) => {
      const t = this.find('tasks', tid);
      if (t) t[linkKey] = snap.item.id;
    });
    emit({ type: 'add', col: snap.col, id: snap.item.id });
  },

  toggleTask(id) {
    return this.update('tasks', id, (t) => ({ done: !t.done, doneAt: !t.done ? Date.now() : null }));
  },

  toggleMilestone(goalId, msId) {
    return this.update('goals', goalId, (g) => ({
      milestones: g.milestones.map((m) =>
        m.id === msId ? { ...m, done: !m.done, doneAt: !m.done ? Date.now() : null } : m,
      ),
    }));
  },

  /** บันทึกการประชุมของวันที่ระบุ (นัดแบบทำซ้ำมีบันทึกแยกแต่ละครั้ง) */
  setMinutes(eventId, dateKey, patch, { silent = false } = {}) {
    const ev = this.find('events', eventId);
    if (!ev) return;
    ev.minutes = ev.minutes || {};
    ev.minutes[dateKey] = { notes: '', agendaDone: [], ...(ev.minutes[dateKey] || {}), ...patch };
    if (silent) save();
    else emit({ type: 'update', col: 'events', id: eventId });
  },

  /** เปลี่ยนข้อมูลหลายอย่างพร้อมกัน แล้วแจ้งครั้งเดียว (ใช้ตอนซิงก์) */
  batch(fn, meta = {}) {
    fn(state);
    emit({ type: 'sync', ...meta });
  },

  setSettings(patch) {
    Object.assign(state.settings, patch);
    emit({ type: 'settings' });
  },

  exportJSON() {
    const settings = { ...state.settings };
    delete settings.lock; // ไม่ส่ง PIN ออกไปกับไฟล์สำรอง
    delete settings.ai; // รหัส AI เป็นของเครื่องนี้
    delete settings.notionLocal; // รหัสใช้งาน Notion เป็นของเครื่องนี้
    return JSON.stringify({ ...state, settings, exportedAt: new Date().toISOString() }, null, 2);
  },

  /**
   * รวมข้อมูลจากเครื่องอื่น (ไฟล์ใน Google Drive): รายการไหนแก้ล่าสุดชนะ, การลบซิงก์ด้วย
   * ค่าที่เป็นของเครื่องนี้ (Google, PIN, การแจ้งเตือน) ไม่ถูกแตะ
   */
  mergeRemote(remoteData) {
    stamp(); // บันทึกการแก้ล่าสุดในเครื่องก่อน
    const r = normalize(remoteData || {});
    const stats = { added: 0, updated: 0, removed: 0 };
    const DAY_MS = 86400000;
    // tombstones: เอาเวลาล่าสุดของทั้งสองฝั่ง
    const del = {};
    [...COLLECTIONS, 'days'].forEach((c) => {
      del[c] = { ...(r.deleted[c] || {}) };
      Object.entries(state.deleted[c] || {}).forEach(([id, t]) => (del[c][id] = Math.max(del[c][id] || 0, t)));
    });
    // ข้อมูลตัวอย่าง: ถ้าเครื่องใดล้างไปแล้ว ให้ล้างทุกเครื่อง / ถ้ามีทั้งสองฝั่ง ใช้ของเครื่องนี้
    const demoClearedAt = Math.max(state.demoClearedAt || 0, r.demoClearedAt || 0);
    const localHasSeed = COLLECTIONS.some((c) => state[c].some((x) => x.seed));
    COLLECTIONS.forEach((c) => {
      const byId = new Map(state[c].map((x) => [x.id, x]));
      r[c].forEach((ri) => {
        if (ri.seed && (localHasSeed || demoClearedAt)) return;
        const li = byId.get(ri.id);
        if (!li) {
          if ((del[c][ri.id] || 0) >= (ri.updatedAt || 0)) return;
          state[c].push(ri);
          byId.set(ri.id, ri);
          stats.added++;
        } else if ((ri.updatedAt || 0) > (li.updatedAt || 0)) {
          Object.keys(li).forEach((k) => delete li[k]);
          Object.assign(li, ri);
          stats.updated++;
        }
      });
      const before = state[c].length;
      state[c] = state[c].filter((x) => !((del[c][x.id] || 0) >= (x.updatedAt || 0)) && !(x.seed && demoClearedAt && state.demoClearedAt !== demoClearedAt && demoClearedAt > (x.createdAt || 0)));
      stats.removed += before - state[c].length;
    });
    Object.entries(r.days).forEach(([k, rv]) => {
      const lv = state.days[k];
      if ((!lv && !((del.days[k] || 0) >= (rv.updatedAt || 0))) || (lv && (rv.updatedAt || 0) > (lv.updatedAt || 0))) {
        state.days[k] = rv;
        stats.updated++;
      }
    });
    Object.keys(state.days).forEach((k) => {
      if ((del.days[k] || 0) >= (state.days[k].updatedAt || 0)) delete state.days[k];
    });
    if ((r.settingsUpdatedAt || 0) > (state.settingsUpdatedAt || 0)) {
      SHARED_SETTINGS.forEach((k) => r.settings[k] !== undefined && (state.settings[k] = r.settings[k]));
      state.settingsUpdatedAt = r.settingsUpdatedAt;
    }
    // เก็บประวัติการลบไว้ 90 วัน
    const cutoff = Date.now() - 90 * DAY_MS;
    Object.values(del).forEach((m) => Object.keys(m).forEach((id) => m[id] < cutoff && delete m[id]));
    state.deleted = del;
    state.demoClearedAt = demoClearedAt;
    snapshotSigs(); // ข้อมูลที่รับมาไม่ถือเป็นการแก้ในเครื่องนี้
    save();
    listeners.forEach((fn) => fn({ type: 'merge', ...stats }));
    return stats;
  },

  /** ข้อมูลวางแผนรายวัน: { focus: [taskId], planned, reviewed, mood, note } */
  day(key) {
    return state.days[key] || { focus: [] };
  },
  setDay(key, patch) {
    state.days[key] = { focus: [], ...(state.days[key] || {}), ...patch };
    emit({ type: 'day', key });
  },

  importJSON(text) {
    const data = JSON.parse(text);
    if (!COLLECTIONS.some((c) => Array.isArray(data[c]))) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
    const keep = Object.fromEntries(DEVICE_KEYS.map((k) => [k, state.settings[k]]));
    state = normalize(data);
    Object.assign(state.settings, keep);
    state.deleted = { ...state.deleted };
    emit({ type: 'reset' });
  },

  reset({ demo = true } = {}) {
    const settings = state.settings;
    const deleted = state.deleted;
    state = demo ? seed() : normalize({});
    state.settings = settings;
    state.deleted = deleted;
    if (!demo) state.demoClearedAt = Date.now();
    emit({ type: 'reset' });
  },
};

// ----------------------------------------------------------
// ข้อมูลตัวอย่าง (สร้างอิงจากวันปัจจุบัน)
// ----------------------------------------------------------
function seed() {
  const t = new Date();
  const d = (n) => toKey(addDays(t, n));
  const g1 = uid();
  const g2 = uid();
  const g3 = uid();
  const now = Date.now();
  const day = 86400000;
  const ms = (title, done, ago = 0) => ({ id: uid(), title, done, doneAt: done ? now - ago * day : null });

  const goals = [
    {
      id: g1, title: 'เลื่อนตำแหน่งเป็น Senior ภายในปีนี้', category: 'work', color: '#6366f1',
      description: 'พัฒนาทักษะการเป็นผู้นำ และส่งมอบโปรเจกต์สำคัญให้สำเร็จ',
      deadline: d(55), createdAt: now - 30 * day,
      milestones: [
        ms('คุยเป้าหมายกับหัวหน้า', true, 20),
        ms('เป็นผู้นำโปรเจกต์ใหม่ 1 ชิ้น', true, 6),
        ms('สอนงานน้องในทีม', false),
        ms('นำเสนอผลงานประจำไตรมาส', false),
      ],
    },
    {
      id: g2, title: 'วิ่งฮาล์ฟมาราธอน 21 กม.', category: 'health', color: '#10b981',
      description: 'ซ้อมวิ่งสัปดาห์ละ 3 ครั้ง เพิ่มระยะทีละนิด',
      deadline: d(90), createdAt: now - 20 * day,
      milestones: [
        ms('วิ่ง 5 กม. ต่อเนื่อง', true, 15),
        ms('วิ่ง 10 กม. ต่อเนื่อง', true, 3),
        ms('วิ่ง 15 กม.', false),
        ms('สมัครงานวิ่ง', false),
      ],
    },
    {
      id: g3, title: 'เก็บเงินฉุกเฉิน 100,000 บาท', category: 'finance', color: '#f59e0b',
      description: 'ออมเดือนละ 10,000 บาท และลดค่าใช้จ่ายที่ไม่จำเป็น',
      deadline: d(240), createdAt: now - 60 * day,
      milestones: [
        ms('ทำบัญชีรายรับรายจ่าย', true, 50),
        ms('ครบ 25,000 บาท', true, 30),
        ms('ครบ 50,000 บาท', false),
        ms('ครบ 75,000 บาท', false),
        ms('ครบ 100,000 บาท', false),
      ],
    },
  ];

  const task = (title, due, o = {}) => ({
    id: uid(), title, due, time: '', notes: '', priority: 'medium', category: 'work',
    goalId: null, meetingId: null, meetingDate: null, done: false, doneAt: null, createdAt: now, ...o,
  });

  const tasks = [
    task('ตอบอีเมลลูกค้า', d(0), { priority: 'high', time: '09:30' }),
    task('เตรียมสไลด์ประชุมทีม', d(0), { priority: 'high', goalId: g1 }),
    task('ซ้อมวิ่ง 6 กม.', d(0), { category: 'health', goalId: g2, time: '18:00' }),
    task('อ่านหนังสือ 30 นาที', d(0), { category: 'study', priority: 'low', done: true, doneAt: now - 3600000 }),
    task('สรุปรายงานประจำสัปดาห์', d(1), { priority: 'medium' }),
    task('จ่ายค่าบัตรเครดิต', d(2), { category: 'finance', priority: 'high' }),
    task('โอนเงินเข้าบัญชีออม', d(3), { category: 'finance', goalId: g3 }),
    task('นัดทำฟัน', d(6), { category: 'personal', priority: 'low' }),
    task('รีวิวโค้ดให้น้องในทีม', d(-1), { priority: 'medium', goalId: g1 }),
    task('จองตั๋วเครื่องบินเที่ยวปีใหม่', null, { category: 'personal', priority: 'low' }),
    // ประวัติงานที่ทำเสร็จ สำหรับกราฟ 7 วัน
    ...[[-1, 3], [-2, 5], [-3, 2], [-4, 4], [-5, 6], [-6, 1]].flatMap(([off, n]) =>
      Array.from({ length: n }, (_, i) =>
        task(`งานที่ทำเสร็จ #${i + 1}`, d(off), {
          done: true, doneAt: addDays(t, off).getTime() + (10 + i) * 3600000, priority: 'low',
        }),
      ),
    ),
  ];

  const ev = (title, date, start, end, color, o = {}) => ({
    id: uid(), title, date, start, end, color, category: 'work', repeat: 'none', notes: '', createdAt: now,
    isMeeting: false, location: '', link: '', attendees: [], agenda: [], minutes: {}, ...o,
  });
  const mt = (title, date, start, end, color, o = {}) => ev(title, date, start, end, color, { isMeeting: true, ...o });

  const standup = mt('ประชุมทีมประจำวัน (Stand-up)', d(-14), '09:00', '09:30', '#6366f1', {
    repeat: 'weekdays', link: 'https://meet.google.com/abc-defg-hij',
    attendees: ['ต้น', 'ฝน', 'บอส', 'มายด์'],
    agenda: ['เมื่อวานทำอะไรไป', 'วันนี้จะทำอะไร', 'ติดปัญหาอะไรไหม'],
    minutes: { [d(-1)]: { notes: 'ฝนติดเรื่อง API ของลูกค้า นัดคุยแยกหลังประชุม\nบอสจะส่งดีไซน์หน้าใหม่ภายในวันพฤหัส', agendaDone: [0, 1, 2] } },
  });
  const client = mt('คุยงานกับลูกค้า บริษัท ABC', d(0), '14:00', '15:00', '#ec4899', {
    location: 'ห้องประชุม 3 ชั้น 12', attendees: ['คุณสมชาย (ABC)', 'คุณนิดา (ABC)', 'บอส'],
    agenda: ['สรุปความคืบหน้าเฟส 1', 'ขอบเขตงานเฟส 2', 'กำหนดส่งและงบประมาณ'],
  });
  const planning = mt('Sprint Planning', d(-3), '10:00', '11:30', '#8b5cf6', {
    repeat: 'weekly', link: 'https://zoom.us/j/1234567890', attendees: ['ทีมพัฒนา', 'PM', 'QA'],
    agenda: ['ทบทวน Sprint ที่แล้ว', 'เลือกงานเข้า Sprint', 'ประเมินเวลา'],
    minutes: { [d(-3)]: { notes: 'ตกลงรับงาน 12 ชิ้น เน้นหน้าชำระเงิน\nQA ขอเวลาทดสอบเพิ่ม 1 วัน', agendaDone: [0, 1, 2] } },
  });
  const oneOnOne = mt('1:1 กับหัวหน้า', d(1), '16:00', '16:30', '#0ea5e9', {
    repeat: 'weekly', location: 'ห้องหัวหน้าทีม', attendees: ['พี่เก่ง'],
    agenda: ['อัปเดตเป้าหมายเลื่อนตำแหน่ง', 'ขอคำแนะนำเรื่องการสอนงานน้อง'],
  });

  const events = [
    standup, client, planning, oneOnOne,
    ev('Deep Work: โปรเจกต์หลัก', d(0), '10:00', '12:00', '#8b5cf6'),
    ev('วิ่งที่สวนสาธารณะ', d(-14), '18:00', '19:00', '#10b981', { repeat: 'weekly', category: 'health' }),
    ev('เรียนคอร์สออนไลน์', d(1), '20:00', '21:30', '#0ea5e9', { category: 'study' }),
    mt('ทบทวนแผนประจำสัปดาห์', d(2), '16:00', '17:00', '#f59e0b', { attendees: ['ทีม'], agenda: ['งานที่เสร็จ', 'งานค้าง', 'แผนสัปดาห์หน้า'] }),
    ev('กินข้าวกับครอบครัว', d(4), '18:30', '20:30', '#ec4899', { category: 'personal' }),
    ev('Workshop ภาวะผู้นำ', d(8), '13:00', '16:00', '#6366f1'),
    ev('วันเกิดเพื่อน 🎂', d(12), '19:00', '22:00', '#ef4444', { category: 'personal' }),
  ];

  // งานที่ได้มาจากการประชุม (action items)
  tasks.push(
    task('ส่งสรุป API ให้ฝน', d(0), { meetingId: standup.id, meetingDate: d(-1), priority: 'high' }),
    task('ทำเอกสารทดสอบหน้าชำระเงิน', d(2), { meetingId: planning.id, meetingDate: d(-3) }),
    task('อัปเดตบอร์ดงาน Sprint', d(-2), { meetingId: planning.id, meetingDate: d(-3), done: true, doneAt: now - 2 * day }),
  );

  // สิ่งที่ได้เรียนรู้ (ตัวอย่าง)
  const ln = (date, text, cat, ago = 0) => ({ id: uid(), date, text, cat, source: '', createdAt: now - ago * 60000 });
  const learnings = [
    ln(d(0), 'ก่อนขอหมายค้นต้องมีพยานหลักฐานตามสมควร และระบุสถานที่ให้ชัดเจน', 'law', 90),
    ln(d(0), 'สรุปประชุมทันทีหลังจบ ช่วยให้ทีมไม่ลืมว่าใครรับงานอะไร', 'work', 60),
    ln(d(0), 'ฟังลูกน้องให้จบก่อนสั่งงาน เขาเสนอวิธีที่ดีกว่าที่คิดไว้', 'people', 30),
    ln(d(-1), 'ใช้ Google Sheets ตั้งเงื่อนไขสีช่วยดูงานที่ใกล้ครบกำหนดได้ทันที', 'tech'),
    ln(d(-1), 'นอนก่อนห้าทุ่มแล้วตื่นมาสมองโล่งกว่ามาก', 'health'),
    ln(d(-2), 'ตรวจสอบเส้นทางเงินบัญชีม้าต้องประสานธนาคารให้เร็วก่อนเงินถูกโอนต่อ', 'work'),
    ln(d(-3), 'อย่าตัดสินใจตอนโกรธ รอให้ใจเย็นก่อนแล้วค่อยคุย', 'life'),
    ln(d(-4), 'ลดหย่อนภาษีด้วยกองทุนได้ ต้องถือให้ครบตามเงื่อนไข', 'finance'),
  ];

  // แฟ้มผลงาน (ตัวอย่าง ไม่มีข้อมูลบุคคล)
  const ym = (y, m, dd) => `${t.getFullYear() + y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const pf = (o) => ({ id: uid(), role: '', org: '', result: '', lesson: '', figures: [], files: [], links: [], highlight: false, endDate: '', createdAt: now, ...o });
  const portfolio = [
    pf({ type: 'case', title: 'สืบสวนจับกุมเครือข่ายแก๊งคอลเซ็นเตอร์', date: d(-20), role: 'หัวหน้าชุด', highlight: true,
      result: 'วางแผนสืบสวนเส้นทางการเงิน ประสานธนาคาร 4 แห่ง และนำหมายจับเข้าตรวจค้นพร้อมกัน 3 จุด',
      figures: [{ label: 'จับกุมผู้ต้องหา', n: 12, unit: 'ราย' }, { label: 'ยึดทรัพย์', n: 3500000, unit: 'บาท' }],
      lesson: 'ประสานธนาคารให้เร็วตั้งแต่วันแรก ช่วยอายัดเงินได้ทัน' }),
    pf({ type: 'award', title: 'ได้รับหนังสือชมเชยจากผู้บังคับบัญชา', date: d(-8), org: 'กองบังคับการ', role: 'ผู้ได้รับรางวัล',
      result: 'จากผลการปฏิบัติงานคดีแก๊งคอลเซ็นเตอร์' }),
    pf({ type: 'training', title: 'หลักสูตรการสืบสวนอาชญากรรมทางเทคโนโลยี', date: ym(0, 3, 10), endDate: ym(0, 3, 21), org: 'สถาบันฝึกอบรม', role: 'ผู้เข้าอบรม',
      figures: [{ label: 'ชั่วโมงอบรม', n: 60, unit: 'ชั่วโมง' }], result: 'ผ่านการอบรมและได้รับวุฒิบัตร' }),
    pf({ type: 'speaker', title: 'วิทยากรบรรยายเรื่องภัยออนไลน์ให้ประชาชน', date: ym(0, 6, 5), role: 'วิทยากร', org: 'ชุมชนในพื้นที่',
      figures: [{ label: 'ผู้เข้าร่วม', n: 150, unit: 'คน' }] }),
    pf({ type: 'case', title: 'คลี่คลายคดีลักทรัพย์ต่อเนื่องในพื้นที่', date: ym(-1, 11, 14), role: 'ผู้สืบสวน',
      figures: [{ label: 'จับกุมผู้ต้องหา', n: 3, unit: 'ราย' }], result: 'ตรวจสอบกล้องวงจรปิดย้อนหลังและติดตามจับกุมได้ภายใน 5 วัน' }),
    pf({ type: 'career', title: 'ได้รับแต่งตั้งเป็นรองสารวัตร', date: ym(-1, 4, 1), highlight: true, result: 'เริ่มรับผิดชอบงานสืบสวน' }),
  ];

  // ทำเครื่องหมายว่าเป็นข้อมูลตัวอย่าง (ซิงก์หลายเครื่องจะไม่ได้ข้อมูลตัวอย่างซ้ำ)
  [tasks, events, goals, learnings, portfolio].forEach((list) => list.forEach((x) => (x.seed = true)));
  return normalize({ version: VERSION, tasks, events, goals, learnings, portfolio, days: {}, settings: defaultSettings() });
}

export { todayKey };
