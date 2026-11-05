// ==========================================================
// actions.js — user actions shared by many views
// (toggle with animation + confetti, delete with undo)
// ==========================================================
import { store } from './store.js';
import { animateOut } from './utils.js';
import { goalProgress } from './selectors.js';
import { toast } from '../ui/toast.js';
import { confetti, celebrate } from '../ui/confetti.js';

const LABEL = { tasks: 'งาน', events: 'นัดหมาย', goals: 'เป้าหมาย' };

function burstFrom(node, count = 26) {
  if (!node) return;
  const r = node.getBoundingClientRect();
  confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count, power: 7 });
}

function goalSnapshot(goalId) {
  const g = goalId && store.find('goals', goalId);
  return g ? goalProgress(g).pct : null;
}

function checkGoalCompleted(goalId, before) {
  if (before == null || before === 100) return;
  const g = store.find('goals', goalId);
  if (g && goalProgress(g).pct === 100) {
    celebrate();
    toast(`สำเร็จเป้าหมาย “${g.title}” แล้ว!`, { icon: '🏆', duration: 4500 });
  }
}

/** Toggle a task. `checkEl` is the clicked checkbox (for animation). */
export function toggleTask(id, checkEl) {
  const t = store.find('tasks', id);
  if (!t) return;
  const willBeDone = !t.done;
  const before = goalSnapshot(t.goalId);

  if (checkEl) {
    checkEl.classList.toggle('checked', willBeDone);
    checkEl.classList.remove('animate');
    void checkEl.offsetWidth;
    checkEl.classList.add('animate');
    checkEl.closest('[data-task]')?.classList.toggle('is-done', willBeDone);
  }
  if (willBeDone) burstFrom(checkEl);

  // let the check animation play before the view re-renders
  setTimeout(() => {
    store.toggleTask(id);
    if (willBeDone) checkGoalCompleted(t.goalId, before);
  }, checkEl ? 380 : 0);
}

export function toggleMilestone(goalId, msId, checkEl) {
  const g = store.find('goals', goalId);
  const m = g?.milestones.find((x) => x.id === msId);
  if (!m) return;
  const before = goalSnapshot(goalId);
  if (checkEl) {
    checkEl.classList.toggle('checked', !m.done);
    checkEl.classList.remove('animate');
    void checkEl.offsetWidth;
    checkEl.classList.add('animate');
  }
  if (!m.done) burstFrom(checkEl, 18);
  setTimeout(() => {
    store.toggleMilestone(goalId, msId);
    checkGoalCompleted(goalId, before);
  }, checkEl ? 320 : 0);
}

/** Delete with exit animation and an "undo" toast. */
export function removeWithUndo(col, id, node) {
  const item = store.find(col, id);
  if (!item) return;
  animateOut(node, () => {
    const snap = store.remove(col, id);
    toast(`ลบ${LABEL[col]} “${item.title}” แล้ว`, {
      icon: '🗑️',
      action: 'เลิกทำ',
      onAction: () => store.restore(snap),
      duration: 5000,
    });
  });
}
