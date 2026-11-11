// ==========================================================
// dashboard.js — ภาพรวม: today at a glance
// ==========================================================
import { store } from '../core/store.js';
import {
  esc, todayKey, formatDate, greeting, timeToMin, nowMinutes, fromKey,
  THAI_DAYS_SHORT, THAI_DAYS, countUp, enterTracker,
} from '../core/utils.js';
import { QUOTES, category, priority } from '../core/constants.js';
import {
  eventsOn, goalProgress, isOverdue, sortTasks, completionHistory, streak, daysLeft,
} from '../core/selectors.js';
import { toggleTask } from '../core/actions.js';
import { icon } from '../ui/icons.js';
import { ring, bar, animateMeters, checkbox, emptyState, meterMemory } from '../ui/widgets.js';
import { openTaskForm } from '../forms/taskForm.js';
import { openEventForm } from '../forms/eventForm.js';
import { openGoalForm } from '../forms/goalForm.js';
import { openMeeting, linkLabel } from '../forms/meetingRoom.js';
import { toast } from '../ui/toast.js';
import { dayMoment, openPlanDay, openReviewDay, toggleFocus, isFocus, star, MAX_FOCUS } from './dayplan.js';
import { focusTasks } from '../core/selectors.js';

function quoteOfDay() {
  const d = new Date();
  const n = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate();
  return QUOTES[n % QUOTES.length];
}

export default {
  id: 'dashboard',
  label: 'ภาพรวม',
  icon: 'home',
  subtitle: () => formatDate(new Date(), { weekday: true }),

  mount(root, { navigate }) {
    const track = enterTracker();
    const mem = meterMemory();
    let first = true;
    let clock;

    const render = () => {
      track.frame();
      const s = store.state;
      const today = todayKey();
      const name = s.settings.name?.trim();

      // ----- data -----
      const todays = s.tasks.filter((t) => t.due === today);
      const overdue = s.tasks.filter(isOverdue);
      const doneToday = todays.filter((t) => t.done).length;
      const pctToday = todays.length ? Math.round((doneToday / todays.length) * 100) : 0;
      const events = eventsOn(today);
      const now = nowMinutes();
      const nextEv = events.find((e) => !e.allDay && timeToMin(e.end) > now);
      const goals = s.goals.map((g) => ({ g, p: goalProgress(g) }));
      const avgGoal = goals.length ? Math.round(goals.reduce((a, x) => a + x.p.pct, 0) / goals.length) : 0;
      const st = streak();
      const focus = focusTasks(today);
      const focusIds = new Set(focus.map((t) => t.id));
      const list = [...sortTasks(overdue), ...sortTasks(todays)].filter((t) => !focusIds.has(t.id));
      const moment = dayMoment();
      const dayInfo = store.day(today);

      root.innerHTML = `
        <div class="dash">
          <section class="hero">
            <div class="hero-text">
              <p class="hero-hello">${greeting()}${name ? `, ${esc(name)}` : ''} 👋</p>
              <h2>${
                todays.length - doneToday > 0
                  ? `วันนี้มีงานรออยู่ <span class="grad-text">${todays.length - doneToday} งาน</span>`
                  : todays.length
                  ? 'เคลียร์งานวันนี้ครบแล้ว <span class="grad-text">เยี่ยมมาก!</span>'
                  : 'วันนี้ยังว่าง <span class="grad-text">มาวางแผนกัน</span>'
              }</h2>
              <p class="hero-quote">“${quoteOfDay()}”</p>
              <div class="hero-actions">
                ${moment === 'plan' ? `<button class="btn btn-gold" data-act="plan">🌅 วางแผนวันนี้</button>` : ''}
                ${moment === 'review' ? `<button class="btn btn-gold" data-act="review">🌙 สรุปวันนี้</button>` : ''}
                <button class="btn ${moment ? 'btn-glass' : 'btn-light'}" data-act="task">${icon('plus')}เพิ่มงาน</button>
                <button class="btn btn-glass" data-act="event">${icon('calendar')}เพิ่มนัดหมาย</button>
              </div>
              ${dayInfo.reviewed ? `<p class="hero-done">✨ ปิดวันแล้ว${dayInfo.mood ? ` · ${['', '😣', '😮‍💨', '😐', '😊', '🤩'][dayInfo.mood]}` : ''}</p>` : ''}
            </div>
            <div class="hero-art" aria-hidden="true">
              <div class="hero-orbit"><span>🎯</span><span>📅</span><span>✅</span></div>
              <div class="hero-big">${new Date().getDate()}</div>
              <div class="hero-month">${formatDate(new Date(), { year: false }).split(' ')[1]}</div>
            </div>
          </section>

          <section class="stats">
            <div class="card stat card-hover">
              ${ring(pctToday, { size: 58, stroke: 6, from: mem('today', pctToday) })}
              <div><p class="stat-label">งานวันนี้</p>
                <p class="stat-value"><span data-count="${doneToday}">${doneToday}</span><small>/${todays.length}</small></p>
                <p class="stat-sub">เสร็จแล้ว</p></div>
            </div>
            <div class="card stat card-hover" data-go="schedule">
              <div class="stat-ico" style="--c:#ec4899">${icon('clock')}</div>
              <div><p class="stat-label">นัดหมายวันนี้</p>
                <p class="stat-value"><span data-count="${events.length}">${events.length}</span><small> รายการ</small></p>
                <p class="stat-sub">${nextEv ? `ถัดไป ${nextEv.start} · ${esc(nextEv.title)}` : 'ไม่มีนัดที่เหลือ'}</p></div>
            </div>
            <div class="card stat card-hover" data-go="goals">
              ${ring(avgGoal, { size: 58, stroke: 6, color: '#10b981', from: mem('goal', avgGoal) })}
              <div><p class="stat-label">เป้าหมาย</p>
                <p class="stat-value"><span data-count="${goals.length}">${goals.length}</span><small> เป้าหมาย</small></p>
                <p class="stat-sub">คืบหน้าเฉลี่ย ${avgGoal}%</p></div>
            </div>
            <div class="card stat card-hover">
              <div class="stat-ico ${st ? 'flame' : ''}" style="--c:var(--gold)">${icon('fire')}</div>
              <div><p class="stat-label">ทำต่อเนื่อง</p>
                <p class="stat-value"><span data-count="${st}">${st}</span><small> วัน</small></p>
                <p class="stat-sub">${overdue.length ? `<span class="tag bad">${icon('alert')}เลยกำหนด ${overdue.length} งาน</span>` : 'ไม่มีงานค้าง 👍'}</p></div>
            </div>
          </section>

          <section class="dash-grid">
            <div class="card">
              <div class="card-head">
                <h3>${icon('clock')}ตารางวันนี้</h3>
                <button class="btn btn-ghost btn-sm" data-go="schedule">ดูทั้งหมด ${icon('right')}</button>
              </div>
              ${events.length ? `<ol class="timeline">${renderTimeline(events, now, track)}</ol>` : emptyState('☕', 'ไม่มีนัดหมายวันนี้', 'ใช้เวลาว่างทำงานสำคัญได้เต็มที่', true)}
            </div>

            <div class="card">
              <div class="card-head">
                <h3>${icon('checkSquare')}งานที่ต้องทำ</h3>
                <button class="btn btn-ghost btn-sm" data-go="tasks">ดูทั้งหมด ${icon('right')}</button>
              </div>
              <form class="quick-input" data-quick>
                ${icon('plus')}<input class="input" placeholder="เพิ่มงานวันนี้ แล้วกด Enter" maxlength="140" aria-label="เพิ่มงานวันนี้" />
              </form>
              <div class="focus-box">
                <p class="focus-title">⭐ งานสำคัญวันนี้ <span class="muted">${focus.length}/${MAX_FOCUS}</span>
                  ${dayInfo.planned ? '' : `<button type="button" class="link-btn" data-act="plan">วางแผนวันนี้</button>`}</p>
                ${focus.length
                  ? `<ul class="mini-tasks">${focus.map((t) => miniTask(t, track, true)).join('')}</ul>`
                  : `<p class="muted focus-empty">แตะ ☆ หน้างานด้านล่างเพื่อเลือกงานที่สำคัญที่สุด (สูงสุด ${MAX_FOCUS} งาน)</p>`}
              </div>
              ${list.length ? `<ul class="mini-tasks">${list.map((t) => miniTask(t, track)).join('')}</ul>` : focus.length ? '' : emptyState('🎉', 'ไม่มีงานค้าง', 'พักผ่อนได้ หรือเพิ่มงานใหม่ด้านบน', true)}
            </div>
          </section>

          <section class="dash-grid">
            <div class="card">
              <div class="card-head">
                <h3>${icon('target')}ความคืบหน้าเป้าหมาย</h3>
                <button class="btn btn-ghost btn-sm" data-act="goal">${icon('plus')}ตั้งเป้าหมาย</button>
              </div>
              ${goals.length ? `<div class="goal-bars">${goals
                .sort((a, b) => b.p.pct - a.p.pct)
                .map(({ g, p }) => {
                  const left = daysLeft(g.deadline);
                  const { cls, style } = track.attrs('g' + g.id);
                  return `<button class="goal-bar${cls}"${style} data-go="goals">
                    <div class="goal-bar-top"><span>${category(g.category).emoji} ${esc(g.title)}</span><b>${p.pct}%</b></div>
                    ${bar(p.pct, g.color, mem('g' + g.id, p.pct))}
                    <p class="muted">${p.done}/${p.total} ขั้นตอน${left != null ? ` · ${left >= 0 ? `เหลือ ${left} วัน` : `เลยกำหนด ${-left} วัน`}` : ''}</p>
                  </button>`;
                })
                .join('')}</div>` : emptyState('🌟', 'ยังไม่มีเป้าหมาย', 'เริ่มตั้งเป้าหมายแรกของคุณ', true)}
            </div>

            <div class="card">
              <div class="card-head">
                <h3>${icon('chart')}งานที่ทำเสร็จ 7 วันล่าสุด</h3>
              </div>
              ${renderChart(completionHistory(7), first)}
            </div>
          </section>
        </div>`;

      animateMeters(root);
      if (first) root.querySelectorAll('[data-count]').forEach((n) => countUp(n, Number(n.dataset.count)));
      first = false;
    };

    root.addEventListener('click', (e) => {
      const starBtn = e.target.closest('[data-star]');
      if (starBtn) {
        const id = starBtn.closest('[data-task]').dataset.task;
        if (toggleFocus(id)) starBtn.classList.add('pop-star');
        return;
      }
      const check = e.target.closest('[data-check]');
      if (check) {
        const id = check.closest('[data-task]').dataset.task;
        toggleTask(id, check);
        return;
      }
      const taskEl = e.target.closest('[data-task]');
      if (taskEl && !e.target.closest('button')) {
        openTaskForm(store.find('tasks', taskEl.dataset.task));
        return;
      }
      if (e.target.closest('a[href]')) return;
      const evEl = e.target.closest('[data-event]');
      if (evEl) {
        const ev = store.find('events', evEl.dataset.event);
        if (ev?.isMeeting) openMeeting(ev.id, todayKey());
        else openEventForm(ev);
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'plan') return openPlanDay();
      if (act === 'review') return openReviewDay();
      if (act === 'task') return openTaskForm();
      if (act === 'event') return openEventForm();
      if (act === 'goal') return openGoalForm();
      const go = e.target.closest('[data-go]')?.dataset.go;
      if (go) navigate(go);
    });

    root.addEventListener('submit', (e) => {
      if (!e.target.matches('[data-quick]')) return;
      e.preventDefault();
      const input = e.target.querySelector('input');
      const title = input.value.trim();
      if (!title) return;
      store.add('tasks', {
        title, due: todayKey(), time: '', notes: '', priority: 'medium', category: 'work',
        goalId: null, done: false, doneAt: null,
      });
      toast('เพิ่มงานวันนี้แล้ว', { icon: '✅' });
      requestAnimationFrame(() => root.querySelector('[data-quick] input')?.focus());
    });

    render();
    // refresh "now" marker every minute
    clock = setInterval(() => {
      if (!root.contains(document.activeElement) || document.activeElement.tagName !== 'INPUT') render();
    }, 60000);

    return {
      update: render,
      unmount: () => clearInterval(clock),
    };
  },
};

function renderTimeline(events, now, track) {
  let nowPlaced = false;
  return events
    .map((e) => {
      const s = timeToMin(e.start);
      const en = timeToMin(e.end);
      const past = !e.allDay && en <= now;
      const live = !e.allDay && s <= now && now < en;
      let marker = '';
      if (!nowPlaced && !e.allDay && s > now) {
        nowPlaced = true;
        marker = `<li class="tl-now"><span></span>ตอนนี้</li>`;
      }
      const { cls, vars } = track.attrs('e' + e.id);
      return `${marker}<li class="tl-item${past ? ' past' : ''}${live ? ' live' : ''}${cls}" data-event="${e.id}" style="${vars}--c:${e.color}">
        <div class="tl-time">${e.allDay ? 'ทั้งวัน' : `${e.start}<small>${e.end}</small>`}</div>
        <div class="tl-body">
          <p class="tl-title">${esc(e.title)}</p>
          <p class="muted">${e.isMeeting ? `${icon('users')} ประชุม${e.location ? ' · ' + esc(e.location) : ''}` : `${category(e.category).emoji} ${category(e.category).label}`}${e.repeat !== 'none' ? ` · ${icon('repeat')}` : ''}</p>
        </div>
        ${live ? '<span class="tag accent live-tag">กำลังดำเนินอยู่</span>' : ''}
        ${e.isMeeting && e.link && !past ? `<a class="btn btn-outline btn-sm tl-join" href="${esc(e.link)}" target="_blank" rel="noopener" title="เข้าร่วมผ่าน ${linkLabel(e.link)}">${icon('video')}<span>เข้าร่วม</span></a>` : ''}
      </li>`;
    })
    .join('');
}

function miniTask(t, track, focused = false) {
  const { cls, style } = track.attrs((focused ? 'f' : 't') + t.id);
  const over = isOverdue(t);
  const on = focused || isFocus(t.id);
  return `<li class="mini-task${t.done ? ' is-done' : ''}${focused ? ' is-focus' : ''}${cls}"${style} data-task="${t.id}">
    <button type="button" class="star-btn${on ? ' on' : ''}" data-star aria-pressed="${on}" aria-label="${on ? 'เอาออกจากงานสำคัญ' : 'ตั้งเป็นงานสำคัญ'}">${star(on)}</button>
    ${checkbox(t.done, { round: true, label: t.title })}
    <span class="mini-title">${esc(t.title)}</span>
    ${over ? '<span class="tag bad">เลยกำหนด</span>' : ''}
    ${t.time ? `<span class="tag">${t.time}</span>` : ''}
    <span class="prio-dot" style="--c:${priority(t.priority).color}" title="ความสำคัญ${priority(t.priority).label}"></span>
  </li>`;
}

function renderChart(data, animate) {
  const max = Math.max(4, ...data.map((d) => d.count));
  const total = data.reduce((a, d) => a + d.count, 0);
  const today = todayKey();
  const best = Math.max(...data.map((d) => d.count));
  return `
    <div class="chart-summary"><b>${total}</b> งาน <span class="muted">· เฉลี่ย ${(total / data.length).toFixed(1)} งาน/วัน</span></div>
    <div class="bars${animate ? ' animate' : ''}" role="img" aria-label="กราฟจำนวนงานที่ทำเสร็จต่อวัน">
      ${[0.5, 1].map((f) => `<div class="bars-grid" style="--f:${f}"><span>${Math.round(max * f)}</span></div>`).join('')}
      ${data
        .map((d, i) => {
          const date = fromKey(d.key);
          const isToday = d.key === today;
          const showLabel = isToday || (d.count === best && best > 0);
          return `<div class="bar-col${isToday ? ' today' : ''}" tabindex="0" style="--i:${i}"
              aria-label="วัน${THAI_DAYS[date.getDay()]} ${formatDate(date, { year: false })}: ${d.count} งาน">
            <div class="bar-track">
              <div class="bar-fill" style="height:${(d.count / max) * 100}%">${showLabel && d.count ? `<span class="bar-val">${d.count}</span>` : ''}</div>
            </div>
            <span class="bar-x">${isToday ? 'วันนี้' : THAI_DAYS_SHORT[date.getDay()]}</span>
            <div class="bar-tip"><b>${d.count} งาน</b><br>${formatDate(date, { weekday: true, short: true, year: false })}</div>
          </div>`;
        })
        .join('')}
    </div>`;
}
