// ==========================================================
// search.js — ค้นหาทั้งแอป: ประชุม นัดหมาย งาน เป้าหมาย และบันทึกประชุมย้อนหลัง
// ==========================================================
import { store } from '../core/store.js';
import { esc, todayKey, toKey, addDays, formatDate, relativeDay, $, $$ } from '../core/utils.js';
import { normalize } from '../core/parse.js';
import { occursOn } from '../core/selectors.js';
import { REPEATS, category } from '../core/constants.js';
import { openModal } from '../ui/modal.js';
import { icon } from '../ui/icons.js';
import { openMeeting } from '../forms/meetingRoom.js';
import { openEventForm } from '../forms/eventForm.js';
import { openTaskForm } from '../forms/taskForm.js';
import { openGoalForm } from '../forms/goalForm.js';

const RECENT_KEY = 'planner.recentSearches';
const GROUPS = [
  { id: 'meeting', label: 'ประชุม', emoji: '👥' },
  { id: 'note', label: 'บันทึกประชุม', emoji: '📝' },
  { id: 'event', label: 'นัดหมาย', emoji: '📅' },
  { id: 'task', label: 'งาน', emoji: '✅' },
  { id: 'goal', label: 'เป้าหมาย', emoji: '🎯' },
];
const PER_GROUP = 6;

/** ทำให้ค้นง่าย: ตัวเล็ก เลขไทย→อารบิก ช่องว่างเดียว */
const norm = (s) => normalize(String(s || '')).toLowerCase();
const terms = (q) => norm(q).split(/\s+/).filter(Boolean);

function recent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch (_) {
    return [];
  }
}
function remember(q) {
  const list = [q, ...recent().filter((x) => x !== q)].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch (_) {}
}

/** ครั้งถัดไปของนัดที่ทำซ้ำ (ใน 120 วัน) หรือครั้งล่าสุด */
function nextOccurrence(ev) {
  if (ev.repeat === 'none') return ev.date;
  const today = new Date();
  for (let i = 0; i < 120; i++) {
    const k = toKey(addDays(today, i));
    if (occursOn(ev, k)) return k;
  }
  return ev.date;
}

/** ส่วนของข้อความรอบคำที่เจอ พร้อมไฮไลต์ */
function snippet(text, ts, len = 70) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const low = norm(raw);
  let at = -1;
  for (const t of ts) {
    const i = low.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  let start = 0;
  if (at > len / 2) start = at - Math.floor(len / 2);
  let part = raw.slice(start, start + len);
  const prefix = start > 0 ? '…' : '';
  const suffix = start + len < raw.length ? '…' : '';
  return prefix + highlight(part, ts) + suffix;
}

function highlight(text, ts) {
  const raw = String(text || '');
  if (!ts.length) return esc(raw);
  const low = norm(raw);
  // หาช่วงที่ตรง (normalize ไม่เปลี่ยนความยาว ยกเว้นช่องว่างซ้ำ ใช้ตำแหน่งจากข้อความต้นฉบับแบบตัวเล็ก)
  const lower = raw.toLowerCase().replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)));
  const marks = [];
  ts.forEach((t) => {
    let i = lower.indexOf(t);
    while (i >= 0 && marks.length < 20) {
      marks.push([i, i + t.length]);
      i = lower.indexOf(t, i + t.length);
    }
  });
  if (!marks.length || low.length === 0) return esc(raw);
  marks.sort((a, b) => a[0] - b[0]);
  let out = '';
  let pos = 0;
  marks.forEach(([s, e]) => {
    if (s < pos) return;
    out += esc(raw.slice(pos, s)) + '<mark>' + esc(raw.slice(s, e)) + '</mark>';
    pos = e;
  });
  return out + esc(raw.slice(pos));
}

/**
 * ค้นหา: ทุกคำต้องเจอ (ในช่องใดก็ได้ของรายการนั้น)
 * คะแนน: เจอในชื่อ > ช่องอื่น, ใกล้วันนี้มากกว่าได้ก่อน
 */
export function searchAll(q, { includeDone = true } = {}) {
  const ts = terms(q);
  if (!ts.length) return [];
  const today = todayKey();
  const results = [];
  const matchAll = (fields) => ts.every((t) => fields.some((f) => norm(f).includes(t)));
  const titleScore = (title) => ts.reduce((a, t) => a + (norm(title).includes(t) ? 10 : 0), 0) + (norm(title).startsWith(ts[0]) ? 5 : 0);
  const dateScore = (k) => {
    if (!k) return 0;
    const d = Math.abs((new Date(k) - new Date(today)) / 86400000);
    return Math.max(0, 6 - Math.log2(1 + d));
  };

  store.state.events.forEach((ev) => {
    const fields = [ev.title, ev.location, ev.notes, (ev.attendees || []).join(' '), (ev.agenda || []).join(' ')];
    const date = nextOccurrence(ev);
    if (matchAll(fields)) {
      const where = [ev.location, (ev.attendees || []).join(', '), (ev.agenda || []).join(' · '), ev.notes].find((f) => f && ts.some((t) => norm(f).includes(t)));
      results.push({
        group: ev.isMeeting ? 'meeting' : 'event',
        id: ev.id,
        date,
        title: ev.title,
        sub: `${ev.allDay ? 'ทั้งวัน' : `${ev.start}–${ev.end}`} · ${ev.repeat !== 'none' ? (REPEATS.find((r) => r.id === ev.repeat)?.label || 'ทำซ้ำ') : relativeDay(date)}`,
        snip: where ? snippet(where, ts) : '',
        score: titleScore(ev.title) + dateScore(date),
      });
    }
    // บันทึกประชุมแต่ละครั้ง
    Object.entries(ev.minutes || {}).forEach(([k, m]) => {
      if (!m?.notes?.trim()) return;
      if (!matchAll([m.notes, ev.title])) return;
      if (!ts.some((t) => norm(m.notes).includes(t))) return; // ต้องเจอในบันทึกจริง ๆ
      results.push({
        group: 'note',
        id: ev.id,
        date: k,
        title: ev.title,
        sub: formatDate(k, { weekday: true, short: true }),
        snip: snippet(m.notes, ts, 90),
        score: 8 + dateScore(k),
      });
    });
  });

  store.state.tasks.forEach((t) => {
    if (!includeDone && t.done) return;
    const goal = t.goalId && store.find('goals', t.goalId);
    const meeting = t.meetingId && store.find('events', t.meetingId);
    if (!matchAll([t.title, t.notes, goal?.title, meeting?.title, category(t.category).label])) return;
    results.push({
      group: 'task',
      id: t.id,
      date: t.due,
      done: t.done,
      title: t.title,
      sub: [t.done ? 'เสร็จแล้ว' : t.due ? relativeDay(t.due) : 'ไม่มีกำหนด', t.time, meeting ? `จากประชุม ${meeting.title}` : goal ? `🎯 ${goal.title}` : ''].filter(Boolean).join(' · '),
      snip: t.notes && ts.some((x) => norm(t.notes).includes(x)) ? snippet(t.notes, ts) : '',
      score: titleScore(t.title) + dateScore(t.due) - (t.done ? 4 : 0),
    });
  });

  store.state.goals.forEach((g) => {
    const ms = (g.milestones || []).map((m) => m.title).join(' · ');
    if (!matchAll([g.title, g.description, ms])) return;
    const where = [g.description, ms].find((f) => f && ts.some((t) => norm(f).includes(t)));
    results.push({
      group: 'goal',
      id: g.id,
      date: g.deadline,
      title: g.title,
      sub: g.deadline ? `กำหนด ${formatDate(g.deadline, { short: true })}` : category(g.category).label,
      snip: where ? snippet(where, ts) : '',
      score: titleScore(g.title),
    });
  });

  return results.sort((a, b) => b.score - a.score);
}

function openResult(r, close, navigate) {
  close();
  setTimeout(() => {
    if (r.group === 'meeting' || r.group === 'note') return openMeeting(r.id, r.date || todayKey());
    if (r.group === 'event') return openEventForm(store.find('events', r.id));
    if (r.group === 'task') return openTaskForm(store.find('tasks', r.id));
    if (r.group === 'goal') {
      navigate?.('goals');
      return openGoalForm(store.find('goals', r.id));
    }
  }, 220);
}

/** เปิดหน้าค้นหา */
export function openSearch({ navigate, query = '' } = {}) {
  let filter = 'all';
  let results = [];
  let active = 0;
  let timer;

  openModal({
    title: '🔎 ค้นหา',
    size: 640,
    body: `
      <div class="srch">
        <div class="srch-box">
          ${icon('search')}
          <input class="input" id="srch-q" type="search" placeholder="ค้นหาประชุม งาน บันทึก ชื่อคน สถานที่…" value="${esc(query)}" autocomplete="off" enterkeyhint="search" aria-label="คำค้นหา" />
        </div>
        <div class="chips srch-filters" role="tablist">
          ${[{ id: 'all', label: 'ทั้งหมด', emoji: '' }, ...GROUPS].map((g) => `<button type="button" class="chip${g.id === 'all' ? ' active' : ''}" data-filter="${g.id}">${g.emoji ? g.emoji + ' ' : ''}${g.label}<span class="srch-n" data-n="${g.id}"></span></button>`).join('')}
        </div>
        <div id="srch-results" class="srch-results" role="listbox" aria-label="ผลการค้นหา"></div>
      </div>`,
    onMount(root, close) {
      root.classList.add('srch-overlay');
      const input = $('#srch-q', root);
      const host = $('#srch-results', root);

      const visible = () => (filter === 'all' ? results : results.filter((r) => r.group === filter));

      const renderEmpty = () => {
        const rec = recent();
        host.innerHTML = `
          <div class="srch-hint">
            ${rec.length ? `<p class="srch-label">ค้นหาล่าสุด</p><div class="chips">${rec.map((q) => `<button type="button" class="chip" data-recent="${esc(q)}">${icon('clock')}${esc(q)}</button>`).join('')}</div>` : ''}
            <p class="srch-label">ลองค้นหา</p>
            <ul class="srch-tips">
              <li>ชื่อคน เช่น <b>ผกก.</b> หรือ <b>พี่เก่ง</b> เพื่อดูประชุมที่คนนั้นเข้าร่วม</li>
              <li>คำในบันทึก เช่น <b>อนุมัติ</b> เพื่อหาว่าตกลงอะไรไว้ประชุมไหน</li>
              <li>หลายคำพร้อมกัน เช่น <b>ประชุม คดี</b> จะได้เฉพาะที่มีทั้งสองคำ</li>
            </ul>
          </div>`;
        $$('[data-n]', root).forEach((n) => (n.textContent = ''));
      };

      const render = () => {
        const q = input.value.trim();
        if (!q) return renderEmpty();
        $$('[data-n]', root).forEach((n) => {
          const c = n.dataset.n === 'all' ? results.length : results.filter((r) => r.group === n.dataset.n).length;
          n.textContent = c ? ` ${c}` : '';
        });
        const list = visible();
        if (!list.length) {
          host.innerHTML = `<div class="empty sm"><div class="empty-emoji">🔍</div><h4>ไม่พบ “${esc(q)}”</h4><p>ลองคำที่สั้นลง หรือสะกดแบบอื่น</p></div>`;
          return;
        }
        let i = 0;
        const groups = filter === 'all' ? GROUPS : GROUPS.filter((g) => g.id === filter);
        host.innerHTML = groups
          .map((g) => {
            const items = list.filter((r) => r.group === g.id);
            if (!items.length) return '';
            const shown = filter === 'all' ? items.slice(0, PER_GROUP) : items;
            return `<section class="srch-group">
              <h4 class="section-title">${g.emoji} ${g.label} <span class="count">${items.length}</span>
                ${filter === 'all' && items.length > PER_GROUP ? `<button type="button" class="link-btn srch-more" data-more="${g.id}">ดูทั้งหมด</button>` : ''}</h4>
              ${shown
                .map((r) => {
                  const idx = i++;
                  return `<button type="button" role="option" class="srch-item${idx === active ? ' active' : ''}${r.done ? ' done' : ''}" data-idx="${idx}" style="--i:${Math.min(idx, 10)}">
                    <span class="srch-title">${highlight(r.title, terms(q))}</span>
                    <span class="srch-sub">${esc(r.sub)}</span>
                    ${r.snip ? `<span class="srch-snip">${r.snip}</span>` : ''}
                  </button>`;
                })
                .join('')}
            </section>`;
          })
          .join('');
        host._order = groups.flatMap((g) => {
          const items = list.filter((r) => r.group === g.id);
          return filter === 'all' ? items.slice(0, PER_GROUP) : items;
        });
      };

      const run = () => {
        results = searchAll(input.value);
        active = 0;
        render();
      };

      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(run, 80);
      });
      input.addEventListener('keydown', (e) => {
        const order = host._order || [];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (!order.length) return;
          e.preventDefault();
          active = (active + (e.key === 'ArrowDown' ? 1 : -1) + order.length) % order.length;
          $$('.srch-item', host).forEach((b) => b.classList.toggle('active', Number(b.dataset.idx) === active));
          $(`.srch-item[data-idx="${active}"]`, host)?.scrollIntoView({ block: 'nearest' });
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const r = order[active];
          if (r) {
            remember(input.value.trim());
            openResult(r, close, navigate);
          }
        }
      });

      root.addEventListener('click', (e) => {
        const f = e.target.closest('[data-filter]');
        if (f) {
          filter = f.dataset.filter;
          $$('[data-filter]', root).forEach((b) => b.classList.toggle('active', b === f));
          active = 0;
          return render();
        }
        const more = e.target.closest('[data-more]');
        if (more) {
          $(`[data-filter="${more.dataset.more}"]`, root).click();
          return;
        }
        const rec = e.target.closest('[data-recent]');
        if (rec) {
          input.value = rec.dataset.recent;
          run();
          input.focus();
          return;
        }
        const item = e.target.closest('.srch-item');
        if (item) {
          const r = (host._order || [])[Number(item.dataset.idx)];
          if (r) {
            remember(input.value.trim());
            openResult(r, close, navigate);
          }
        }
      });

      if (query) run();
      else renderEmpty();
      setTimeout(() => input.focus(), 60);
    },
  });
}
