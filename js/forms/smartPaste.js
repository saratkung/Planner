// ==========================================================
// smartPaste.js — วางข้อความ แล้วแปลงเป็น ประชุม / นัดหมาย / งาน
// ตรวจทานและแก้ไขได้ก่อนบันทึก (ประมวลผลในเครื่องทั้งหมด)
// ==========================================================
import { store } from '../core/store.js';
import { esc, formatDate, timeToMin, todayKey, $, $$ } from '../core/utils.js';
import { parseText } from '../core/parse.js';
import { eventsOn } from '../core/selectors.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { confetti } from '../ui/confetti.js';

const TYPES = [
  { id: 'meeting', label: 'ประชุม', emoji: '👥' },
  { id: 'event', label: 'นัดหมาย', emoji: '📅' },
  { id: 'task', label: 'งาน', emoji: '✅' },
];
const COLOR = { meeting: '#5b4bc4', event: '#0ea5e9' };
const SAMPLE = `ขอเชิญประชุมคณะทำงาน ในวันศุกร์นี้ เวลา 13.30-15.00 น. ณ ห้องประชุม 2
พรุ่งนี้ 9 โมง คุยคดีกับทีม zoom https://zoom.us/j/123
ฝากส่งรายงานสรุปภายในวันที่ 20 นี้ ด่วน`;

function conflicts(it) {
  if (it.type === 'task' || !it.date || !it.start) return [];
  const s = timeToMin(it.start);
  const e = timeToMin(it.end || it.start) || s + 60;
  return eventsOn(it.date).filter((ev) => !ev.allDay && timeToMin(ev.start) < e && timeToMin(ev.end) > s);
}

function duplicateOf(it) {
  const t = it.title.trim();
  if (!t) return null;
  if (it.type === 'task') return store.state.tasks.find((x) => !x.done && x.title.trim() === t && x.due === it.date) || null;
  return eventsOn(it.date).find((x) => x.title.trim() === t) || null;
}

/** openSmartPaste(text?, { navigate }) */
export function openSmartPaste(initial = '', { navigate } = {}) {
  let items = [];
  let timer = null;
  const canRead = !!navigator.clipboard?.readText;

  openModal({
    title: '📋 วางข้อความ → แปลงอัตโนมัติ',
    size: 680,
    body: `
      <div class="sp">
        <div class="sp-input">
          <textarea class="textarea" id="sp-text" rows="5" placeholder="วางข้อความจาก LINE อีเมล หรือหนังสือเชิญประชุม…&#10;เช่น “ขอเชิญประชุม วันศุกร์นี้ 13.30 น. ณ ห้องประชุม 2”">${esc(initial)}</textarea>
          <div class="sp-tools">
            ${canRead ? `<button type="button" class="btn btn-outline btn-sm" data-sp="clip">${icon('clipboard')}วางจากคลิปบอร์ด</button>` : ''}
            <button type="button" class="btn btn-ghost btn-sm" data-sp="sample">${icon('sparkles')}ลองตัวอย่าง</button>
            <button type="button" class="btn btn-ghost btn-sm" data-sp="clear">${icon('x')}ล้าง</button>
            <span class="sp-private">🔒 ประมวลผลในเครื่อง ไม่ส่งข้อความไปที่ไหน</span>
          </div>
        </div>
        <div id="sp-results" class="sp-results" aria-live="polite"></div>
      </div>`,
    footer: `<span class="sp-count" id="sp-count"></span><span class="spacer"></span>
      <button class="btn btn-ghost" data-close type="button">ยกเลิก</button>
      <button class="btn btn-primary" data-sp="save" type="button" disabled>${icon('check')}<span>เพิ่มรายการ</span></button>`,
    onMount(root, close) {
      const ta = $('#sp-text', root);
      const results = $('#sp-results', root);
      const saveBtn = $('[data-sp="save"]', root);

      const parse = () => {
        items = parseText(ta.value).map((it) => ({ ...it, include: true }));
        render(true);
      };

      const updateFooter = () => {
        const n = items.filter((x) => x.include).length;
        saveBtn.disabled = !n;
        saveBtn.querySelector('span').textContent = n ? `เพิ่ม ${n} รายการ` : 'เพิ่มรายการ';
        $('#sp-count', root).textContent = items.length ? `พบ ${items.length} รายการ` : '';
      };

      const card = (it, i, animate) => {
        const conf = conflicts(it);
        const dup = duplicateOf(it);
        const isTask = it.type === 'task';
        const found = [
          it.found.date && `📅 ${esc(it.found.date)}`,
          it.found.time && `⏰ ${esc(it.found.time)}`,
          it.found.location && `📍 ${esc(it.found.location)}`,
          it.found.link && '🔗 ลิงก์ประชุม',
          it.attendees.length && `👥 ${it.attendees.length} คน`,
          it.agenda.length && `📝 ${it.agenda.length} วาระ`,
        ].filter(Boolean);
        return `
          <article class="sp-item${it.include ? '' : ' off'}${animate ? ' enter' : ''}" data-i="${i}" style="--i:${i};--c:${COLOR[it.type] || 'var(--gold)'}">
            <div class="sp-head">
              <label class="switch-row sp-inc" title="เพิ่มรายการนี้">
                <input type="checkbox" data-f="include" ${it.include ? 'checked' : ''} />
                <span class="switch" aria-hidden="true"></span>
              </label>
              <div class="sp-types" role="radiogroup" aria-label="ประเภท">
                ${TYPES.map((t) => `<button type="button" role="radio" aria-checked="${it.type === t.id}" class="sp-type${it.type === t.id ? ' on' : ''}" data-type="${t.id}">${t.emoji} ${t.label}</button>`).join('')}
              </div>
            </div>
            <input class="input spi-title" data-f="title" value="${esc(it.title)}" placeholder="ชื่อรายการ" maxlength="140" aria-label="ชื่อรายการ" />
            <div class="sp-row">
              <label class="sp-field"><span>${isTask ? 'กำหนดเสร็จ' : 'วันที่'}</span>
                <input class="input" type="date" data-f="date" value="${it.date}" /></label>
              <label class="sp-field"><span>${isTask ? 'เวลา (ถ้ามี)' : 'เริ่ม'}</span>
                <input class="input" type="time" data-f="start" value="${it.start}" /></label>
              ${isTask ? '' : `<label class="sp-field"><span>ถึง</span><input class="input" type="time" data-f="end" value="${it.end}" /></label>`}
            </div>
            ${isTask ? '' : `
            <div class="sp-row">
              <label class="sp-field grow"><span>สถานที่</span>
                <input class="input" data-f="location" value="${esc(it.location)}" placeholder="—" /></label>
              ${it.type === 'meeting' ? `<label class="sp-field grow"><span>ลิงก์ประชุม</span>
                <input class="input" data-f="link" value="${esc(it.link)}" placeholder="—" inputmode="url" /></label>` : ''}
            </div>`}
            ${found.length ? `<div class="sp-found">${found.map((f) => `<span class="tag">${f}</span>`).join('')}</div>` : ''}
            ${it.warnings.length || conf.length || dup ? `<div class="sp-warn">
              ${it.warnings.map((w) => `<span class="tag warn">${icon('alert')}${esc(w)}</span>`).join('')}
              ${conf.map((c) => `<span class="tag bad">${icon('clock')}ชนกับ ${esc(c.start)}–${esc(c.end)} ${esc(c.title)}</span>`).join('')}
              ${dup ? `<span class="tag bad">${icon('copy')}อาจซ้ำกับ “${esc(dup.title)}” ที่มีอยู่แล้ว</span>` : ''}
            </div>` : ''}
          </article>`;
      };

      const render = (animate = false) => {
        if (!ta.value.trim()) {
          results.innerHTML = `<div class="sp-empty"><span>✨</span><p>วางข้อความด้านบน แล้วระบบจะแยกเป็น ประชุม นัดหมาย หรืองาน ให้อัตโนมัติ</p></div>`;
          items = [];
        } else results.innerHTML = items.map((it, i) => card(it, i, animate)).join('');
        updateFooter();
      };

      const rerenderCard = (i) => {
        const old = results.querySelector(`[data-i="${i}"]`);
        const focused = document.activeElement?.dataset?.f;
        old.outerHTML = card(items[i], i, false);
        if (focused) results.querySelector(`[data-i="${i}"] [data-f="${focused}"]`)?.focus();
        updateFooter();
      };

      ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(parse, 250);
      });

      results.addEventListener('click', (e) => {
        const tb = e.target.closest('[data-type]');
        if (!tb) return;
        const i = Number(tb.closest('[data-i]').dataset.i);
        const it = items[i];
        it.type = tb.dataset.type;
        if (it.type !== 'task' && !it.start) {
          it.start = '09:00';
          it.end = '10:00';
        }
        if (it.type !== 'task' && it.start && !it.end) {
          const s = timeToMin(it.start) + 60;
          it.end = `${String(Math.floor(s / 60) % 24).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        }
        rerenderCard(i);
        results.querySelector(`[data-i="${i}"]`)?.classList.add('flip');
      });

      results.addEventListener('change', (e) => {
        const f = e.target.dataset.f;
        if (!f) return;
        const i = Number(e.target.closest('[data-i]').dataset.i);
        items[i][f] = f === 'include' ? e.target.checked : e.target.value;
        if (f === 'start' && items[i].end && items[i].end <= items[i].start) {
          const s = timeToMin(items[i].start) + 60;
          items[i].end = `${String(Math.floor(s / 60) % 24).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        }
        if (['include', 'date', 'start', 'end', 'title'].includes(f)) rerenderCard(i);
      });
      results.addEventListener('input', (e) => {
        const f = e.target.dataset.f;
        if (!f || f === 'include') return;
        const i = Number(e.target.closest('[data-i]').dataset.i);
        items[i][f] = e.target.value;
      });

      root.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-sp]')?.dataset.sp;
        if (act === 'clip') {
          try {
            const t = await navigator.clipboard.readText();
            if (t) {
              ta.value = t;
              parse();
            } else toast('คลิปบอร์ดว่างอยู่', { icon: 'ℹ️' });
          } catch (_) {
            toast('อ่านคลิปบอร์ดไม่ได้ ให้กดค้างในช่องแล้วเลือก "วาง" แทน', { icon: 'ℹ️' });
            ta.focus();
          }
        }
        if (act === 'sample') {
          ta.value = SAMPLE;
          parse();
        }
        if (act === 'clear') {
          ta.value = '';
          parse();
          ta.focus();
        }
        if (act === 'save') save(e.target.closest('button'));
      });

      const save = (btn) => {
        const chosen = items.filter((x) => x.include && x.title.trim());
        if (!chosen.length) return;
        for (const it of chosen) {
          if (it.type !== 'task' && it.end && it.end <= it.start) {
            toast(`“${it.title}” เวลาสิ้นสุดต้องหลังเวลาเริ่ม`, { icon: '⚠️' });
            return;
          }
        }
        const counts = { meeting: 0, event: 0, task: 0 };
        chosen.forEach((it) => {
          counts[it.type]++;
          if (it.type === 'task') {
            store.add('tasks', {
              title: it.title.trim(), due: it.date || null, time: it.start || '', notes: it.notes,
              priority: it.priority, category: 'work', goalId: null, meetingId: null, done: false, doneAt: null,
            });
          } else {
            store.add('events', {
              title: it.title.trim(), date: it.date || todayKey(), start: it.start || '09:00', end: it.end || '10:00',
              color: COLOR[it.type], category: 'work', repeat: 'none', notes: it.notes,
              isMeeting: it.type === 'meeting', location: it.location || '', link: it.link || '',
              attendees: it.type === 'meeting' ? it.attendees : [], agenda: it.type === 'meeting' ? it.agenda : [],
              minutes: {},
            });
          }
        });
        const r = btn.getBoundingClientRect();
        confetti({ x: r.left + r.width / 2, y: r.top, count: 36, power: 8 });
        const parts = [
          counts.meeting && `ประชุม ${counts.meeting}`,
          counts.event && `นัดหมาย ${counts.event}`,
          counts.task && `งาน ${counts.task}`,
        ].filter(Boolean);
        const go = counts.meeting ? 'meetings' : counts.event ? 'schedule' : 'tasks';
        toast(`เพิ่ม ${parts.join(' · ')} แล้ว`, {
          icon: '✨',
          action: 'ดู',
          duration: 5000,
          onAction: () => (navigate ? navigate(go) : (location.hash = go)),
        });
        close();
      };

      if (initial) parse();
      else render();
      if (!initial) setTimeout(() => ta.focus(), 50);
    },
  });
}

/** ตัวช่วย: วันที่ที่อ่านง่าย (ใช้ในข้อความแจ้งเตือน) */
export const prettyDate = (k) => formatDate(k, { weekday: true, short: true, year: false });
