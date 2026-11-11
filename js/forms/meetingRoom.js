// ==========================================================
// meetingRoom.js — หน้าต่างการประชุม: รายละเอียด, วาระ, บันทึก, สิ่งที่ต้องทำต่อ
// บันทึกแยกตามวันที่ (นัดประชุมแบบทำซ้ำ มีบันทึกของแต่ละครั้ง)
// ==========================================================
import { store } from '../core/store.js';
import { esc, formatDate, toKey, addDays, fromKey, relativeDay, durationLabel, timeToMin, $ } from '../core/utils.js';
import { minutesOf, actionItems, meetingStatus, minutesUntil } from '../core/selectors.js';
import { toggleTask } from '../core/actions.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { checkbox } from '../ui/widgets.js';
import { openEventForm } from './eventForm.js';

export function statusLabel(m) {
  const st = meetingStatus(m);
  if (st === 'live') return '<span class="tag live-pill"><i></i>กำลังประชุม</span>';
  if (st === 'past') return '<span class="tag">จบแล้ว</span>';
  const n = minutesUntil(m);
  if (n <= 60) return `<span class="tag warn">${icon('clock')}อีก ${n} นาที</span>`;
  if (m.occurrence === toKey(new Date())) return `<span class="tag accent">${icon('clock')}วันนี้ ${m.start}</span>`;
  return `<span class="tag">${icon('calendar')}${relativeDay(m.occurrence)}</span>`;
}

export function linkLabel(url) {
  if (/zoom\./i.test(url)) return 'Zoom';
  if (/meet\.google/i.test(url)) return 'Google Meet';
  if (/teams\./i.test(url)) return 'Teams';
  return 'ลิงก์ประชุม';
}

/** openMeeting(eventId, dateKey) */
export function openMeeting(eventId, dateKey) {
  const ev0 = store.find('events', eventId);
  if (!ev0) return;
  let saveTimer = null;
  let dirtyNotes = null;
  let unsub = () => {};

  const flushNotes = () => {
    clearTimeout(saveTimer);
    if (dirtyNotes == null) return;
    store.setMinutes(eventId, dateKey, { notes: dirtyNotes }, { silent: true });
    dirtyNotes = null;
  };

  openModal({
    title: `👥 ${esc(ev0.title)}`,
    size: 640,
    body: '<div id="mr"></div>',
    footer: `
      <button class="btn btn-ghost btn-sm mr-foot-btn" type="button" data-edit>${icon('edit')}แก้ไขรายละเอียด</button>
      <span class="spacer"></span>
      <button class="btn btn-outline btn-sm mr-foot-btn" type="button" data-copy>${icon('copy')}คัดลอกสรุปประชุม</button>
      <button class="btn btn-primary btn-sm hide-mobile" type="button" data-close>${icon('check')}เสร็จ</button>`,
    onClose: () => {
      flushNotes();
      unsub();
      // ให้หน้าอื่นอัปเดตจำนวนบันทึก / สิ่งที่ต้องทำ
      store.setMinutes(eventId, dateKey, {});
    },
    onMount(root, close) {
      const host = $('#mr', root);

      const render = () => {
        const ev = store.find('events', eventId);
        if (!ev) return close();
        const occ = { ...ev, occurrence: dateKey };
        const min = minutesOf(ev, dateKey);
        const items = actionItems(eventId, dateKey);
        const len = timeToMin(ev.end) - timeToMin(ev.start);
        const notesEl = $('#mr-notes', host);
        const keepNotes = notesEl ? notesEl.value : min.notes;
        const hadFocus = notesEl && document.activeElement === notesEl;

        host.innerHTML = `
          <div class="mr">
            <div class="mr-when">
              <div class="mr-date" style="--c:${ev.color}">
                <b>${fromKey(dateKey).getDate()}</b><span>${formatDate(dateKey, { short: true, year: false }).split(' ')[1]}</span>
              </div>
              <div>
                <p class="mr-time">${formatDate(dateKey, { weekday: true, year: false })} · ${ev.start}–${ev.end}</p>
                <p class="muted">${durationLabel(len)}${ev.repeat !== 'none' ? ' · ประชุมประจำ' : ''}</p>
              </div>
              ${statusLabel(occ)}
            </div>

            <div class="mr-info">
              ${ev.link ? `<a class="btn btn-primary btn-sm join-btn" href="${esc(ev.link)}" target="_blank" rel="noopener">${icon('video')}เข้าร่วมผ่าน ${linkLabel(ev.link)}</a>` : ''}
              ${ev.location ? `<span class="tag">${icon('pin')}${esc(ev.location)}</span>` : ''}
            </div>

            ${ev.attendees.length ? `
              <div class="mr-section">
                <h4 class="section-title">${icon('users')} ผู้เข้าร่วม <span class="count">${ev.attendees.length}</span></h4>
                <div class="people">${ev.attendees.map((a, i) => `<span class="person" style="--i:${i}"><i style="--h:${hue(a)}">${esc(initial(a))}</i>${esc(a)}</span>`).join('')}</div>
              </div>` : ''}

            <div class="mr-section">
              <h4 class="section-title">${icon('list')} วาระการประชุม</h4>
              ${ev.agenda.length
                ? `<ul class="agenda-list">${ev.agenda
                    .map((a, i) => {
                      const done = min.agendaDone.includes(i);
                      return `<li class="milestone${done ? ' is-done' : ''}" data-agenda="${i}">${checkbox(done, { round: true, label: a })}<span>${esc(a)}</span></li>`;
                    })
                    .join('')}</ul>`
                : `<p class="muted mr-empty">ยังไม่มีวาระ · <button type="button" class="link-btn" data-edit>เพิ่มวาระ</button></p>`}
            </div>

            <div class="mr-section">
              <h4 class="section-title">${icon('note')} บันทึกการประชุม <span class="save-state" id="mr-save"></span></h4>
              <textarea class="textarea mr-notes" id="mr-notes" placeholder="จดประเด็นสำคัญ ข้อตกลง และการตัดสินใจ...">${esc(keepNotes)}</textarea>
            </div>

            <div class="mr-section">
              <h4 class="section-title">${icon('checkSquare')} สิ่งที่ต้องทำต่อ <span class="count">${items.length}</span></h4>
              <form class="ai-add" id="mr-ai">
                <input class="input" id="mr-ai-title" placeholder="เพิ่มสิ่งที่ต้องทำ แล้วกด Enter" maxlength="140" aria-label="สิ่งที่ต้องทำต่อ" />
                <input class="input" id="mr-ai-due" type="date" value="${toKey(addDays(fromKey(dateKey), 1))}" aria-label="กำหนดเสร็จ" />
                <button class="btn btn-outline" type="submit">${icon('plus')}<span class="sr-only">เพิ่ม</span></button>
              </form>
              ${items.length
                ? `<ul class="mini-tasks">${items
                    .map((t) => `<li class="mini-task${t.done ? ' is-done' : ''}" data-task="${t.id}">
                      ${checkbox(t.done, { round: true, label: t.title })}
                      <span class="mini-title">${esc(t.title)}</span>
                      ${t.due ? `<span class="tag">${relativeDay(t.due)}</span>` : ''}</li>`)
                    .join('')}</ul>`
                : '<p class="muted mr-empty">งานที่เพิ่มตรงนี้จะไปอยู่ในหน้า "งาน" ด้วย</p>'}
            </div>
          </div>`;

        const ta = $('#mr-notes', host);
        if (hadFocus) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      };

      unsub = store.subscribe(() => render());
      render();

      host.addEventListener('input', (e) => {
        if (e.target.id !== 'mr-notes') return;
        dirtyNotes = e.target.value;
        const st = $('#mr-save', host);
        st.textContent = 'กำลังบันทึก…';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          flushNotes();
          st.textContent = 'บันทึกแล้ว ✓';
        }, 600);
      });

      host.addEventListener('click', (e) => {
        if (e.target.closest('[data-edit]')) return editDetails();
        const check = e.target.closest('[data-check]');
        if (!check) return;
        const ag = check.closest('[data-agenda]');
        if (ag) {
          flushNotes();
          const i = Number(ag.dataset.agenda);
          const done = new Set(minutesOf(store.find('events', eventId), dateKey).agendaDone);
          done.has(i) ? done.delete(i) : done.add(i);
          check.classList.toggle('checked', done.has(i));
          check.classList.add('animate');
          ag.classList.toggle('is-done', done.has(i));
          setTimeout(() => store.setMinutes(eventId, dateKey, { agendaDone: [...done] }), 300);
          return;
        }
        const t = check.closest('[data-task]');
        if (t) {
          flushNotes();
          toggleTask(t.dataset.task, check);
        }
      });

      host.addEventListener('submit', (e) => {
        if (e.target.id !== 'mr-ai') return;
        e.preventDefault();
        const title = $('#mr-ai-title', host).value.trim();
        if (!title) return;
        flushNotes();
        const ev = store.find('events', eventId);
        store.add('tasks', {
          title, due: $('#mr-ai-due', host).value || null, time: '', notes: '', priority: 'medium',
          category: ev.category || 'work', goalId: null, meetingId: eventId, meetingDate: dateKey,
          done: false, doneAt: null,
        });
        toast('เพิ่มในรายการงานแล้ว', { icon: '✅' });
        requestAnimationFrame(() => $('#mr-ai-title', host)?.focus());
      });

      const editDetails = () => {
        flushNotes();
        close();
        openEventForm(store.find('events', eventId));
      };
      root.querySelector('.modal-foot [data-edit]').addEventListener('click', editDetails);

      root.querySelector('[data-copy]').addEventListener('click', async (e) => {
        flushNotes();
        const text = meetingSummary(store.find('events', eventId), dateKey);
        try {
          await navigator.clipboard.writeText(text);
          toast('คัดลอกสรุปประชุมแล้ว วางในแชทหรืออีเมลได้เลย', { icon: '📋' });
        } catch (_) {
          // บางแอปไม่ให้เขียนคลิปบอร์ด: แสดงข้อความให้เลือกคัดลอกเอง
          const ta = document.createElement('textarea');
          ta.className = 'textarea mr-copy';
          ta.value = text;
          ta.readOnly = true;
          host.prepend(ta);
          ta.select();
          toast('คัดลอกอัตโนมัติไม่ได้ เลือกข้อความด้านบนแล้วคัดลอกเองได้', { icon: 'ℹ️' });
        }
      });
    },
  });
}

/** Plain-text minutes for sharing in chat / email. */
export function meetingSummary(ev, key) {
  const min = minutesOf(ev, key);
  const items = actionItems(ev.id, key);
  const lines = [
    `📌 สรุปการประชุม: ${ev.title}`,
    `🗓️ ${formatDate(key, { weekday: true })} เวลา ${ev.start}–${ev.end}`,
  ];
  if (ev.location) lines.push(`📍 ${ev.location}`);
  if (ev.attendees.length) lines.push(`👥 ผู้เข้าร่วม: ${ev.attendees.join(', ')}`);
  if (ev.agenda.length) {
    lines.push('', 'วาระการประชุม');
    ev.agenda.forEach((a, i) => lines.push(`${min.agendaDone.includes(i) ? '✅' : '⬜'} ${a}`));
  }
  if (min.notes.trim()) lines.push('', 'บันทึก', min.notes.trim());
  if (items.length) {
    lines.push('', 'สิ่งที่ต้องทำต่อ');
    items.forEach((t) => lines.push(`${t.done ? '✅' : '•'} ${t.title}${t.due ? ` (ภายใน ${formatDate(t.due, { short: true, year: false })})` : ''}`));
  }
  return lines.join('\n');
}

export function initial(name) {
  const s = String(name).replace(/^(คุณ|พี่|น้อง)\s*/, '').trim();
  return [...s][0] || '?';
}

export function hue(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
