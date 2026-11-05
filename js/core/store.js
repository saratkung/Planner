// ==========================================================
// store.js — app state, persistence (localStorage), pub/sub
// ==========================================================
import { uid, todayKey, toKey, addDays } from './utils.js';

const KEY = 'planner.v1';
const VERSION = 1;
const COLLECTIONS = ['tasks', 'events', 'goals'];

const defaultSettings = () => ({ name: '', theme: 'auto', weekStart: 0 });

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
    settings: { ...defaultSettings(), ...(data.settings || {}) },
  };
  s.goals.forEach((g) => (g.milestones = Array.isArray(g.milestones) ? g.milestones : []));
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
    if (col === 'goals') {
      state.tasks.forEach((t) => {
        if (t.goalId === id) {
          t.goalId = null;
          unlinked.push(t.id);
        }
      });
    }
    emit({ type: 'remove', col, id });
    return { col, idx, item, unlinked };
  },

  restore(snap) {
    if (!snap) return;
    state[snap.col].splice(snap.idx, 0, snap.item);
    snap.unlinked.forEach((tid) => {
      const t = this.find('tasks', tid);
      if (t) t.goalId = snap.item.id;
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

  setSettings(patch) {
    Object.assign(state.settings, patch);
    emit({ type: 'settings' });
  },

  exportJSON() {
    return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
  },

  importJSON(text) {
    const data = JSON.parse(text);
    if (!COLLECTIONS.some((c) => Array.isArray(data[c]))) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
    state = normalize(data);
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
    goalId: null, done: false, doneAt: null, createdAt: now, ...o,
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
    id: uid(), title, date, start, end, color, category: 'work', repeat: 'none', notes: '', createdAt: now, ...o,
  });

  const events = [
    ev('ประชุมทีมประจำวัน', d(-14), '09:00', '09:30', '#6366f1', { repeat: 'weekdays' }),
    ev('Deep Work: โปรเจกต์หลัก', d(0), '10:00', '12:00', '#8b5cf6'),
    ev('คุยงานกับลูกค้า', d(0), '14:00', '15:00', '#ec4899'),
    ev('วิ่งที่สวนสาธารณะ', d(-14), '18:00', '19:00', '#10b981', { repeat: 'weekly', category: 'health' }),
    ev('เรียนคอร์สออนไลน์', d(1), '20:00', '21:30', '#0ea5e9', { category: 'study' }),
    ev('ทบทวนแผนประจำสัปดาห์', d(2), '16:00', '17:00', '#f59e0b'),
    ev('กินข้าวกับครอบครัว', d(4), '18:30', '20:30', '#ec4899', { category: 'personal' }),
    ev('Workshop ภาวะผู้นำ', d(8), '13:00', '16:00', '#6366f1'),
    ev('วันเกิดเพื่อน 🎂', d(12), '19:00', '22:00', '#ef4444', { category: 'personal' }),
  ];

  return { version: VERSION, tasks, events, goals, settings: defaultSettings() };
}

export { todayKey };
