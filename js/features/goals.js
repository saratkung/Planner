// ==========================================================
// goals.js — life goals with milestones & linked tasks
// ==========================================================
import { store } from '../core/store.js';
import { esc, formatDate, enterTracker, $ } from '../core/utils.js';
import { CATEGORIES, category } from '../core/constants.js';
import { goalProgress, daysLeft } from '../core/selectors.js';
import { toggleMilestone, toggleTask, removeWithUndo } from '../core/actions.js';
import { icon } from '../ui/icons.js';
import { ring, checkbox, emptyState, animateMeters, meterMemory, segmented, bindSegmented, moveSegIndicator } from '../ui/widgets.js';
import { openGoalForm } from '../forms/goalForm.js';
import { openTaskForm } from '../forms/taskForm.js';

export default {
  id: 'goals',
  label: 'เป้าหมาย',
  icon: 'target',
  subtitle: () => 'ตั้งเป้าหมาย แตกเป็นขั้นตอน แล้วเชื่อมกับงานประจำวัน',

  mount(root) {
    const track = enterTracker();
    const mem = meterMemory();
    let cat = 'all';
    let status = 'active';
    const expanded = new Set();

    root.innerHTML = `
      <div class="goals-view">
        <div class="goal-stats" id="goal-stats"></div>
        <div class="tasks-toolbar">
          <div id="goal-status"></div>
          <button class="btn btn-primary" id="goal-new">${icon('plus')}ตั้งเป้าหมายใหม่</button>
        </div>
        <div class="chips" id="goal-cats"></div>
        <div class="goal-grid" id="goal-grid"></div>
      </div>`;

    const grid = $('#goal-grid', root);

    $('#goal-status', root).innerHTML = segmented(
      [
        { id: 'active', label: 'กำลังทำ' },
        { id: 'done', label: 'สำเร็จแล้ว' },
        { id: 'all', label: 'ทั้งหมด' },
      ],
      status,
      { name: 'gstatus' },
    );
    bindSegmented($('[data-seg="gstatus"]', root), (v) => {
      status = v;
      track.reset();
      renderGrid();
    });

    const renderCats = () => {
      $('#goal-cats', root).innerHTML = [
        `<button class="chip ${cat === 'all' ? 'active' : ''}" data-cat="all">ทุกด้าน</button>`,
        ...CATEGORIES.map((c) => `<button class="chip ${cat === c.id ? 'active' : ''}" data-cat="${c.id}">${c.emoji} ${c.label}</button>`),
      ].join('');
    };

    const renderStats = () => {
      const all = store.state.goals.map((g) => goalProgress(g));
      const done = all.filter((p) => p.total && p.pct === 100).length;
      const avg = all.length ? Math.round(all.reduce((a, p) => a + p.pct, 0) / all.length) : 0;
      const steps = all.reduce((a, p) => a + p.done, 0);
      $('#goal-stats', root).innerHTML = `
        <div class="card mini-stat"><span class="ms-emoji">🎯</span><div><b>${all.length}</b><p class="muted">เป้าหมายทั้งหมด</p></div></div>
        <div class="card mini-stat"><span class="ms-emoji">🏆</span><div><b>${done}</b><p class="muted">สำเร็จแล้ว</p></div></div>
        <div class="card mini-stat"><span class="ms-emoji">📈</span><div><b>${avg}%</b><p class="muted">ความคืบหน้าเฉลี่ย</p></div></div>
        <div class="card mini-stat"><span class="ms-emoji">✅</span><div><b>${steps}</b><p class="muted">ขั้นตอนที่ทำแล้ว</p></div></div>`;
    };

    const renderGrid = () => {
      track.frame();
      let goals = store.state.goals.map((g) => ({ g, p: goalProgress(g) }));
      if (cat !== 'all') goals = goals.filter(({ g }) => g.category === cat);
      if (status === 'active') goals = goals.filter(({ p }) => !(p.total && p.pct === 100));
      if (status === 'done') goals = goals.filter(({ p }) => p.total && p.pct === 100);
      goals.sort((a, b) => (a.g.deadline || '9999') < (b.g.deadline || '9999') ? -1 : 1);

      if (!goals.length) {
        grid.innerHTML = `<div class="card goal-empty">${
          status === 'done'
            ? emptyState('🏔️', 'ยังไม่มีเป้าหมายที่สำเร็จ', 'ค่อย ๆ ทำทีละขั้น เดี๋ยวก็ถึง!')
            : emptyState('🌟', 'ยังไม่มีเป้าหมาย', 'เป้าหมายที่ชัดเจน คือจุดเริ่มต้นของแผนที่ดี')
        }<div style="text-align:center"><button class="btn btn-primary" data-new>${icon('plus')}ตั้งเป้าหมายแรก</button></div></div>`;
        return;
      }

      grid.innerHTML = goals.map(({ g, p }) => goalCard(g, p, track, mem, expanded.has(g.id))).join('');
      animateMeters(grid);
    };

    const renderAll = () => {
      renderStats();
      renderGrid();
    };

    $('#goal-new', root).addEventListener('click', () => openGoalForm());
    $('#goal-cats', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      cat = b.dataset.cat;
      renderCats();
      track.reset();
      renderGrid();
    });

    grid.addEventListener('click', (e) => {
      if (e.target.closest('[data-new]')) return openGoalForm();
      const card = e.target.closest('[data-goal]');
      if (!card) return;
      const gid = card.dataset.goal;
      const check = e.target.closest('[data-check]');
      if (check) {
        const ms = check.closest('[data-ms]');
        if (ms) return toggleMilestone(gid, ms.dataset.ms, check);
        const t = check.closest('[data-task]');
        if (t) return toggleTask(t.dataset.task, check);
      }
      if (e.target.closest('[data-edit]')) return openGoalForm(store.find('goals', gid));
      if (e.target.closest('[data-del]')) return removeWithUndo('goals', gid, card);
      if (e.target.closest('[data-addtask]'))
        return openTaskForm(null, { goalId: gid, category: store.find('goals', gid).category });
      if (e.target.closest('[data-toggle]')) {
        expanded.has(gid) ? expanded.delete(gid) : expanded.add(gid);
        card.classList.toggle('expanded');
        return;
      }
      const t = e.target.closest('[data-task]');
      if (t) return openTaskForm(store.find('tasks', t.dataset.task));
    });

    renderCats();
    renderAll();

    return {
      update: renderAll,
      onResize: () => moveSegIndicator($('[data-seg="gstatus"]', root), true),
    };
  },
};

function goalCard(g, p, track, mem, isExpanded) {
  const { cls, vars } = track.attrs(g.id);
  const c = category(g.category);
  const left = daysLeft(g.deadline);
  const complete = p.total && p.pct === 100;
  const deadlineTag =
    left == null
      ? ''
      : complete
      ? `<span class="tag good">${icon('trophy')}สำเร็จแล้ว</span>`
      : left < 0
      ? `<span class="tag bad">${icon('alert')}เลยกำหนด ${-left} วัน</span>`
      : left <= 14
      ? `<span class="tag warn">${icon('clock')}เหลือ ${left} วัน</span>`
      : `<span class="tag">${icon('calendar')}เหลือ ${left} วัน</span>`;

  const openLinked = p.linked.filter((t) => !t.done);
  return `
    <article class="card goal-card card-hover${complete ? ' complete' : ''}${isExpanded ? ' expanded' : ''}${cls}" style="${vars}--gc:${g.color}" data-goal="${g.id}">
      <div class="goal-top">
        ${ring(p.pct, { size: 76, stroke: 8, color: g.color, from: mem(g.id, p.pct) })}
        <div class="goal-info">
          <span class="goal-cat">${c.emoji} ${c.label}</span>
          <h3>${esc(g.title)}</h3>
          ${g.description ? `<p class="muted goal-desc">${esc(g.description)}</p>` : ''}
        </div>
        <div class="goal-actions">
          <button class="icon-btn sm" data-edit aria-label="แก้ไขเป้าหมาย">${icon('edit')}</button>
          <button class="icon-btn sm danger" data-del aria-label="ลบเป้าหมาย">${icon('trash')}</button>
        </div>
      </div>
      <div class="goal-meta">
        ${deadlineTag}
        ${g.deadline ? `<span class="tag">${icon('flag')}${formatDate(g.deadline, { short: true })}</span>` : ''}
        <span class="tag">${p.done}/${p.total} ขั้นตอน</span>
      </div>
      ${
        g.milestones.length
          ? `<ul class="milestones">${g.milestones
              .map(
                (m) => `<li class="milestone${m.done ? ' is-done' : ''}" data-ms="${m.id}">
                  ${checkbox(m.done, { round: true, label: m.title })}<span>${esc(m.title)}</span></li>`,
              )
              .join('')}</ul>`
          : ''
      }
      <div class="goal-linked">
        <button class="goal-linked-head" data-toggle aria-expanded="${isExpanded}">
          ${icon('link')} งานที่เชื่อมไว้ <span class="count">${p.linked.length}</span>
          ${openLinked.length ? `<span class="muted">· ค้าง ${openLinked.length}</span>` : ''}
          ${icon('right', 'chev')}
        </button>
        <div class="goal-linked-body"><div>
          ${
            p.linked.length
              ? `<ul class="mini-tasks">${p.linked
                  .map(
                    (t) => `<li class="mini-task${t.done ? ' is-done' : ''}" data-task="${t.id}">
                      ${checkbox(t.done, { round: true, label: t.title })}<span class="mini-title">${esc(t.title)}</span></li>`,
                  )
                  .join('')}</ul>`
              : '<p class="muted" style="font-size:13px;padding:4px 2px">ยังไม่มีงานที่เชื่อมกับเป้าหมายนี้</p>'
          }
          <button class="btn btn-ghost btn-sm" data-addtask>${icon('plus')}เพิ่มงานสำหรับเป้าหมายนี้</button>
        </div></div>
      </div>
    </article>`;
}
