// ==========================================================
// navConfig.js — เลือกเมนูที่ใช้: ลำดับหน้า, หน้าที่ซ่อน, หน้าที่อยู่บนแถบล่าง (มือถือ)
// ==========================================================
import { store } from './store.js';

export const ALL_PAGES = ['dashboard', 'tasks', 'meetings', 'calendar', 'schedule', 'goals', 'learn', 'portfolio'];
export const DEFAULT_TABS = ['dashboard', 'tasks', 'meetings', 'calendar', 'learn'];
export const MAX_TABS = 5;
export const LOCKED = 'dashboard'; // หน้าแรก ซ่อนไม่ได้

export function navCfg() {
  const n = store.state.settings.nav || {};
  const saved = (n.order || []).filter((id) => ALL_PAGES.includes(id));
  const order = [...saved, ...ALL_PAGES.filter((id) => !saved.includes(id))];
  const hidden = new Set((n.hidden || []).filter((id) => id !== LOCKED && ALL_PAGES.includes(id)));
  const visible = order.filter((id) => !hidden.has(id));
  let tabs = (n.tabs || DEFAULT_TABS).filter((id) => visible.includes(id));
  if (!tabs.length) tabs = visible.slice(0, MAX_TABS);
  tabs = visible.filter((id) => tabs.includes(id)).slice(0, MAX_TABS); // เรียงตามลำดับหน้า
  return { order, hidden, visible, tabs };
}

export const isVisible = (id) => !navCfg().hidden.has(id);

export function setNav(patch) {
  const cur = navCfg();
  const next = { order: cur.order, hidden: [...cur.hidden], tabs: cur.tabs, ...patch };
  store.setSettings({ nav: next });
}

export const resetNav = () => store.setSettings({ nav: null });
export const navSig = () => JSON.stringify(navCfg(), (k, v) => (v instanceof Set ? [...v] : v));
