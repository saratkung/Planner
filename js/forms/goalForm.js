// ==========================================================
// goalForm.js — create / edit a goal with milestones
// ==========================================================
import { store } from '../core/store.js';
import { esc, uid, $, $$ } from '../core/utils.js';
import { CATEGORIES, COLORS } from '../core/constants.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { removeWithUndo } from '../core/actions.js';

const msRow = (m = { id: uid(), title: '', done: false }) => `
  <div class="milestone-edit" data-ms="${m.id}" data-done="${m.done ? 1 : 0}" data-doneat="${m.doneAt || ''}">
    <span class="dot" style="--c:${m.done ? 'var(--good)' : 'var(--border-strong)'}"></span>
    <input class="input" value="${esc(m.title)}" placeholder="ขั้นตอนย่อย เช่น ศึกษาข้อมูล" maxlength="120" />
    <button type="button" class="icon-btn sm danger" data-rm aria-label="ลบขั้นตอน">${icon('x')}</button>
  </div>`;

export function openGoalForm(goal = null) {
  const isEdit = !!goal;
  const g = {
    title: '', description: '', category: 'work', deadline: '', color: COLORS[0], milestones: [],
    ...(goal || {}),
  };
  let color = g.color;

  const body = `
    <form class="form-grid" id="goal-form" novalidate>
      <div class="field">
        <label for="gf-title">เป้าหมาย</label>
        <input class="input" id="gf-title" name="title" placeholder="เช่น อ่านหนังสือให้ได้ 24 เล่มในปีนี้" value="${esc(g.title)}" autofocus maxlength="140" />
      </div>
      <div class="field">
        <label for="gf-desc">ทำไมเป้าหมายนี้สำคัญ?</label>
        <textarea class="textarea" id="gf-desc" name="description" placeholder="แรงบันดาลใจ / รายละเอียด">${esc(g.description)}</textarea>
      </div>
      <div class="row">
        <div class="field">
          <label for="gf-cat">ด้านของชีวิต</label>
          <select class="select" id="gf-cat" name="category">
            ${CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === g.category ? 'selected' : ''}>${c.emoji} ${c.label}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="gf-deadline">กำหนดเสร็จ</label>
          <input class="input" type="date" id="gf-deadline" name="deadline" value="${g.deadline || ''}" />
        </div>
      </div>
      <div class="field">
        <span class="field-label">สี</span>
        <div class="swatches" id="gf-colors">
          ${COLORS.map((c) => `<button type="button" class="swatch ${c === color ? 'active' : ''}" style="--c:${c}" data-color="${c}" aria-label="สี ${c}"></button>`).join('')}
        </div>
      </div>
      <div class="field">
        <span class="field-label">ขั้นตอนสู่ความสำเร็จ (Milestones)</span>
        <div class="form-grid" id="gf-ms" style="gap:8px">${g.milestones.map(msRow).join('')}</div>
        <button type="button" class="btn btn-outline btn-sm" id="gf-add-ms" style="align-self:flex-start">${icon('plus')}เพิ่มขั้นตอน</button>
      </div>
    </form>`;

  const footer = `
    ${isEdit ? `<button class="btn btn-danger" type="button" data-del>${icon('trash')}ลบ</button>` : ''}
    <span class="spacer"></span>
    <button class="btn btn-ghost" type="button" data-close>ยกเลิก</button>
    <button class="btn btn-primary" type="submit" form="goal-form">${icon('check')}${isEdit ? 'บันทึก' : 'สร้างเป้าหมาย'}</button>`;

  openModal({
    title: isEdit ? '✏️ แก้ไขเป้าหมาย' : '🎯 ตั้งเป้าหมายใหม่',
    body,
    footer,
    onMount(root, close) {
      const form = $('#goal-form', root);
      const list = $('#gf-ms', root);

      const addRow = (focus = true) => {
        list.insertAdjacentHTML('beforeend', msRow());
        if (focus) list.lastElementChild.querySelector('input').focus();
      };
      if (!g.milestones.length) {
        addRow(false);
        addRow(false);
      }
      $('#gf-add-ms', root).addEventListener('click', () => addRow());
      list.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rm]');
        if (rm) rm.closest('.milestone-edit').remove();
      });
      list.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addRow();
        }
      });

      $('#gf-colors', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]');
        if (!b) return;
        color = b.dataset.color;
        root.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === b));
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const title = String(fd.get('title')).trim();
        const titleEl = $('#gf-title', root);
        if (!title) {
          titleEl.classList.add('invalid', 'shake');
          setTimeout(() => titleEl.classList.remove('shake'), 400);
          titleEl.focus();
          return;
        }
        const milestones = $$('.milestone-edit', list)
          .map((row) => ({
            id: row.dataset.ms,
            title: row.querySelector('input').value.trim(),
            done: row.dataset.done === '1',
            doneAt: row.dataset.doneat ? Number(row.dataset.doneat) : null,
          }))
          .filter((m) => m.title);
        const data = {
          title,
          description: String(fd.get('description')).trim(),
          category: fd.get('category'),
          deadline: fd.get('deadline') || '',
          color,
          milestones,
        };
        if (isEdit) {
          store.update('goals', goal.id, data);
          toast('บันทึกเป้าหมายแล้ว', { icon: '💾' });
        } else {
          store.add('goals', data);
          toast('ตั้งเป้าหมายใหม่แล้ว ลุยเลย!', { icon: '🎯' });
        }
        close();
      });

      $('[data-del]', root)?.addEventListener('click', () => {
        close();
        const node = document.querySelector(`[data-goal="${goal.id}"]`);
        removeWithUndo('goals', goal.id, node);
      });
    },
  });
}
