// ==========================================================
// dayplan.js — วางแผนตอนเช้า / สรุปตอนเย็น / 3 งานสำคัญของวัน
// ==========================================================
import { store } from '../core/store.js';
import {
  esc, todayKey, toKey, addDays, formatDate, minToTime, durationLabel, timeToMin, nowMinutes, $, $$,
} from '../core/utils.js';
import { eventsOn, freeSlots, isOverdue, sortTasks, focusTasks, minutesOf, meetingStatus } from '../core/selectors.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { checkbox } from '../ui/widgets.js';
import { celebrate, confetti } from '../ui/confetti.js';
import { openMeeting } from '../forms/meetingRoom.js';

export const MAX_FOCUS = 3;
const MOODS = [
  { id: 5, emoji: '🤩', label: 'ยอดเยี่ยม' },
  { id: 4, emoji: '😊', label: 'ดี' },
  { id: 3, emoji: '😐', label: 'เฉย ๆ' },
  { id: 2, emoji: '😮‍💨', label: 'เหนื่อย' },
  { id: 1, emoji: '😣', label: 'แย่' },
];

/** ช่วงเวลาที่ควรแนะนำ: 'plan' (เช้า) | 'review' (เย็น) | null */
export function dayMoment() {
  const d = store.day(todayKey());
  const h = new Date().getHours();
  if (h >= 16 && !d.reviewed) return 'review';
  if (h < 16 && !d.planned) return 'plan';
  return null;
}

export function isFocus(taskId, key = todayKey()) {
  return (store.day(key).focus || []).includes(taskId);
}

/** ปักดาว / เอาดาวออก (สูงสุด 3 งาน) */
export function toggleFocus(taskId, key = todayKey()) {
  const focus = [...(store.day(key).focus || [])].filter((id) => store.find('tasks', id));
  const i = focus.indexOf(taskId);
  if (i >= 0) focus.splice(i, 1);
  else {
    if (focus.length >= MAX_FOCUS) {
      toast(`เลือกงานสำคัญได้วันละ ${MAX_FOCUS} งาน เอาดาวงานอื่นออกก่อนนะ`, { icon: '⭐' });
      return false;
    }
    focus.push(taskId);
    const t = store.find('tasks', taskId);
    if (t && t.due !== key && !t.done) store.update('tasks', taskId, { due: key });
  }
  store.setDay(key, { focus });
  return true;
}

/** แถบเวลางานของวัน: ช่วงที่มีนัด / ช่วงว่าง */
export function dayBar(key) {
  const { slots, ws, we } = freeSlots(key);
  const span = we - ws;
  const pct = (m) => ((m - ws) / span) * 100;
  const evs = eventsOn(key).filter((e) => !e.allDay && timeToMin(e.end) > ws && timeToMin(e.start) < we);
  const now = nowMinutes();
  const showNow = key === todayKey() && now > ws && now < we;
  const hours = [];
  for (let h = Math.ceil(ws / 60); h * 60 <= we; h += 2) hours.push(h);
  return `
    <div class="daybar" role="img" aria-label="เวลางาน ${minToTime(ws)}–${minToTime(we)}: ว่าง ${slots.length} ช่วง">
      <div class="daybar-track">
        ${slots.map((s) => `<span class="db-free" style="left:${pct(s.start)}%;width:${pct(s.end) - pct(s.start)}%"></span>`).join('')}
        ${evs.map((e, i) => {
          const s = Math.max(ws, timeToMin(e.start));
          const en = Math.min(we, timeToMin(e.end));
          return `<span class="db-busy" style="--c:${e.color};--i:${i};left:${pct(s)}%;width:${pct(en) - pct(s)}%" title="${esc(e.start)}–${esc(e.end)} ${esc(e.title)}"></span>`;
        }).join('')}
        ${showNow ? `<i class="db-now" style="left:${pct(now)}%"></i>` : ''}
      </div>
      <div class="daybar-axis">${hours.map((h) => `<span style="left:${pct(h * 60)}%">${String(h).padStart(2, '0')}</span>`).join('')}</div>
    </div>`;
}

// ==========================================================
// 🌅 วางแผนวันนี้
// ==========================================================
export function openPlanDay() {
  const key = todayKey();
  const meetings = eventsOn(key).filter((e) => e.isMeeting && !e.allDay);
  const { slots } = freeSlots(key);
  const freeTotal = slots.reduce((a, s) => a + s.mins, 0);
  const overdue = sortTasks(store.state.tasks.filter(isOverdue));
  const carry = new Set(overdue.map((t) => t.id));
  let focus = new Set(focusTasks(key).map((t) => t.id));

  const candidates = () =>
    sortTasks(
      store.state.tasks.filter((t) => !t.done && (t.due === key || carry.has(t.id) || focus.has(t.id))),
    );

  const renderPick = (root) => {
    const list = candidates();
    $('#pd-pick', root).innerHTML = list.length
      ? list
          .map(
            (t) => `<li class="pick${focus.has(t.id) ? ' on' : ''}" data-pick="${t.id}">
              <button type="button" class="star-btn" aria-pressed="${focus.has(t.id)}" aria-label="งานสำคัญ">${star(focus.has(t.id))}</button>
              <span class="mini-title">${esc(t.title)}</span>
              ${t.time ? `<span class="tag">${t.time}</span>` : ''}
              ${carry.has(t.id) ? '<span class="tag warn">ยกมาจากวันก่อน</span>' : ''}
            </li>`,
          )
          .join('')
      : '<p class="muted pd-empty">ยังไม่มีงานวันนี้ เพิ่มงานด้านล่างได้เลย</p>';
    $('#pd-count', root).textContent = `${focus.size}/${MAX_FOCUS}`;
    $('#pd-count', root).classList.toggle('full', focus.size === MAX_FOCUS);
  };

  openModal({
    title: '🌅 วางแผนวันนี้',
    size: 600,
    body: `
      <div class="pd">
        <p class="pd-date">${formatDate(key, { weekday: true })}</p>
        <section class="pd-sec" style="--i:0">
          <h4 class="section-title">${icon('clock')} ตารางวันนี้</h4>
          <p class="pd-sum"><b>${meetings.length}</b> ประชุม · ว่าง <b>${durationLabel(freeTotal)}</b> ในเวลางาน</p>
          ${dayBar(key)}
          ${slots.length
            ? `<div class="chips pd-slots">${slots.map((s) => `<span class="chip free-chip">${minToTime(s.start)}–${minToTime(s.end)} · ${durationLabel(s.mins)}</span>`).join('')}</div>
               <p class="muted pd-hint">💡 ใช้ช่วงว่างที่ยาวที่สุดทำงานสำคัญที่ต้องใช้สมาธิ</p>`
            : '<p class="muted pd-hint">วันนี้เต็มทั้งวัน เลือกงานสำคัญให้น้อยลงหน่อยนะ</p>'}
        </section>

        ${overdue.length ? `
        <section class="pd-sec" style="--i:1">
          <h4 class="section-title bad">${icon('alert')} งานค้างจากวันก่อน <span class="count">${overdue.length}</span></h4>
          <p class="muted pd-hint">ติ๊กงานที่จะทำวันนี้ (งานที่ไม่ติ๊กจะยังอยู่ในหมวดเลยกำหนด)</p>
          <ul class="mini-tasks" id="pd-carry">${overdue.map((t) => `<li class="mini-task" data-carry="${t.id}">${checkbox(true, { label: t.title })}<span class="mini-title">${esc(t.title)}</span><span class="tag bad">${formatDate(t.due, { short: true, year: false })}</span></li>`).join('')}</ul>
        </section>` : ''}

        <section class="pd-sec" style="--i:2">
          <h4 class="section-title">⭐ 3 งานสำคัญของวันนี้ <span class="count" id="pd-count"></span></h4>
          <p class="muted pd-hint">ถ้าวันนี้ทำได้แค่ 3 อย่าง จะเลือกอะไร?</p>
          <ul class="pick-list" id="pd-pick"></ul>
          <form class="quick-input" id="pd-add">
            ${icon('plus')}<input class="input" placeholder="เพิ่มงานวันนี้ แล้วกด Enter" maxlength="140" aria-label="เพิ่มงานวันนี้" />
          </form>
        </section>
      </div>`,
    footer: `<span class="spacer"></span>
      <button class="btn btn-ghost" data-close type="button">ไว้ทีหลัง</button>
      <button class="btn btn-primary" data-start type="button">🚀 เริ่มวันใหม่</button>`,
    onMount(root, close) {
      renderPick(root);
      $('#pd-carry', root)?.addEventListener('click', (e) => {
        const li = e.target.closest('[data-carry]');
        if (!li) return;
        const c = li.querySelector('[data-check]');
        const id = li.dataset.carry;
        carry.has(id) ? carry.delete(id) : carry.add(id);
        if (!carry.has(id)) focus.delete(id);
        c.classList.toggle('checked', carry.has(id));
        c.classList.remove('animate');
        void c.offsetWidth;
        c.classList.add('animate');
        renderPick(root);
      });
      $('#pd-pick', root).addEventListener('click', (e) => {
        const li = e.target.closest('[data-pick]');
        if (!li) return;
        const id = li.dataset.pick;
        if (focus.has(id)) focus.delete(id);
        else if (focus.size >= MAX_FOCUS) {
          li.classList.add('shake');
          setTimeout(() => li.classList.remove('shake'), 400);
          return;
        } else focus.add(id);
        renderPick(root);
        if (focus.has(id)) $(`[data-pick="${id}"] .star-btn`, root)?.classList.add('pop-star');
      });
      $('#pd-add', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const input = e.target.querySelector('input');
        const title = input.value.trim();
        if (!title) return;
        const t = store.add('tasks', {
          title, due: key, time: '', notes: '', priority: 'medium', category: 'work',
          goalId: null, done: false, doneAt: null,
        });
        if (focus.size < MAX_FOCUS) focus.add(t.id);
        input.value = '';
        renderPick(root);
      });
      $('[data-start]', root).addEventListener('click', (e) => {
        const moved = [...carry].filter((id) => store.find('tasks', id)?.due !== key);
        store.batch((state) => {
          state.tasks.forEach((t) => {
            if (carry.has(t.id) && !t.done) t.due = key;
          });
          state.days[key] = { focus: [], ...(state.days[key] || {}), planned: true, focus: [...focus] };
        });
        const r = e.target.getBoundingClientRect();
        confetti({ x: r.left + r.width / 2, y: r.top, count: 40, power: 9 });
        toast(
          `วางแผนแล้ว: ${focus.size} งานสำคัญ${moved.length ? ` · ย้ายงานค้างมาวันนี้ ${moved.length} งาน` : ''} ลุยเลย!`,
          { icon: '🚀', duration: 4000 },
        );
        close();
      });
    },
  });
}

// ==========================================================
// 🌙 สรุปวันนี้
// ==========================================================
export function openReviewDay() {
  const key = todayKey();
  const tomorrow = toKey(addDays(new Date(), 1));
  const day = store.day(key);
  const todays = store.state.tasks.filter((t) => t.due === key || (t.done && t.doneAt && toKey(new Date(t.doneAt)) === key));
  const done = todays.filter((t) => t.done);
  const open = sortTasks(store.state.tasks.filter((t) => !t.done && t.due && t.due <= key));
  const focus = focusTasks(key);
  const focusDone = focus.filter((t) => t.done).length;
  const meetings = eventsOn(key).filter((e) => e.isMeeting && !e.allDay);
  const noNotes = meetings.filter((m) => meetingStatus({ ...m, occurrence: key }) === 'past' && !minutesOf(m, key).notes?.trim());
  const move = new Set(open.map((t) => t.id));
  let mood = day.mood || null;
  const pct = todays.length ? Math.round((done.length / todays.length) * 100) : 0;

  const headline =
    focus.length && focusDone === focus.length
      ? 'ทำงานสำคัญครบทุกข้อ เก่งมาก! 🏆'
      : done.length >= 5
      ? 'วันนี้ทำงานได้เยอะมาก 💪'
      : done.length
      ? 'อีกหนึ่งวันที่ก้าวหน้า ✨'
      : 'พรุ่งนี้เริ่มใหม่ได้เสมอ 🌱';

  openModal({
    title: '🌙 สรุปวันนี้',
    size: 600,
    body: `
      <div class="pd">
        <p class="pd-date">${formatDate(key, { weekday: true })}</p>
        <section class="rv-hero pd-sec" style="--i:0">
          <div class="rv-big"><b>${done.length}</b><span>งานเสร็จ</span></div>
          <div class="rv-big"><b>${focusDone}/${focus.length || 0}</b><span>งานสำคัญ</span></div>
          <div class="rv-big"><b>${meetings.length}</b><span>ประชุม</span></div>
          <p class="rv-head">${headline}</p>
          <div class="progress rv-prog"><span style="--p:${pct}%"></span></div>
        </section>

        ${open.length ? `
        <section class="pd-sec" style="--i:1">
          <h4 class="section-title">${icon('right')} งานที่ยังไม่เสร็จ <span class="count">${open.length}</span></h4>
          <p class="muted pd-hint">งานที่ติ๊กไว้จะเลื่อนไปพรุ่งนี้ (${formatDate(tomorrow, { short: true, year: false })})</p>
          <ul class="mini-tasks" id="rv-move">${open.map((t) => `<li class="mini-task" data-move="${t.id}">${checkbox(true, { label: t.title })}<span class="mini-title">${esc(t.title)}</span>${focus.some((f) => f.id === t.id) ? '<span class="tag accent">⭐ สำคัญ</span>' : ''}</li>`).join('')}</ul>
        </section>` : ''}

        ${noNotes.length ? `
        <section class="pd-sec" style="--i:2">
          <h4 class="section-title">${icon('note')} ประชุมที่ยังไม่ได้จดบันทึก <span class="count">${noNotes.length}</span></h4>
          <div class="rv-notes">${noNotes.map((m) => `<button type="button" class="chip" data-note="${m.id}">${icon('users')}${esc(m.title)} · จดเลย</button>`).join('')}</div>
        </section>` : ''}

        <section class="pd-sec" style="--i:3">
          <h4 class="section-title">วันนี้เป็นอย่างไรบ้าง?</h4>
          <div class="moods" role="radiogroup" aria-label="ความรู้สึกวันนี้">
            ${MOODS.map((m) => `<button type="button" class="mood${mood === m.id ? ' on' : ''}" role="radio" aria-checked="${mood === m.id}" data-mood="${m.id}"><span>${m.emoji}</span><small>${m.label}</small></button>`).join('')}
          </div>
          <textarea class="textarea" id="rv-note" placeholder="สิ่งที่ได้เรียนรู้ หรือเรื่องดี ๆ วันนี้…" maxlength="1000">${esc(day.note || '')}</textarea>
        </section>
      </div>`,
    footer: `<span class="spacer"></span>
      <button class="btn btn-ghost" data-close type="button">ไว้ทีหลัง</button>
      <button class="btn btn-primary" data-finish type="button">✨ ปิดวัน</button>`,
    onMount(root, close) {
      requestAnimationFrame(() => {
        const bar = $('.rv-prog > span', root);
        bar.style.setProperty('--p', '0%');
        requestAnimationFrame(() => bar.style.setProperty('--p', pct + '%'));
      });
      $('#rv-move', root)?.addEventListener('click', (e) => {
        const li = e.target.closest('[data-move]');
        if (!li) return;
        const id = li.dataset.move;
        move.has(id) ? move.delete(id) : move.add(id);
        const c = li.querySelector('[data-check]');
        c.classList.toggle('checked', move.has(id));
        c.classList.remove('animate');
        void c.offsetWidth;
        c.classList.add('animate');
      });
      root.querySelector('.moods').addEventListener('click', (e) => {
        const b = e.target.closest('[data-mood]');
        if (!b) return;
        mood = Number(b.dataset.mood);
        $$('.mood', root).forEach((x) => {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-checked', x === b);
        });
      });
      root.addEventListener('click', (e) => {
        const n = e.target.closest('[data-note]');
        if (n) {
          close();
          openMeeting(n.dataset.note, key);
        }
      });
      $('[data-finish]', root).addEventListener('click', () => {
        const note = $('#rv-note', root).value.trim();
        store.batch((state) => {
          state.tasks.forEach((t) => {
            if (move.has(t.id) && !t.done) t.due = tomorrow;
          });
          state.days[key] = { focus: [], ...(state.days[key] || {}), reviewed: true, mood, note };
        });
        if (focus.length && focusDone === focus.length) celebrate();
        toast(
          move.size ? `ปิดวันแล้ว · เลื่อน ${move.size} งานไปพรุ่งนี้ พักผ่อนนะ 🌙` : 'ปิดวันแล้ว พักผ่อนให้เต็มที่นะ 🌙',
          { icon: '✨', duration: 4000 },
        );
        close();
      });
    },
  });
}

export function star(on) {
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"
    fill="${on ? 'var(--gold)' : 'none'}" stroke="${on ? 'var(--gold)' : 'currentColor'}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}
