// ==========================================================
// store.js — app state, persistence (localStorage), pub/sub
// ==========================================================
import { uid, todayKey, toKey, addDays } from './utils.js';

const KEY = 'planner.v1';
const VERSION = 2;
const COLLECTIONS = ['tasks', 'events', 'goals'];

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
const defaultNotify = () => ({ enabled: false, lead: 10, events: true, tasks: true, morning: true, gcal: true });
const defaultSettings = () => ({
  name: '', theme: 'auto', weekStart: 0, workStart: '08:30', workEnd: '17:30',
  gcal: defaultGcal(), backup: defaultBackup(), lock: defaultLock(), notify: defaultNotify(),
});
// ค่าที่เป็นของเครื่องนี้ ไม่ทับตอนนำเข้า/กู้คืนข้อมูล
const DEVICE_KEYS = ['gcal', 'backup', 'lock', 'notify'];

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn('โหลดข้อมูลไม่สำเร็จ ใช้ข้อมูลตัวอย่างแทน', e);
  }
  return seed();
}

function normalize(data) {
  const s = {
    version: VERSION,
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    events: Array.isArray(data.events) ? data.events : [],
    goals: Array.isArray(data.goals) ? data.goals : [],
    days: data.days && typeof data.days === 'object' ? data.days : {},
    settings: { ...defaultSettings(), ...(data.settings || {}) },
  };
  s.settings.gcal = { ...defaultGcal(), ...(s.settings.gcal || {}) };
  s.settings.backup = { ...defaultBackup(), ...(s.settings.backup || {}) };
  s.settings.lock = { ...defaultLock(), ...(s.settings.lock || {}) };
  s.settings.notify = { ...defaultNotify(), ...(s.settings.notify || {}) };
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

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('บันทึกข้อมูลไม่สำเร็จ', e);
  }
}

function emit(change) {
  save();
  listeners.forEach((fn) => fn(change));
}

export const store = {
  get state() {
    return state;
  },

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
    return JSON.stringify({ ...state, settings, exportedAt: new Date().toISOString() }, null, 2);
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
    emit({ type: 'reset' });
  },

  reset({ demo = true } = {}) {
    const settings = state.settings;
    state = demo ? seed() : normalize({});
    state.settings = settings;
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

  return { version: VERSION, tasks, events, goals, days: {}, settings: defaultSettings() };
}

export { todayKey };
