// ==========================================================
// app.js — bootstraps the app: navigation, routing, shortcuts
// ==========================================================
import { store } from './core/store.js';
import { $, $$ } from './core/utils.js';
import { overdueCount } from './core/selectors.js';
import { icon } from './ui/icons.js';
import { isModalOpen } from './ui/modal.js';
import { openTaskForm } from './forms/taskForm.js';
import { openEventForm } from './forms/eventForm.js';
import { openGoalForm } from './forms/goalForm.js';
import { openSettings, applyTheme, isDark } from './features/settings.js';
import { setupPWA } from './pwa.js';

import dashboard from './features/dashboard.js';
import tasks from './features/tasks.js';
import calendar from './features/calendar.js';
import schedule from './features/schedule.js';
import goals from './features/goals.js';

const FEATURES = [dashboard, tasks, calendar, schedule, goals];
const viewEl = $('#view');
let active = null; // { feature, instance }

// ---------- navigation ----------
function buildNav() {
  const link = (f) =>
    `<a href="#${f.id}" data-route="${f.id}">${icon(f.icon)}<span>${f.label}</span>${
      f.id === 'tasks' ? '<b class="badge" hidden></b>' : ''
    }</a>`;
  $('#nav').innerHTML = `<span class="nav-indicator"></span>${FEATURES.map(link).join('')}`;
  $('#tabbar').innerHTML = `<span class="nav-indicator"></span>${FEATURES.map(link).join('')}`;
  $('#btn-settings').innerHTML = `${icon('settings')}<span class="label">ตั้งค่า</span>`;
  $('#btn-settings-m').innerHTML = icon('settings');
  $('#btn-quick').innerHTML = `${icon('plus')}<span class="label">สร้างใหม่</span>`;
  $('#quick-menu').innerHTML = [
    ['task', 'checkSquare', 'งานใหม่', '#6366f1', 'N'],
    ['event', 'calendar', 'นัดหมาย / ตาราง', '#ec4899', 'E'],
    ['goal', 'target', 'เป้าหมาย', '#10b981', 'G'],
  ]
    .map(
      ([id, ic, label, c, k]) =>
        `<button role="menuitem" data-quick="${id}"><span class="menu-ico" style="--c:${c};--c-soft:color-mix(in srgb, ${c} 14%, transparent)">${icon(ic)}</span>${label}<kbd>${k}</kbd></button>`,
    )
    .join('');
}

function moveIndicators() {
  ['#nav', '#tabbar'].forEach((sel) => {
    const nav = $(sel);
    const a = nav.querySelector('a.active');
    const ind = nav.querySelector('.nav-indicator');
    if (!a || !ind) return;
    if (sel === '#nav') ind.style.transform = `translateY(${a.offsetTop}px)`;
    else {
      ind.style.width = a.offsetWidth + 'px';
      ind.style.transform = `translateX(${a.offsetLeft - 6}px)`;
    }
  });
}

function updateBadge() {
  const n = overdueCount();
  $$('.badge').forEach((b) => {
    b.hidden = !n;
    b.textContent = n;
  });
}

function updateHeader() {
  if (!active) return;
  $('#page-title').textContent = active.feature.label;
  $('#page-sub').textContent = active.feature.subtitle?.() || '';
}

// ---------- routing ----------
function route() {
  const id = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const feature = FEATURES.find((f) => f.id === id) || dashboard;
  if (active?.feature === feature) return;

  active?.instance?.unmount?.();
  viewEl.classList.remove('view-enter');
  viewEl.innerHTML = '';
  viewEl.dataset.view = feature.id;

  active = { feature, instance: null };
  active.instance = feature.mount(viewEl, { navigate });
  void viewEl.offsetWidth;
  viewEl.firstElementChild?.classList.add('view-enter');

  $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === feature.id));
  moveIndicators();
  updateHeader();
  document.title = `${feature.label} · Life Planner`;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

export function navigate(id) {
  location.hash = `#${id}`;
}

// ---------- quick add menu ----------
function setupQuickMenu() {
  const btn = $('#btn-quick');
  const menu = $('#quick-menu');
  const toggle = (open) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open);
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(menu.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('.quick-add')) toggle(false);
  });
  menu.addEventListener('click', (e) => {
    const q = e.target.closest('[data-quick]')?.dataset.quick;
    if (!q) return;
    toggle(false);
    quickCreate(q);
  });
}

function quickCreate(kind) {
  if (kind === 'task') openTaskForm();
  if (kind === 'event') openEventForm();
  if (kind === 'goal') openGoalForm();
}

// ---------- theme ----------
function renderThemeBtn() {
  $('#btn-theme').innerHTML = icon(isDark() ? 'sun' : 'moon');
  $('#btn-theme').title = isDark() ? 'โหมดสว่าง' : 'โหมดมืด';
}
function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  store.setSettings({ theme: next });
  applyTheme(next);
  renderThemeBtn();
  $('#btn-theme').animate(
    [{ transform: 'rotate(-90deg) scale(0.6)', opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: 450, easing: 'cubic-bezier(0.34,1.56,0.64,1)' },
  );
}

// ---------- keyboard shortcuts ----------
function setupShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isModalOpen()) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); openTaskForm(); }
    else if (k === 'e') { e.preventDefault(); openEventForm(); }
    else if (k === 'g') { e.preventDefault(); openGoalForm(); }
    else if (k === 't') toggleTheme();
    else if (/^[1-5]$/.test(k)) navigate(FEATURES[Number(k) - 1].id);
  });
}

// ---------- boot ----------
function init() {
  applyTheme();
  buildNav();
  renderThemeBtn();
  setupQuickMenu();
  setupShortcuts();

  $('#btn-theme').addEventListener('click', toggleTheme);
  $('#btn-settings').addEventListener('click', () => openSettings());
  $('#btn-settings-m').addEventListener('click', () => openSettings());
  setupPWA({ onSuggestInstall: () => openSettings({ focusInstall: true }) });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderThemeBtn);

  store.subscribe((change) => {
    if (change.type === 'settings') renderThemeBtn();
    active?.instance?.update?.(change);
    updateBadge();
    updateHeader();
  });

  let rz;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      moveIndicators();
      active?.instance?.onResize?.();
    }, 100);
  });

  window.addEventListener('hashchange', route);
  route();
  updateBadge();
  // fonts can change nav metrics after load
  document.fonts?.ready.then(() => {
    moveIndicators();
    active?.instance?.onResize?.();
  });
}

init();
