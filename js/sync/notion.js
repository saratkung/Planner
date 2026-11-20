// ==========================================================
// notion.js — ส่งข้อมูลจาก Planner ไป Notion ทางเดียว (ผ่าน /api/notion บน Vercel)
//
// ส่ง: แฟ้มผลงาน · บันทึกการเรียนรู้ · บันทึกประชุม · งาน
// จำสิ่งที่ส่งแล้วไว้ในรายการ (item.notion = { id, h, b }) จึงส่งซ้ำเฉพาะที่แก้ไข และซิงก์รู้กันทุกเครื่อง
// ==========================================================
import { store } from '../core/store.js';
import { formatDate } from '../core/utils.js';
import { pfType, figureText } from '../core/portfolio.js';
import { learnCat } from '../core/learn.js';
import { actionItems } from '../core/selectors.js';
import { category, priority } from '../core/constants.js';

export const KINDS = [
  { id: 'portfolio', label: 'แฟ้มผลงาน', emoji: '🏆' },
  { id: 'learnings', label: 'บันทึกการเรียนรู้', emoji: '💡' },
  { id: 'meetings', label: 'บันทึกประชุม', emoji: '📝' },
  { id: 'tasks', label: 'งาน (To-do)', emoji: '✅' },
];
const CHUNK = 5;
const AUTO_DELAY = 30000;

export const defaultNotion = () => ({
  enabled: false, pageId: '', pageUrl: '', title: '', dbs: {}, auto: true, archivedAt: 0,
  kinds: { portfolio: true, learnings: true, meetings: true, tasks: true },
});
export const cfg = () => ({ ...defaultNotion(), ...(store.state.settings.notion || {}) });
const local = () => store.state.settings.notionLocal || {};
export const setNotion = (patch) => store.setSettings({ notion: { ...cfg(), ...patch } });
export const setNotionLocal = (patch) => store.setSettings({ notionLocal: { ...local(), ...patch } });
const code = () => local().code || store.state.settings.ai?.code || '';
export const notionReady = () => cfg().enabled && !!cfg().pageId && !!code();
export const notionPageUrl = (id) => `https://www.notion.so/${String(id || '').replace(/-/g, '')}`;

// ---------------- สถานะ ----------------
const status = { state: 'idle', done: 0, total: 0, error: '' };
const listeners = new Set();
const setStatus = (patch) => {
  Object.assign(status, patch);
  listeners.forEach((fn) => fn({ ...status }));
};
export const notionStatus = () => ({ ...status, lastSync: local().lastSync || null });
export const onNotionChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// ---------------- เรียกเซิร์ฟเวอร์ ----------------
export async function callNotion(payload, c = code()) {
  let res;
  try {
    res = await fetch('/api/notion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-planner-code': c || '' },
      body: JSON.stringify(payload),
    });
  } catch (_) {
    const e = new Error('ติดต่อเซิร์ฟเวอร์ไม่ได้ (ตรวจสอบอินเทอร์เน็ต)');
    e.offline = true;
    throw e;
  }
  const j = await res.json().catch(() => ({}));
  if (res.status === 404 && !j.message) throw new Error('เว็บนี้ยังไม่มีบริการ Notion (ใช้ได้บน plannercsd.vercel.app)');
  if (!res.ok) {
    const e = new Error(j.message || `Notion ขัดข้อง (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return j;
}

// ---------------- เตรียมข้อมูล ----------------
const hash = (o) => {
  const s = JSON.stringify(o);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
const tz = (() => {
  const m = -new Date().getTimezoneOffset();
  const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${m >= 0 ? '+' : '-'}${p(m / 60)}:${p(m % 60)}`;
})();
const at = (date, time) => (time ? `${date}T${time}:00${tz}` : date);

function collect(kind) {
  const st = store.state;
  const out = [];
  const push = (pid, props, body, sent) => out.push({ pid, data: { ...props, ...body }, h: hash(props), b: hash(body), sent: sent || {} });

  if (kind === 'portfolio') {
    (st.portfolio || []).filter((p) => !p.seed).forEach((p) => {
      const t = pfType(p.type);
      push(
        p.id,
        { title: p.title, typeLabel: t.label, emoji: t.emoji, date: p.date, endDate: p.endDate || '', role: p.role || '', org: p.org || '',
          figures: (p.figures || []).map(figureText).join(' · '), highlight: !!p.highlight },
        { result: p.result || '', lesson: p.lesson || '',
          evidence: [...(p.files || []).map((f) => ({ name: f.name, link: f.link })), ...(p.links || []).map((u) => ({ name: u, link: u }))] },
        p.notion,
      );
    });
  }
  if (kind === 'learnings') {
    (st.learnings || []).filter((l) => !l.seed).forEach((l) => {
      const c = learnCat(l.cat);
      push(l.id, { catLabel: c.label, emoji: c.emoji, date: l.date }, { text: l.text }, l.notion);
    });
  }
  if (kind === 'meetings') {
    st.events.filter((e) => e.isMeeting && !e.seed).forEach((ev) => {
      Object.entries(ev.minutes || {}).forEach(([date, m]) => {
        const actions = actionItems(ev.id, date);
        if (!m?.notes?.trim() && !(m?.agendaDone || []).length && !actions.length) return;
        push(
          `${ev.id}:${date}`,
          { title: ev.title, start: ev.allDay ? date : at(date, ev.start), end: ev.allDay ? '' : at(date, ev.end), location: ev.location || '',
            attendees: ev.attendees || [], link: ev.link || '' },
          { agenda: (ev.agenda || []).map((a, i) => ({ text: a, done: (m.agendaDone || []).includes(i) })), notes: m.notes || '',
            actions: actions.map((t) => ({ title: t.title, due: t.due ? formatDate(t.due, { short: true }) : '', done: !!t.done })) },
          m.notion,
        );
      });
    });
  }
  if (kind === 'tasks') {
    st.tasks.filter((t) => !t.seed).forEach((t) => {
      const goal = t.goalId && store.find('goals', t.goalId);
      const meet = t.meetingId && store.find('events', t.meetingId);
      push(
        t.id,
        { title: t.title, done: !!t.done, due: t.due ? at(t.due, t.time) : '', priority: priority(t.priority).label, category: category(t.category).label,
          related: goal ? `🎯 ${goal.title}` : meet ? `👥 ${meet.title}` : '' },
        { notes: t.notes || '' },
        t.notion,
      );
    });
  }
  return out;
}

/** จำนวนรายการที่ยังไม่ได้ส่ง / แก้หลังส่ง */
export function pendingCount() {
  const c = cfg();
  return KINDS.filter((k) => c.kinds[k.id]).reduce((a, k) => a + collect(k.id).filter((x) => !x.sent.id || x.sent.h !== x.h || x.sent.b !== x.b).length, 0);
}

/** บันทึกว่าส่งแล้ว (ไม่ทำให้ส่งซ้ำวนไปมา เพราะ hash ไม่รวมช่อง notion) */
function markSent(kind, results, byPid) {
  store.batch(
    (st) => {
      results.forEach((r) => {
        if (!r.ok) return;
        const x = byPid.get(r.pid);
        const sent = { id: r.id, h: x.h, b: x.b };
        if (kind === 'meetings') {
          const [evId, date] = r.pid.split(':');
          const ev = st.events.find((e) => e.id === evId);
          if (ev?.minutes?.[date]) ev.minutes[date].notion = sent;
        } else {
          const it = (st[kind] || []).find((i) => i.id === r.pid);
          if (it) it.notion = sent;
        }
      });
    },
    { source: 'notion' },
  );
}

// ---------------- ส่ง ----------------
let running = null;

export function syncNotion({ manual = false } = {}) {
  if (running) return running;
  running = (async () => {
    const c = cfg();
    if (!notionReady()) throw new Error('ยังไม่ได้เชื่อมต่อ Notion (ตั้งค่า → Notion)');
    const work = KINDS.filter((k) => c.kinds[k.id] && c.dbs[k.id]).map((k) => ({
      kind: k.id,
      items: collect(k.id).filter((x) => !x.sent.id || x.sent.h !== x.h || x.sent.b !== x.b),
    }));
    const total = work.reduce((a, w) => a + w.items.length, 0);
    const stats = { sent: 0, failed: 0, archived: 0, errors: [] };
    setStatus({ state: 'working', done: 0, total, error: '' });
    try {
      for (const w of work) {
        const byPid = new Map(w.items.map((x) => [x.pid, x]));
        for (let i = 0; i < w.items.length; i += CHUNK) {
          const part = w.items.slice(i, i + CHUNK);
          const r = await callNotion({
            action: 'upsert', kind: w.kind, db: c.dbs[w.kind],
            items: part.map((x) => ({ pid: x.pid, notionId: x.sent.id || null, data: x.data, bodyChanged: !x.sent.id || x.sent.b !== x.b })),
          });
          markSent(w.kind, r.results || [], byPid);
          (r.results || []).forEach((x) => (x.ok ? stats.sent++ : (stats.failed++, stats.errors.push(x.error))));
          setStatus({ done: stats.sent + stats.failed });
        }
      }
      // รายการที่ลบในแอปหลังเชื่อมต่อ → ย้ายหน้าใน Notion ไปถังขยะ
      const since = c.archivedAt || 0;
      const del = store.state.deleted || {};
      const now = Date.now();
      const gone = (col) => Object.entries(del[col] || {}).filter(([, t]) => t > since).map(([id]) => id);
      const jobs = [
        ['portfolio', gone('portfolio')],
        ['learnings', gone('learnings')],
        ['tasks', gone('tasks')],
        ['meetings', gone('events').map((id) => `${id}:*`)],
      ].filter(([k, pids]) => pids.length && c.kinds[k] && c.dbs[k]);
      for (const [k, pids] of jobs) {
        for (let i = 0; i < pids.length; i += 20) {
          const r = await callNotion({ action: 'archive', db: c.dbs[k], pids: pids.slice(i, i + 20) });
          stats.archived += r.archived || 0;
        }
      }
      if (jobs.length || !since) setNotion({ archivedAt: now });
      setNotionLocal({ lastSync: now, lastError: stats.failed ? stats.errors[0] : '' });
      setStatus({ state: stats.failed ? 'error' : 'ok', error: stats.failed ? `ส่งไม่สำเร็จ ${stats.failed} รายการ: ${stats.errors[0]}` : '' });
      return stats;
    } catch (e) {
      if (e.status === 410) setNotion({ dbs: {} });
      setStatus({ state: 'error', error: e.message });
      if (!manual && e.offline) return stats;
      throw e;
    }
  })().finally(() => (running = null));
  return running;
}

/** เชื่อมต่อกับหน้า Notion: สร้างตาราง 4 ตาราง (หรือใช้ของเดิม) */
export async function connectNotion(pageUrl, accessCode) {
  if (accessCode != null) setNotionLocal({ code: accessCode.trim() });
  const c = cfg();
  const r = await callNotion({ action: 'setup', page: pageUrl, dbs: c.pageId && pageUrl.replace(/-/g, '').includes(c.pageId.replace(/-/g, '')) ? c.dbs : {} });
  setNotion({ enabled: true, pageId: r.pageId, pageUrl: r.url || pageUrl, title: r.title, dbs: r.dbs, archivedAt: c.archivedAt || Date.now() });
  return r;
}

export function disconnectNotion() {
  setNotion({ enabled: false });
  setStatus({ state: 'idle', error: '' });
}

// ---------------- ส่งอัตโนมัติ ----------------
let timer = null;
const canAuto = () => notionReady() && cfg().auto && navigator.onLine !== false && status.state !== 'blocked';

function scheduleAuto(delay = AUTO_DELAY) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!canAuto() || document.visibilityState === 'hidden' && delay > 5000) return;
    syncNotion().catch((e) => {
      // รหัสผิด / ยังไม่ตั้งค่าเซิร์ฟเวอร์: หยุดส่งอัตโนมัติจนกว่าจะแก้ในตั้งค่า
      if ([401, 501].includes(e.status)) setStatus({ state: 'blocked', error: e.message });
    });
  }, delay);
}

export function setupNotion() {
  store.subscribe((c) => {
    if (c.source === 'notion') return;
    if (c.type === 'settings') {
      if (status.state === 'blocked') setStatus({ state: 'idle', error: '' });
      return;
    }
    if (canAuto()) scheduleAuto();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer && canAuto()) scheduleAuto(1000); // ออกจากแอป: ส่งที่ค้างก่อน
  });
  if (canAuto()) scheduleAuto(8000);
}
