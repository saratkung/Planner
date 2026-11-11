// ==========================================================
// meetings.js — การประชุม: ประชุมถัดไป, รายการประชุม, บันทึก, สิ่งที่ต้องทำต่อ
// ==========================================================
import { store } from '../core/store.js';
import {
  esc, todayKey, toKey, addDays, fromKey, formatDate, relativeDay, timeToMin, durationLabel,
  enterTracker, countUp, $,
} from '../core/utils.js';
import { meetingsBetween, meetingStatus, minutesUntil, minutesOf, actionItems } from '../core/selectors.js';
import { toggleTask } from '../core/actions.js';
import { icon } from '../ui/icons.js';
import { checkbox, emptyState, segmented, bindSegmented, moveSegIndicator } from '../ui/widgets.js';
import { openEventForm } from '../forms/eventForm.js';
import { openMeeting, statusLabel, linkLabel, initial, hue } from '../forms/meetingRoom.js';

const RANGES = [
  { id: 'today', label: 'วันนี้' },
  { id: 'week', label: '7 วันข้างหน้า' },
  { id: 'past', label: 'ที่ผ่านมา' },
];

function rangeKeys(range) {
  const t = new Date();
  if (range === 'today') return [todayKey(), todayKey()];
  if (range === 'week') return [todayKey(), toKey(addDays(t, 6))];
  return [toKey(addDays(t, -14)), todayKey()];
}

export default {
  id: 'meetings',
  label: 'ประชุม',
  icon: 'users',
  subtitle: () => {
    const n = meetingsBetween(todayKey(), todayKey()).length;
    return n ? `วันนี้มีประชุม ${n} รายการ` : 'วันนี้ไม่มีประชุม';
  },

  mount(root) {
    const track = enterTracker();
    let range = 'today';
    let first = true;
    let clock;

    root.innerHTML = `
      <div class="meet-view">
        <section id="meet-next"></section>
        <section class="goal-stats" id="meet-stats"></section>
        <div class="tasks-toolbar">
          <div id="meet-range"></div>
          <button class="btn btn-primary" id="meet-new">${icon('plus')}นัดประชุม</button>
        </div>
        <section id="meet-list"></section>
        <section class="card" id="meet-actions"></section>
      </div>`;

    $('#meet-range', root).innerHTML = segmented(RANGES, range, { name: 'mrange' });
    bindSegmented($('[data-seg="mrange"]', root), (v) => {
      range = v;
      track.reset();
      renderList();
    });

    const renderNext = () => {
      const upcoming = meetingsBetween(todayKey(), toKey(addDays(new Date(), 14))).filter(
        (m) => meetingStatus(m) !== 'past',
      );
      const m = upcoming[0];
      const host = $('#meet-next', root);
      if (!m) {
        host.innerHTML = `<div class="card next-meet empty-next">${emptyState('🗓️', 'ยังไม่มีประชุมที่กำลังจะมาถึง', 'กด "นัดประชุม" เพื่อเพิ่มการประชุมครั้งแรก', true)}</div>`;
        return;
      }
      const live = meetingStatus(m) === 'live';
      const mins = minutesUntil(m);
      const len = timeToMin(m.end) - timeToMin(m.start);
      const elapsed = live ? Math.min(100, Math.round(((-mins) / len) * 100)) : 0;
      const countdown = live
        ? `เหลืออีก ${durationLabel(len + mins)}`
        : mins < 60
        ? `เริ่มในอีก ${mins} นาที`
        : mins < 24 * 60
        ? `เริ่มในอีก ${durationLabel(mins)}`
        : `${relativeDay(m.occurrence)} เวลา ${m.start}`;
      host.innerHTML = `
        <div class="next-meet${live ? ' is-live' : ''}" style="--c:${m.color}">
          <div class="nm-main">
            <p class="nm-eyebrow">${live ? '<i class="live-dot"></i>กำลังประชุมอยู่ตอนนี้' : 'ประชุมถัดไป'}</p>
            <h2>${esc(m.title)}</h2>
            <p class="nm-when">${formatDate(m.occurrence, { weekday: true, year: false })} · ${m.start}–${m.end}</p>
            <div class="nm-meta">
              ${m.location ? `<span>${icon('pin')}${esc(m.location)}</span>` : ''}
              ${m.link ? `<span>${icon('video')}${linkLabel(m.link)}</span>` : ''}
              ${m.agenda.length ? `<span>${icon('list')}${m.agenda.length} วาระ</span>` : ''}
            </div>
            ${m.attendees.length ? `<div class="avatars">${m.attendees.slice(0, 5).map((a) => `<i style="--h:${hue(a)}" title="${esc(a)}">${esc(initial(a))}</i>`).join('')}${m.attendees.length > 5 ? `<i class="more">+${m.attendees.length - 5}</i>` : ''}<span>${m.attendees.length} คน</span></div>` : ''}
          </div>
          <div class="nm-side">
            <div class="nm-count">${countdown}</div>
            ${live ? `<div class="nm-progress"><span style="width:${elapsed}%"></span></div>` : ''}
            <div class="nm-actions">
              ${m.link ? `<a class="btn btn-light" href="${esc(m.link)}" target="_blank" rel="noopener">${icon('video')}เข้าร่วม</a>` : ''}
              <button class="btn btn-glass" data-open="${m.id}" data-date="${m.occurrence}">${icon('note')}${live ? 'จดบันทึก' : 'เตรียมประชุม'}</button>
            </div>
          </div>
        </div>`;
    };

    const renderStats = () => {
      const today = todayKey();
      const week = meetingsBetween(today, toKey(addDays(new Date(), 6)));
      const todays = week.filter((m) => m.occurrence === today);
      const mins = week.reduce((a, m) => a + Math.max(0, timeToMin(m.end) - timeToMin(m.start)), 0);
      const open = store.state.tasks.filter((t) => t.meetingId && !t.done).length;
      $('#meet-stats', root).innerHTML = `
        <div class="card mini-stat"><span class="ms-emoji">📅</span><div><b data-count="${todays.length}">${todays.length}</b><p class="muted">ประชุมวันนี้</p></div></div>
        <div class="card mini-stat"><span class="ms-emoji">👥</span><div><b data-count="${week.length}">${week.length}</b><p class="muted">ประชุมใน 7 วันข้างหน้า</p></div></div>
        <div class="card mini-stat"><span class="ms-emoji">⏱️</span><div><b>${mins ? durationLabel(mins) : '0 ชม.'}</b><p class="muted">เวลาประชุม 7 วันข้างหน้า</p></div></div>
        <div class="card mini-stat"><span class="ms-emoji">✅</span><div><b data-count="${open}">${open}</b><p class="muted">งานค้างจากการประชุม</p></div></div>`;
      if (first) $('#meet-stats', root).querySelectorAll('[data-count]').forEach((n) => countUp(n, Number(n.dataset.count)));
    };

    const renderList = () => {
      track.frame();
      const [a, b] = rangeKeys(range);
      let list = meetingsBetween(a, b);
      if (range === 'past') list = list.filter((m) => meetingStatus(m) === 'past').reverse();
      const host = $('#meet-list', root);
      if (!list.length) {
        const msg = {
          today: ['☕', 'วันนี้ไม่มีประชุม', 'ใช้เวลาโฟกัสกับงานสำคัญได้เต็มที่'],
          week: ['🌤️', 'ไม่มีประชุมใน 7 วันข้างหน้า', ''],
          past: ['📭', 'ยังไม่มีประชุมที่ผ่านมา', ''],
        }[range];
        host.innerHTML = `<div class="card">${emptyState(...msg, true)}</div>`;
        return;
      }
      const days = new Map();
      list.forEach((m) => {
        if (!days.has(m.occurrence)) days.set(m.occurrence, []);
        days.get(m.occurrence).push(m);
      });
      host.innerHTML = [...days.entries()]
        .map(
          ([k, ms]) => `
          <div class="task-group">
            <h4 class="section-title">${relativeDay(k) === formatDate(k, { short: true, year: false }) ? '' : relativeDay(k) + ' · '}${formatDate(k, { weekday: true, year: false })} <span class="count">${ms.length}</span></h4>
            <ul class="meet-list">${ms.map((m) => meetRow(m, track)).join('')}</ul>
          </div>`,
        )
        .join('');
    };

    const renderActions = () => {
      const open = store.state.tasks
        .filter((t) => t.meetingId && !t.done)
        .sort((x, y) => (x.due || '9999') < (y.due || '9999') ? -1 : 1);
      $('#meet-actions', root).innerHTML = `
        <div class="card-head"><h3>${icon('checkSquare')}สิ่งที่ต้องทำต่อจากการประชุม</h3></div>
        ${open.length
          ? `<ul class="mini-tasks">${open
              .map((t) => {
                const ev = store.find('events', t.meetingId);
                const over = t.due && t.due < todayKey();
                return `<li class="mini-task" data-task="${t.id}">
                  ${checkbox(false, { round: true, label: t.title })}
                  <span class="mini-title">${esc(t.title)}</span>
                  ${ev ? `<span class="tag from-meet" data-open="${ev.id}" data-date="${t.meetingDate || ''}">${icon('users')}${esc(ev.title)}</span>` : ''}
                  ${t.due ? `<span class="tag ${over ? 'bad' : ''}">${relativeDay(t.due)}</span>` : ''}
                </li>`;
              })
              .join('')}</ul>`
          : emptyState('🎉', 'ไม่มีงานค้างจากการประชุม', 'เพิ่มสิ่งที่ต้องทำได้ในหน้าต่างของแต่ละการประชุม', true)}`;
    };

    const renderAll = () => {
      renderNext();
      renderStats();
      renderList();
      renderActions();
      first = false;
    };

    $('#meet-new', root).addEventListener('click', () => openEventForm(null, { isMeeting: true }));

    root.addEventListener('click', (e) => {
      if (e.target.closest('a[href]')) return; // ปุ่มเข้าร่วมเปิดลิงก์ตามปกติ
      const check = e.target.closest('[data-check]');
      if (check) return toggleTask(check.closest('[data-task]').dataset.task, check);
      const op = e.target.closest('[data-open]');
      if (op) return openMeeting(op.dataset.open, op.dataset.date || todayKey());
    });
    root.addEventListener('keydown', (e) => {
      const op = e.target.closest('.meet-row[data-open]');
      if (op && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openMeeting(op.dataset.open, op.dataset.date);
      }
    });

    renderAll();
    clock = setInterval(() => {
      renderNext();
    }, 30000);

    return {
      update: renderAll,
      onResize: () => moveSegIndicator($('[data-seg="mrange"]', root), true),
      unmount: () => clearInterval(clock),
    };
  },
};

function meetRow(m, track) {
  const { cls, vars } = track.attrs(m.occurrence + m.id);
  const st = meetingStatus(m);
  const min = minutesOf(m, m.occurrence);
  const items = actionItems(m.id, m.occurrence);
  const doneItems = items.filter((t) => t.done).length;
  const hasNotes = !!min.notes?.trim();
  return `
    <li class="meet-row ${st}${cls}" style="${vars}--c:${m.color}" data-open="${m.id}" data-date="${m.occurrence}" tabindex="0">
      <div class="mt-time"><b>${m.start}</b><span>${m.end}</span></div>
      <div class="mt-main">
        <p class="mt-title">${esc(m.title)}${m.repeat !== 'none' ? ` <span class="muted mt-rep" title="ประชุมประจำ">${icon('repeat')}</span>` : ''}</p>
        <div class="task-meta">
          ${statusLabel(m)}
          ${m.location ? `<span class="tag">${icon('pin')}${esc(m.location)}</span>` : ''}
          ${m.link ? `<span class="tag">${icon('video')}${linkLabel(m.link)}</span>` : ''}
          ${m.attendees.length ? `<span class="tag">${icon('users')}${m.attendees.length} คน</span>` : ''}
          ${hasNotes ? `<span class="tag good">${icon('note')}มีบันทึก</span>` : st === 'past' ? `<span class="tag warn">${icon('note')}ยังไม่ได้จดบันทึก</span>` : ''}
          ${items.length ? `<span class="tag ${doneItems === items.length ? 'good' : 'accent'}">${icon('checkSquare')}${doneItems}/${items.length} งาน</span>` : ''}
        </div>
      </div>
      ${m.link && st !== 'past' ? `<a class="btn btn-outline btn-sm mt-join" href="${esc(m.link)}" target="_blank" rel="noopener">${icon('video')}<span>เข้าร่วม</span></a>` : ''}
      ${icon('right', 'mt-chev')}
    </li>`;
}
