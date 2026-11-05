// ==========================================================
// taskForm.js — create / edit a task
// ==========================================================
import { store } from '../core/store.js';
import { esc, todayKey, $ } from '../core/utils.js';
import { CATEGORIES, PRIORITIES } from '../core/constants.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { segmented, bindSegmented } from '../ui/widgets.js';
import { removeWithUndo } from '../core/actions.js';

export function openTaskForm(task = null, defaults = {}) {
  const isEdit = !!task;
  const t = {
    title: '', notes: '', due: todayKey(), time: '', priority: 'medium',
    category: 'work', goalId: null, ...defaults, ...(task || {}),
  };
  const goals = store.state.goals;
  let prio = t.priority;

  const body = `
    <form class="form-grid" id="task-form" novalidate>
      <div class="field">
        <label for="tf-title">ชื่องาน</label>
        <input class="input" id="tf-title" name="title" placeholder="เช่น เตรียมสไลด์นำเสนอ" value="${esc(t.title)}" autofocus maxlength="140" />
      </div>
      <div class="row">
        <div class="field">
          <label for="tf-due">วันครบกำหนด</label>
          <input class="input" type="date" id="tf-due" name="due" value="${t.due || ''}" />
        </div>
        <div class="field">
          <label for="tf-time">เวลา (ไม่บังคับ)</label>
          <input class="input" type="time" id="tf-time" name="time" value="${t.time || ''}" />
        </div>
      </div>
      <div class="field">
        <span class="field-label">ความสำคัญ</span>
        ${segmented(
          PRIORITIES.map((p) => ({ id: p.id, label: p.label, icon: `<span class="dot" style="--c:${p.color}"></span>` })),
          prio,
          { name: 'prio', block: true },
        )}
      </div>
      <div class="row">
        <div class="field">
          <label for="tf-cat">หมวดหมู่</label>
          <select class="select" id="tf-cat" name="category">
            ${CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === t.category ? 'selected' : ''}>${c.emoji} ${c.label}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="tf-goal">เชื่อมกับเป้าหมาย</label>
          <select class="select" id="tf-goal" name="goalId">
            <option value="">— ไม่เชื่อม —</option>
            ${goals.map((g) => `<option value="${g.id}" ${g.id === t.goalId ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="tf-notes">โน้ต</label>
        <textarea class="textarea" id="tf-notes" name="notes" placeholder="รายละเอียดเพิ่มเติม...">${esc(t.notes)}</textarea>
      </div>
    </form>`;

  const footer = `
    ${isEdit ? `<button class="btn btn-danger" type="button" data-del>${icon('trash')}ลบ</button>` : ''}
    <span class="spacer"></span>
    <button class="btn btn-ghost" type="button" data-close>ยกเลิก</button>
    <button class="btn btn-primary" type="submit" form="task-form">${icon('check')}${isEdit ? 'บันทึก' : 'เพิ่มงาน'}</button>`;

  openModal({
    title: isEdit ? '✏️ แก้ไขงาน' : '✅ เพิ่มงานใหม่',
    body,
    footer,
    onMount(root, close) {
      const form = $('#task-form', root);
      bindSegmented($('[data-seg="prio"]', root), (v) => (prio = v));

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const title = String(fd.get('title')).trim();
        const titleEl = $('#tf-title', root);
        if (!title) {
          titleEl.classList.add('invalid', 'shake');
          setTimeout(() => titleEl.classList.remove('shake'), 400);
          titleEl.focus();
          return;
        }
        const data = {
          title,
          due: fd.get('due') || null,
          time: fd.get('time') || '',
          priority: prio,
          category: fd.get('category'),
          goalId: fd.get('goalId') || null,
          notes: String(fd.get('notes')).trim(),
        };
        if (isEdit) {
          store.update('tasks', task.id, data);
          toast('บันทึกการแก้ไขแล้ว', { icon: '💾' });
        } else {
          store.add('tasks', { ...data, done: false, doneAt: null });
          toast('เพิ่มงานใหม่แล้ว', { icon: '✅' });
        }
        close();
      });

      $('[data-del]', root)?.addEventListener('click', () => {
        close();
        const node = document.querySelector(`[data-task="${task.id}"]`);
        removeWithUndo('tasks', task.id, node);
      });
    },
  });
}
