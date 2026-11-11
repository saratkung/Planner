// ==========================================================
// calendar.js — month calendar + day agenda panel
// ==========================================================
import { store } from '../core/store.js';
import {
  esc, toKey, todayKey, addDays, addMonths, startOfWeek, formatDate, thaiYear,
  THAI_MONTHS, THAI_DAYS_SHORT, enterTracker, ripple, $,
} from '../core/utils.js';
import { category, priority } from '../core/constants.js';
import { eventsOn, tasksDue, sortTasks } from '../core/selectors.js';
import { toggleTask } from '../core/actions.js';
import { icon } from '../ui/icons.js';
import { checkbox, emptyState } from '../ui/widgets.js';
import { openTaskForm } from '../forms/taskForm.js';
import { openEventForm } from '../forms/eventForm.js';
import { openMeeting } from '../forms/meetingRoom.js';

export default {
  id: 'calendar',
  label: 'ปฏิทิน',
  icon: 'calendar',
  subtitle: () => 'ดูภาพรวมทั้งเดือน คลิกที่วันเพื่อดูรายละเอียด',

  mount(root) {
    const track = enterTracker();
    let cursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let selected = todayKey();
    let dir = '';

    root.innerHTML = `
      <div class="cal-view">
        <div class="card cal-card">
          <div class="cal-head">
            <h2 id="cal-title"></h2>
            <div class="cal-nav">
              <button class="btn btn-outline btn-sm" data-nav="today">วันนี้</button>
              <button class="icon-btn" data-nav="prev" aria-label="เดือนก่อน">${icon('left')}</button>
              <button class="icon-btn" data-nav="next" aria-label="เดือนถัดไป">${icon('right')}</button>
            </div>
          </div>
          <div class="cal-weekdays" id="cal-weekdays"></div>
          <div class="cal-grid-wrap"><div class="cal-grid" id="cal-grid"></div></div>
        </div>
        <aside class="card cal-side" id="cal-side"></aside>
      </div>`;

    const grid = $('#cal-grid', root);
    const side = $('#cal-side', root);

    const renderMonth = () => {
      const ws = store.state.settings.weekStart;
      const today = todayKey();
      $('#cal-title', root).innerHTML = `${THAI_MONTHS[cursor.getMonth()]} <span class="muted">${thaiYear(cursor)}</span>`;
      $('#cal-weekdays', root).innerHTML = Array.from({ length: 7 }, (_, i) => {
        const d = (i + ws) % 7;
        return `<span class="${d === 0 || d === 6 ? 'wk' : ''}">${THAI_DAYS_SHORT[d]}</span>`;
      }).join('');

      const start = startOfWeek(cursor, ws);
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = addDays(start, i);
        const key = toKey(d);
        const inMonth = d.getMonth() === cursor.getMonth();
        const evs = eventsOn(key);
        const tks = tasksDue(key);
        const open = tks.filter((t) => !t.done).length;
        const cls = [
          'cal-cell',
          'ripple-host',
          inMonth ? '' : 'out',
          key === today ? 'today' : '',
          key === selected ? 'selected' : '',
          d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : '',
        ].join(' ');
        cells.push(`
          <button class="${cls}" data-day="${key}" aria-label="${formatDate(d, { weekday: true })}${evs.length ? `, ${evs.length} นัดหมาย` : ''}${tks.length ? `, ${tks.length} งาน` : ''}">
            <span class="cal-num">${d.getDate()}</span>
            <span class="cal-items">
              ${evs.slice(0, 2).map((e) => `<span class="cal-ev" style="--c:${e.color}">${e.isMeeting ? '👥 ' : ''}${esc(e.title)}</span>`).join('')}
              ${evs.length > 2 ? `<span class="cal-more">+${evs.length - 2} รายการ</span>` : ''}
            </span>
            <span class="cal-dots">
              ${evs.slice(0, 4).map((e) => `<i style="--c:${e.color}"></i>`).join('')}
            </span>
            ${tks.length ? `<span class="cal-task-badge ${open ? '' : 'done'}" title="${open} งานค้าง">${open ? open : '✓'}</span>` : ''}
          </button>`);
      }
      grid.innerHTML = cells.join('');
      if (dir) {
        grid.classList.remove('slide-next', 'slide-prev');
        void grid.offsetWidth;
        grid.classList.add(dir === 'next' ? 'slide-next' : 'slide-prev');
        dir = '';
      }
    };

    const renderSide = (animate = false) => {
      track.frame();
      const evs = eventsOn(selected);
      const tks = sortTasks(tasksDue(selected));
      const isToday = selected === todayKey();
      side.innerHTML = `
        <div class="side-inner ${animate ? 'pop' : ''}">
          <div class="side-date">
            <div class="side-day">${new Date(selected + 'T00:00').getDate()}</div>
            <div>
              <p class="side-weekday">${formatDate(selected, { weekday: true, year: false }).split(' ')[0]}${isToday ? ' <span class="tag accent">วันนี้</span>' : ''}</p>
              <p class="muted">${formatDate(selected, { year: true }).split(' ').slice(1).join(' ')}</p>
            </div>
          </div>
          <div class="side-actions">
            <button class="btn btn-primary btn-sm" data-add="event">${icon('plus')}นัดหมาย</button>
            <button class="btn btn-outline btn-sm" data-add="task">${icon('plus')}งาน</button>
          </div>

          <h4 class="section-title">${icon('clock')} นัดหมาย <span class="count">${evs.length}</span></h4>
          ${evs.length ? `<ul class="agenda">${evs
            .map((e) => {
              const { cls, vars } = track.attrs(selected + e.id);
              return `<li class="agenda-ev${cls}" style="${vars}--c:${e.color}" data-event="${e.id}" tabindex="0">
                <span class="agenda-time">${e.allDay ? 'ทั้งวัน' : `${e.start}–${e.end}`}</span>
                <span class="agenda-title">${e.isMeeting ? '👥 ' : ''}${esc(e.title)}</span>
                <span class="muted agenda-sub">${e.isMeeting ? `ประชุม${e.attendees.length ? ` · ${e.attendees.length} คน` : ''}${e.location ? ' · ' + esc(e.location) : ''}` : `${category(e.category).emoji} ${category(e.category).label}`}${e.repeat !== 'none' ? ' · ทำซ้ำ' : ''}</span>
              </li>`;
            })
            .join('')}</ul>` : emptyState('🌤️', 'ไม่มีนัดหมาย', '', true)}

          <h4 class="section-title">${icon('checkSquare')} งาน <span class="count">${tks.length}</span></h4>
          ${tks.length ? `<ul class="mini-tasks">${tks
            .map((t) => {
              const { cls, style } = track.attrs(selected + t.id);
              return `<li class="mini-task${t.done ? ' is-done' : ''}${cls}"${style} data-task="${t.id}">
                ${checkbox(t.done, { round: true, label: t.title })}
                <span class="mini-title">${esc(t.title)}</span>
                ${t.time ? `<span class="tag">${t.time}</span>` : ''}
                <span class="prio-dot" style="--c:${priority(t.priority).color}"></span>
              </li>`;
            })
            .join('')}</ul>` : emptyState('📭', 'ไม่มีงานในวันนี้', '', true)}
        </div>`;
    };

    const go = (where) => {
      if (where === 'today') {
        const now = new Date();
        const target = new Date(now.getFullYear(), now.getMonth(), 1);
        dir = target > cursor ? 'next' : target < cursor ? 'prev' : '';
        cursor = target;
        selected = todayKey();
        track.reset();
        renderSide(true);
      } else {
        dir = where;
        cursor = addMonths(cursor, where === 'next' ? 1 : -1);
      }
      renderMonth();
    };

    root.querySelector('.cal-nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-nav]');
      if (b) go(b.dataset.nav);
    });

    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-day]');
      if (!cell) return;
      ripple(e, cell);
      const key = cell.dataset.day;
      if (e.detail > 1) return; // handled by dblclick
      selected = key;
      grid.querySelectorAll('.cal-cell.selected').forEach((c) => c.classList.remove('selected'));
      cell.classList.add('selected');
      if (cell.classList.contains('out')) {
        go(key > toKey(cursor) ? 'next' : 'prev');
      }
      track.reset();
      renderSide(true);
      if (window.matchMedia('(max-width: 1100px)').matches) {
        side.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    grid.addEventListener('dblclick', (e) => {
      const cell = e.target.closest('[data-day]');
      if (cell) openEventForm(null, { date: cell.dataset.day });
    });

    side.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]')?.dataset.add;
      if (add === 'event') return openEventForm(null, { date: selected });
      if (add === 'task') return openTaskForm(null, { due: selected });
      const check = e.target.closest('[data-check]');
      if (check) return toggleTask(check.closest('[data-task]').dataset.task, check);
      const t = e.target.closest('[data-task]');
      if (t) return openTaskForm(store.find('tasks', t.dataset.task));
      const ev = e.target.closest('[data-event]');
      if (ev) {
        const item = store.find('events', ev.dataset.event);
        return item?.isMeeting ? openMeeting(item.id, selected) : openEventForm(item);
      }
    });

    // keyboard: arrows move month when grid focused
    root.addEventListener('keydown', (e) => {
      if (e.target.closest('input,textarea,select')) return;
      if (e.key === 'ArrowLeft' && e.altKey) go('prev');
      if (e.key === 'ArrowRight' && e.altKey) go('next');
    });

    renderMonth();
    renderSide(true);

    return {
      update: () => {
        renderMonth();
        renderSide();
      },
    };
  },
};
