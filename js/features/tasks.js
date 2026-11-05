// ==========================================================
// tasks.js — To-Do list with filters, groups, quick add
// ==========================================================
import { store } from '../core/store.js';
import { esc, todayKey, toKey, addDays, diffDays, relativeDay, enterTracker, $ } from '../core/utils.js';
import { CATEGORIES, category, priority } from '../core/constants.js';
import { isOverdue, sortTasks } from '../core/selectors.js';
import { toggleTask, removeWithUndo } from '../core/actions.js';
import { icon } from '../ui/icons.js';
import { checkbox, emptyState, segmented, bindSegmented, bar, animateMeters, meterMemory, moveSegIndicator } from '../ui/widgets.js';
import { openTaskForm } from '../forms/taskForm.js';
import { toast } from '../ui/toast.js';

const FILTERS = [
  { id: 'today', label: 'วันนี้' },
  { id: 'upcoming', label: 'กำลังจะถึง' },
  { id: 'all', label: 'ยังไม่เสร็จ' },
  { id: 'done', label: 'เสร็จแล้ว' },
];

function groupOf(t) {
  if (!t.due) return 'none';
  const n = diffDays(todayKey(), t.due);
  if (n < 0) return t.done ? 'past' : 'overdue';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n <= 7) return 'week';
  return 'later';
}
const GROUPS = [
  { id: 'overdue', label: 'เลยกำหนด', emoji: '⚠️' },
  { id: 'today', label: 'วันนี้', emoji: '☀️' },
  { id: 'tomorrow', label: 'พรุ่งนี้', emoji: '🌤️' },
  { id: 'week', label: '7 วันข้างหน้า', emoji: '📆' },
  { id: 'later', label: 'ภายหลัง', emoji: '🗂️' },
  { id: 'none', label: 'ไม่มีกำหนด', emoji: '📝' },
  { id: 'past', label: 'ก่อนหน้านี้', emoji: '🕘' },
];

export default {
  id: 'tasks',
  label: 'งาน',
  icon: 'checkSquare',
  subtitle: () => {
    const open = store.state.tasks.filter((t) => !t.done).length;
    return `งานที่ยังไม่เสร็จ ${open} งาน`;
  },

  mount(root) {
    const track = enterTracker();
    const mem = meterMemory();
    let filter = 'today';
    let cat = 'all';
    let query = '';

    root.innerHTML = `
      <div class="tasks-view">
        <div class="card tasks-top">
          <form class="quick-input big" id="task-quick">
            ${icon('plus')}
            <input class="input" id="task-quick-input" placeholder="มีอะไรต้องทำ? พิมพ์แล้วกด Enter (ลงท้าย ! = สำคัญ)" maxlength="140" aria-label="เพิ่มงานอย่างรวดเร็ว" />
            <button class="btn btn-primary" type="submit">เพิ่ม</button>
            <button class="icon-btn" type="button" id="task-more" aria-label="เพิ่มแบบละเอียด" title="เพิ่มแบบละเอียด">${icon('note')}</button>
          </form>
          <div class="tasks-progress" id="tasks-progress"></div>
        </div>
        <div class="tasks-toolbar">
          <div id="task-filter"></div>
          <div class="search">
            ${icon('list')}
            <input class="input" id="task-search" placeholder="ค้นหางาน..." aria-label="ค้นหางาน" />
          </div>
        </div>
        <div class="chips" id="task-cats"></div>
        <div id="task-list"></div>
      </div>`;

    const listEl = $('#task-list', root);

    const renderFilters = () => {
      const s = store.state.tasks;
      const today = todayKey();
      const counts = {
        today: s.filter((t) => !t.done && t.due && t.due <= today).length,
        upcoming: s.filter((t) => !t.done && t.due && t.due > today).length,
        all: s.filter((t) => !t.done).length,
        done: s.filter((t) => t.done).length,
      };
      const host = $('#task-filter', root);
      const existing = host.firstElementChild;
      if (existing) {
        // only update counts so the indicator stays smooth
        existing.querySelectorAll('button').forEach((b) => {
          b.querySelector('.seg-count').textContent = counts[b.dataset.value];
        });
        moveSegIndicator(existing);
        return;
      }
      host.innerHTML = segmented(FILTERS.map((f) => ({ ...f, count: counts[f.id] })), filter, { name: 'filter' });
      bindSegmented(host.firstElementChild, (v) => {
        filter = v;
        track.reset();
        renderList();
      });
    };

    const renderCats = () => {
      $('#task-cats', root).innerHTML = [
        `<button class="chip ${cat === 'all' ? 'active' : ''}" data-cat="all">ทุกหมวด</button>`,
        ...CATEGORIES.map(
          (c) => `<button class="chip ${cat === c.id ? 'active' : ''}" data-cat="${c.id}">${c.emoji} ${c.label}</button>`,
        ),
      ].join('');
    };

    const renderProgress = () => {
      const today = todayKey();
      const todays = store.state.tasks.filter((t) => t.due === today);
      const done = todays.filter((t) => t.done).length;
      const pct = todays.length ? Math.round((done / todays.length) * 100) : 0;
      $('#tasks-progress', root).innerHTML = `
        <div class="tp-text"><span>ความคืบหน้าวันนี้</span><b>${done}/${todays.length} งาน · ${pct}%</b></div>
        ${bar(pct, null, mem('p', pct))}`;
      animateMeters($('#tasks-progress', root));
    };

    const filtered = () => {
      const today = todayKey();
      let list = store.state.tasks;
      if (filter === 'today') list = list.filter((t) => (t.due && t.due <= today && !t.done) || (t.due === today));
      else if (filter === 'upcoming') list = list.filter((t) => !t.done && t.due && t.due > today);
      else if (filter === 'all') list = list.filter((t) => !t.done);
      else if (filter === 'done') list = list.filter((t) => t.done);
      if (cat !== 'all') list = list.filter((t) => t.category === cat);
      if (query) list = list.filter((t) => (t.title + ' ' + t.notes).toLowerCase().includes(query));
      if (filter === 'done') return [...list].sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      return sortTasks(list);
    };

    const renderList = () => {
      track.frame();
      const list = filtered();
      if (!list.length) {
        const msg = {
          today: ['🎉', 'วันนี้ไม่มีงานค้าง', 'เพิ่มงานใหม่ หรือพักผ่อนให้เต็มที่'],
          upcoming: ['🌈', 'ยังไม่มีงานที่กำลังจะถึง', 'วางแผนล่วงหน้าเพื่อให้ไม่พลาด'],
          all: ['📝', 'ยังไม่มีงาน', 'เริ่มเพิ่มงานแรกของคุณด้านบน'],
          done: ['🌱', 'ยังไม่มีงานที่เสร็จ', 'ลุยงานแรกกันเลย!'],
        }[filter];
        listEl.innerHTML = query ? emptyState('🔍', 'ไม่พบงานที่ค้นหา') : emptyState(...msg);
        return;
      }
      if (filter === 'done') {
        listEl.innerHTML = `<ul class="task-list">${list.map((t) => taskRow(t, track)).join('')}</ul>`;
        return;
      }
      const groups = new Map(GROUPS.map((g) => [g.id, []]));
      list.forEach((t) => groups.get(groupOf(t)).push(t));
      listEl.innerHTML = GROUPS.filter((g) => groups.get(g.id).length)
        .map(
          (g) => `
          <div class="task-group">
            <h4 class="section-title ${g.id === 'overdue' ? 'bad' : ''}">${g.emoji} ${g.label} <span class="count">${groups.get(g.id).length}</span></h4>
            <ul class="task-list">${groups.get(g.id).map((t) => taskRow(t, track)).join('')}</ul>
          </div>`,
        )
        .join('');
    };

    const renderAll = () => {
      renderFilters();
      renderProgress();
      renderList();
    };

    // ---------- events ----------
    $('#task-quick', root).addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#task-quick-input', root);
      let title = input.value.trim();
      if (!title) {
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 400);
        return;
      }
      let prio = 'medium';
      if (/!+\s*$|^!+/.test(title)) {
        prio = 'high';
        title = title.replace(/^!+\s*|\s*!+$/g, '');
      }
      const due = filter === 'upcoming' ? toKey(addDays(new Date(), 1)) : filter === 'all' ? null : todayKey();
      store.add('tasks', {
        title, due, time: '', notes: '', priority: prio, category: cat === 'all' ? 'work' : cat,
        goalId: null, done: false, doneAt: null,
      });
      if (filter === 'done') {
        filter = 'today';
        $('#task-filter', root).innerHTML = '';
        renderAll();
      }
      input.value = '';
      toast(`เพิ่ม “${title}” แล้ว`, { icon: '✅' });
    });
    $('#task-more', root).addEventListener('click', () =>
      openTaskForm(null, { category: cat === 'all' ? 'work' : cat }),
    );

    let qTimer;
    $('#task-search', root).addEventListener('input', (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        query = e.target.value.trim().toLowerCase();
        track.reset();
        renderList();
      }, 150);
    });

    $('#task-cats', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      cat = b.dataset.cat;
      renderCats();
      track.reset();
      renderList();
    });

    listEl.addEventListener('click', (e) => {
      const row = e.target.closest('[data-task]');
      if (!row) return;
      const id = row.dataset.task;
      if (e.target.closest('[data-check]')) return toggleTask(id, e.target.closest('[data-check]'));
      if (e.target.closest('[data-del]')) return removeWithUndo('tasks', id, row);
      openTaskForm(store.find('tasks', id));
    });

    renderCats();
    renderAll();

    return {
      update: () => renderAll(),
      onResize: () => {
        const seg = $('#task-filter .segmented', root);
        if (seg) moveSegIndicator(seg, true);
      },
    };
  },
};

function taskRow(t, track) {
  const { cls, vars } = track.attrs(t.id);
  const c = category(t.category);
  const p = priority(t.priority);
  const goal = t.goalId && store.find('goals', t.goalId);
  const over = isOverdue(t);
  return `
    <li class="task-row${t.done ? ' is-done' : ''}${cls}" style="${vars}--pc:${p.color}" data-task="${t.id}" tabindex="0">
      ${checkbox(t.done, { label: t.title })}
      <div class="task-main">
        <p class="task-title">${esc(t.title)}</p>
        <div class="task-meta">
          ${t.due ? `<span class="tag ${over ? 'bad' : t.due === todayKey() ? 'accent' : ''}">${icon('calendar')}${relativeDay(t.due)}${t.time ? ' · ' + t.time : ''}</span>` : ''}
          <span class="tag">${c.emoji} ${c.label}</span>
          ${goal ? `<span class="tag" style="color:${goal.color}">${icon('target')}${esc(goal.title)}</span>` : ''}
          ${t.notes ? `<span class="tag" title="${esc(t.notes)}">${icon('note')}</span>` : ''}
        </div>
      </div>
      <span class="prio-flag" title="ความสำคัญ${p.label}">${icon('flag')}<span>${p.label}</span></span>
      <div class="row-actions">
        <button class="icon-btn sm" data-edit aria-label="แก้ไข">${icon('edit')}</button>
        <button class="icon-btn sm danger" data-del aria-label="ลบ">${icon('trash')}</button>
      </div>
    </li>`;
}
