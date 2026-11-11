// ==========================================================
// eventForm.js — create / edit a calendar event (time block)
// ==========================================================
import { store } from '../core/store.js';
import { esc, todayKey, timeToMin, minToTime, durationLabel, $ } from '../core/utils.js';
import { CATEGORIES, COLORS, REPEATS } from '../core/constants.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { removeWithUndo } from '../core/actions.js';
import { segmented, bindSegmented } from '../ui/widgets.js';

export function openEventForm(ev = null, defaults = {}) {
  const isEdit = !!ev;
  const e0 = {
    title: '', date: todayKey(), start: '09:00', end: '10:00', color: COLORS[0],
    category: 'work', repeat: 'none', notes: '', isMeeting: false, location: '', link: '',
    attendees: [], agenda: [], ...defaults, ...(ev || {}),
  };
  let isMeeting = !!e0.isMeeting;
  if (!defaults.end && defaults.start && !ev) e0.end = minToTime(timeToMin(defaults.start) + 60);
  let color = e0.color;

  const body = `
    <form class="form-grid" id="event-form" novalidate>
      ${segmented(
        [
          { id: 'event', label: 'กิจกรรม / นัดหมาย', icon: icon('calendar') },
          { id: 'meeting', label: 'การประชุม', icon: icon('users') },
        ],
        isMeeting ? 'meeting' : 'event',
        { name: 'kind', block: true },
      )}
      <div class="field">
        <label for="ef-title" id="ef-title-label">${isMeeting ? 'หัวข้อการประชุม' : 'ชื่อนัดหมาย / กิจกรรม'}</label>
        <input class="input" id="ef-title" name="title" placeholder="${isMeeting ? 'เช่น ประชุมสรุปงานประจำเดือน' : 'เช่น ไปหาหมอฟัน'}" value="${esc(e0.title)}" autofocus maxlength="140" />
      </div>
      <div class="field">
        <label for="ef-date">วันที่</label>
        <input class="input" type="date" id="ef-date" name="date" value="${e0.date}" required />
      </div>
      <div class="row">
        <div class="field">
          <label for="ef-start">เริ่ม</label>
          <input class="input" type="time" id="ef-start" name="start" value="${e0.start}" required />
        </div>
        <div class="field">
          <label for="ef-end">สิ้นสุด</label>
          <input class="input" type="time" id="ef-end" name="end" value="${e0.end}" required />
        </div>
      </div>
      <p class="kbd-hint" id="ef-dur"></p>
      <div class="meeting-fields ${isMeeting ? 'open' : ''}" id="ef-meeting"><div class="form-grid">
        <div class="row">
          <div class="field">
            <label for="ef-location">สถานที่</label>
            <input class="input" id="ef-location" name="location" placeholder="เช่น ห้องประชุม 3" value="${esc(e0.location)}" maxlength="120" />
          </div>
          <div class="field">
            <label for="ef-link">ลิงก์ประชุมออนไลน์</label>
            <input class="input" id="ef-link" name="link" type="url" inputmode="url" placeholder="Zoom / Meet / Teams" value="${esc(e0.link)}" maxlength="400" />
          </div>
        </div>
        <div class="field">
          <label for="ef-attendees">ผู้เข้าร่วม <span class="muted">(คั่นด้วยเครื่องหมายจุลภาค)</span></label>
          <input class="input" id="ef-attendees" name="attendees" placeholder="เช่น ต้น, ฝน, ทีมการตลาด" value="${esc(e0.attendees.join(', '))}" />
        </div>
        <div class="field">
          <label for="ef-agenda">วาระการประชุม <span class="muted">(บรรทัดละ 1 หัวข้อ)</span></label>
          <textarea class="textarea" id="ef-agenda" name="agenda" placeholder="สรุปงานที่ผ่านมา&#10;ปัญหาที่ติดอยู่&#10;แผนงานถัดไป">${esc(e0.agenda.join('\n'))}</textarea>
        </div>
      </div></div>
      <div class="row">
        <div class="field">
          <label for="ef-cat">หมวดหมู่</label>
          <select class="select" id="ef-cat" name="category">
            ${CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === e0.category ? 'selected' : ''}>${c.emoji} ${c.label}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="ef-repeat">ทำซ้ำ</label>
          <select class="select" id="ef-repeat" name="repeat">
            ${REPEATS.map((r) => `<option value="${r.id}" ${r.id === e0.repeat ? 'selected' : ''}>${r.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <span class="field-label">สี</span>
        <div class="swatches" id="ef-colors">
          ${COLORS.map((c) => `<button type="button" class="swatch ${c === color ? 'active' : ''}" style="--c:${c}" data-color="${c}" aria-label="สี ${c}"></button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label for="ef-notes">โน้ต</label>
        <textarea class="textarea" id="ef-notes" name="notes" placeholder="สถานที่ ลิงก์ประชุม หรือรายละเอียด">${esc(e0.notes)}</textarea>
      </div>
    </form>`;

  const footer = `
    ${isEdit ? `<button class="btn btn-danger" type="button" data-del>${icon('trash')}ลบ</button>` : ''}
    <span class="spacer"></span>
    <button class="btn btn-ghost" type="button" data-close>ยกเลิก</button>
    <button class="btn btn-primary" type="submit" form="event-form">${icon('check')}${isEdit ? 'บันทึก' : 'เพิ่มนัดหมาย'}</button>`;

  openModal({
    title: isEdit ? (isMeeting ? '✏️ แก้ไขการประชุม' : '✏️ แก้ไขนัดหมาย') : isMeeting ? '👥 นัดประชุม' : '📅 เพิ่มนัดหมาย',
    body,
    footer,
    onMount(root, close) {
      const form = $('#event-form', root);
      const startEl = $('#ef-start', root);
      const endEl = $('#ef-end', root);
      const dur = $('#ef-dur', root);
      const titleLabel = $('#ef-title-label', root);
      bindSegmented($('[data-seg="kind"]', root), (v) => {
        isMeeting = v === 'meeting';
        $('#ef-meeting', root).classList.toggle('open', isMeeting);
        titleLabel.textContent = isMeeting ? 'หัวข้อการประชุม' : 'ชื่อนัดหมาย / กิจกรรม';
        $('#ef-title', root).placeholder = isMeeting ? 'เช่น ประชุมสรุปงานประจำเดือน' : 'เช่น ไปหาหมอฟัน';
      });

      const updateDur = () => {
        const d = timeToMin(endEl.value) - timeToMin(startEl.value);
        dur.textContent = d > 0 ? `⏱️ ระยะเวลา ${durationLabel(d)}` : '⚠️ เวลาสิ้นสุดต้องหลังเวลาเริ่ม';
        dur.style.color = d > 0 ? '' : 'var(--bad)';
      };
      let lastStart = timeToMin(startEl.value);
      startEl.addEventListener('change', () => {
        // keep the same duration when start moves
        const len = timeToMin(endEl.value) - lastStart;
        lastStart = timeToMin(startEl.value);
        if (len > 0) endEl.value = minToTime(lastStart + len);
        updateDur();
      });
      endEl.addEventListener('input', updateDur);
      updateDur();

      $('#ef-colors', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]');
        if (!b) return;
        color = b.dataset.color;
        root.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === b));
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const title = String(fd.get('title')).trim();
        const titleEl = $('#ef-title', root);
        if (!title) {
          titleEl.classList.add('invalid', 'shake');
          setTimeout(() => titleEl.classList.remove('shake'), 400);
          titleEl.focus();
          return;
        }
        if (timeToMin(fd.get('end')) <= timeToMin(fd.get('start'))) {
          endEl.classList.add('invalid', 'shake');
          setTimeout(() => endEl.classList.remove('shake'), 400);
          return;
        }
        const data = {
          title,
          date: fd.get('date') || todayKey(),
          start: fd.get('start'),
          end: fd.get('end'),
          category: fd.get('category'),
          repeat: fd.get('repeat'),
          color,
          notes: String(fd.get('notes')).trim(),
          isMeeting,
          location: isMeeting ? String(fd.get('location') || '').trim() : e0.location,
          link: isMeeting ? normalizeLink(fd.get('link')) : e0.link,
          attendees: isMeeting ? splitList(fd.get('attendees'), /[,\n]/) : e0.attendees,
          agenda: isMeeting ? splitList(fd.get('agenda'), /\n/) : e0.agenda,
        };
        if (!isEdit) data.minutes = {};
        if (isEdit) {
          store.update('events', ev.id, data);
          toast('บันทึกนัดหมายแล้ว', { icon: '💾' });
        } else {
          store.add('events', data);
          toast(isMeeting ? 'นัดประชุมแล้ว' : 'เพิ่มนัดหมายแล้ว', { icon: isMeeting ? '👥' : '📅' });
        }
        close();
      });

      $('[data-del]', root)?.addEventListener('click', () => {
        close();
        const node = document.querySelector(`[data-event="${ev.id}"]`);
        removeWithUndo('events', ev.id, node);
      });
    },
  });
}

function splitList(v, sep) {
  return String(v || '')
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeLink(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}
