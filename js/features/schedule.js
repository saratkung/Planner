// ==========================================================
// schedule.js — weekly / daily time-block timetable
// (click empty slot = new event, drag = move, drag bottom edge = resize)
// ==========================================================
import { store } from '../core/store.js';
import {
  esc, toKey, fromKey, todayKey, addDays, startOfWeek, formatDate, timeToMin, minToTime,
  nowMinutes, durationLabel, THAI_DAYS_SHORT, THAI_MONTHS_SHORT, thaiYear, clamp, $, $$,
} from '../core/utils.js';
import { CATEGORIES, category } from '../core/constants.js';
import { eventsOn, layoutDay } from '../core/selectors.js';
import { icon } from '../ui/icons.js';
import { segmented, bindSegmented, bar, animateMeters, meterMemory, moveSegIndicator } from '../ui/widgets.js';
import { openEventForm } from '../forms/eventForm.js';
import { toast } from '../ui/toast.js';

const H = 56; // px per hour
const SNAP = 15; // minutes

export default {
  id: 'schedule',
  label: 'ตารางเวลา',
  icon: 'clock',
  subtitle: () => 'คลิกช่องว่างเพื่อเพิ่ม · ลากเพื่อย้าย · ลากขอบล่างเพื่อปรับเวลา',

  mount(root) {
    const mem = meterMemory();
    let mode = window.matchMedia('(max-width: 760px)').matches ? 'day' : 'week';
    let focus = todayKey(); // focused day (day mode) / anchor of week
    let dir = '';
    let firstScroll = true;
    let clock;

    root.innerHTML = `
      <div class="sched-view">
        <div class="card sched-card">
          <div class="sched-head">
            <h2 id="sb-title"></h2>
            <div class="sched-controls">
              ${segmented(
                [
                  { id: 'day', label: 'วัน', icon: icon('square') },
                  { id: 'week', label: 'สัปดาห์', icon: icon('columns') },
                ],
                mode,
                { name: 'mode' },
              )}
              <button class="btn btn-outline btn-sm" data-nav="today">วันนี้</button>
              <button class="icon-btn" data-nav="prev" aria-label="ก่อนหน้า">${icon('left')}</button>
              <button class="icon-btn" data-nav="next" aria-label="ถัดไป">${icon('right')}</button>
            </div>
          </div>
          <div class="sb-scroll" id="sb-scroll">
            <div class="sb-daystrip" id="sb-strip"></div>
            <div class="sb-body" style="height:${24 * H}px">
              <div class="sb-hours">${Array.from({ length: 24 }, (_, h) => `<span style="top:${h * H}px">${h ? String(h).padStart(2, '0') + ':00' : ''}</span>`).join('')}</div>
              <div class="sb-cols" id="sb-cols"></div>
            </div>
          </div>
        </div>
        <div class="card sched-summary" id="sb-summary"></div>
      </div>`;

    const colsEl = $('#sb-cols', root);
    const scroller = $('#sb-scroll', root);

    const days = () => {
      if (mode === 'day') return [focus];
      const s = startOfWeek(fromKey(focus), store.state.settings.weekStart);
      return Array.from({ length: 7 }, (_, i) => toKey(addDays(s, i)));
    };

    const render = () => {
      const ds = days();
      const today = todayKey();
      const weekDays = (() => {
        const s = startOfWeek(fromKey(focus), store.state.settings.weekStart);
        return Array.from({ length: 7 }, (_, i) => toKey(addDays(s, i)));
      })();

      // title
      const a = fromKey(weekDays[0]);
      const b = fromKey(weekDays[6]);
      $('#sb-title', root).innerHTML =
        mode === 'day'
          ? `${formatDate(focus, { weekday: true, year: false })} <span class="muted">${thaiYear(fromKey(focus))}</span>`
          : `${a.getDate()} ${a.getMonth() !== b.getMonth() ? THAI_MONTHS_SHORT[a.getMonth()] : ''} – ${b.getDate()} ${THAI_MONTHS_SHORT[b.getMonth()]} <span class="muted">${thaiYear(b)}</span>`;

      // day strip (headers)
      $('#sb-strip', root).className = `sb-daystrip ${mode}`;
      $('#sb-strip', root).innerHTML =
        `<span class="sb-gutter"></span>` +
        (mode === 'week' ? ds : weekDays)
          .map((k) => {
            const d = fromKey(k);
            const n = eventsOn(k).length;
            return `<button class="sb-dayhead${k === today ? ' today' : ''}${mode === 'day' && k === focus ? ' active' : ''}" data-day="${k}">
              <span>${THAI_DAYS_SHORT[d.getDay()]}</span><b>${d.getDate()}</b>${n ? `<i>${n}</i>` : ''}
            </button>`;
          })
          .join('');

      // columns
      const now = nowMinutes();
      colsEl.style.gridTemplateColumns = `repeat(${ds.length}, minmax(0, 1fr))`;
      colsEl.innerHTML = ds
        .map((k) => {
          const laid = layoutDay(eventsOn(k));
          return `<div class="sb-col${k === today ? ' today' : ''}" data-col="${k}">
            ${laid
              .map(({ ev, s, e, lane, lanes }, i) => {
                const short = e - s < 45;
                return `<div class="sb-ev${short ? ' short' : ''}" data-event="${ev.id}" data-date="${k}" tabindex="0"
                  style="--c:${ev.color};--i:${i};top:${(s / 60) * H}px;height:${((e - s) / 60) * H - 2}px;left:calc(${(lane / lanes) * 100}% + 2px);width:calc(${100 / lanes}% - 4px)">
                  <p class="sb-ev-title">${esc(ev.title)}</p>
                  <p class="sb-ev-time">${ev.start}–${ev.end}${ev.repeat !== 'none' ? ' ↻' : ''}</p>
                  <span class="sb-resize" data-resize aria-hidden="true"></span>
                </div>`;
              })
              .join('')}
            ${k === today ? `<div class="sb-now" style="top:${(now / 60) * H}px"><span></span></div>` : ''}
          </div>`;
        })
        .join('');

      if (dir) {
        colsEl.classList.remove('slide-next', 'slide-prev');
        void colsEl.offsetWidth;
        colsEl.classList.add(dir === 'next' ? 'slide-next' : 'slide-prev');
        dir = '';
      }

      renderSummary(weekDays);

      if (firstScroll) {
        firstScroll = false;
        const target = ds.includes(today) ? Math.max(0, now / 60 - 2) : 7;
        scroller.scrollTop = Math.min(target, 15) * H;
      }
    };

    const renderSummary = (weekDays) => {
      const totals = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
      let sum = 0;
      weekDays.forEach((k) =>
        eventsOn(k).forEach((e) => {
          const m = Math.max(0, timeToMin(e.end) - timeToMin(e.start));
          totals[e.category] = (totals[e.category] || 0) + m;
          sum += m;
        }),
      );
      const max = Math.max(1, ...Object.values(totals));
      $('#sb-summary', root).innerHTML = `
        <div class="card-head"><h3>${icon('chart')}เวลาที่วางแผนไว้สัปดาห์นี้</h3><b class="sum-total">${durationLabel(sum)}</b></div>
        <div class="sum-rows">
          ${CATEGORIES.map((c) => {
            const pct = Math.round((totals[c.id] / max) * 100);
            return `<div class="sum-row">
              <span class="sum-label">${c.emoji} ${c.label}</span>
              ${bar(pct, c.color, mem(c.id, pct))}
              <span class="sum-val">${totals[c.id] ? durationLabel(totals[c.id]) : '—'}</span>
            </div>`;
          }).join('')}
        </div>`;
      animateMeters($('#sb-summary', root));
    };

    // ---------- navigation ----------
    root.querySelector('.sched-controls').addEventListener('click', (e) => {
      const nav = e.target.closest('[data-nav]')?.dataset.nav;
      if (!nav) return;
      const step = mode === 'day' ? 1 : 7;
      if (nav === 'today') {
        dir = todayKey() > focus ? 'next' : todayKey() < focus ? 'prev' : '';
        focus = todayKey();
        firstScroll = true;
      } else {
        dir = nav;
        focus = toKey(addDays(fromKey(focus), nav === 'next' ? step : -step));
      }
      render();
    });
    bindSegmented($('[data-seg="mode"]', root), (v) => {
      mode = v;
      dir = '';
      render();
    });
    $('#sb-strip', root).addEventListener('click', (e) => {
      const d = e.target.closest('[data-day]')?.dataset.day;
      if (!d) return;
      dir = d > focus ? 'next' : d < focus ? 'prev' : '';
      focus = d;
      if (mode === 'week') {
        mode = 'day';
        const seg = $('[data-seg="mode"]', root);
        seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === 'day'));
        moveSegIndicator(seg);
      }
      render();
    });

    // ---------- click empty slot -> new event ----------
    colsEl.addEventListener('click', (e) => {
      if (e.target.closest('.sb-ev')) return;
      const col = e.target.closest('[data-col]');
      if (!col) return;
      const y = e.clientY - col.getBoundingClientRect().top;
      const start = Math.floor((y / H) * 2) * 30;
      openEventForm(null, { date: col.dataset.col, start: minToTime(start), end: minToTime(start + 60) });
    });

    // ---------- drag to move / resize ----------
    let drag = null;
    colsEl.addEventListener('pointerdown', (e) => {
      const evEl = e.target.closest('.sb-ev');
      if (!evEl || e.button !== 0) return;
      const ev = store.find('events', evEl.dataset.event);
      if (!ev) return;
      drag = {
        el: evEl,
        ev,
        resize: !!e.target.closest('[data-resize]'),
        x0: e.clientX,
        y0: e.clientY,
        top0: evEl.offsetTop,
        h0: evEl.offsetHeight + 2,
        moved: false,
        col: evEl.parentElement,
        pid: e.pointerId,
        touch: e.pointerType === 'touch', // touch: tap to open, swipe scrolls
      };
    });
    colsEl.addEventListener('keydown', (e) => {
      const evEl = e.target.closest('.sb-ev');
      if (evEl && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openEventForm(store.find('events', evEl.dataset.event));
      }
    });

    const snapPx = (px) => Math.round(px / ((H * SNAP) / 60)) * ((H * SNAP) / 60);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);

    function onMove(e) {
      if (!drag || e.pointerId !== drag.pid) return;
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (drag.touch) {
        drag = null;
        return;
      }
      if (!drag.moved) {
        drag.moved = true;
        drag.el.classList.add('dragging');
        try { drag.el.setPointerCapture(drag.pid); } catch (_) {}
      }
      e.preventDefault();
      if (drag.resize) {
        const h = clamp(snapPx(drag.h0 + dy), (H * SNAP) / 60, 24 * H - drag.top0);
        drag.el.style.height = h - 2 + 'px';
        drag.h = h;
        drag.el.querySelector('.sb-ev-time').textContent = labelFor(drag.top0, h);
        return;
      }
      const top = clamp(snapPx(drag.top0 + dy), 0, 24 * H - drag.h0);
      drag.el.style.top = top + 'px';
      drag.top = top;
      drag.el.style.left = '2px';
      drag.el.style.width = 'calc(100% - 4px)';
      // move across days (week view)
      const col = $$('.sb-col', colsEl).find((c) => {
        const r = c.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX < r.right;
      });
      if (col && col !== drag.col) {
        col.appendChild(drag.el);
        drag.col = col;
      }
      drag.el.querySelector('.sb-ev-time').textContent = labelFor(top, drag.h0);
    }

    function labelFor(top, h) {
      const s = Math.round((top / H) * 60);
      return `${minToTime(s)}–${minToTime(s + Math.round((h / H) * 60))}`;
    }

    function onUp(e) {
      if (!drag || e.pointerId !== drag.pid) return;
      const d = drag;
      drag = null;
      if (!d.moved) {
        openEventForm(d.ev);
        return;
      }
      d.el.classList.remove('dragging');
      // use target values (offsetTop may be mid-transition)
      const top = d.top ?? d.top0;
      const h = d.h ?? d.h0;
      const start = Math.round((top / H) * 60);
      const end = Math.min(24 * 60 - 1, start + Math.round((h / H) * 60));
      const patch = { start: minToTime(start), end: minToTime(end) };
      const newDate = d.col.dataset.col;
      const origDate = d.el.dataset.date;
      if (newDate !== origDate) {
        if (d.ev.repeat === 'none') patch.date = newDate;
        else toast('นัดหมายที่ทำซ้ำ ย้ายได้เฉพาะเวลา', { icon: 'ℹ️' });
      }
      store.update('events', d.ev.id, patch);
      toast(`${d.resize ? 'ปรับเวลา' : 'ย้าย'} “${d.ev.title}” เป็น ${patch.start}–${patch.end}`, { icon: '🕒' });
    }

    function onCancel() {
      if (!drag) return;
      drag = null;
      render();
    }

    render();
    clock = setInterval(() => {
      const line = $('.sb-now', colsEl);
      if (line) line.style.top = (nowMinutes() / 60) * H + 'px';
      else if (days().includes(todayKey())) render();
    }, 60000);

    return {
      update: render,
      onResize: () => moveSegIndicator($('[data-seg="mode"]', root), true),
      unmount() {
        clearInterval(clock);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      },
    };
  },
};
