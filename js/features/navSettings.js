// ==========================================================
// navSettings.js — ส่วน "เมนู" ในหน้าตั้งค่า: เลือกหน้าที่แสดง ลำดับ และแถบล่างมือถือ
// ==========================================================
import { esc, $ } from '../core/utils.js';
import { navCfg, setNav, resetNav, MAX_TABS, LOCKED } from '../core/navConfig.js';
import { icon, tile } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

const META = {
  dashboard: { label: 'ภาพรวม', icon: 'home', color: '#5b4bc4' },
  tasks: { label: 'งาน', icon: 'checkSquare', color: '#6366f1' },
  meetings: { label: 'ประชุม', icon: 'users', color: '#0ea5e9' },
  calendar: { label: 'ปฏิทิน', icon: 'calendar', color: '#ec4899' },
  schedule: { label: 'ตารางเวลา', icon: 'clock', color: '#f97316' },
  goals: { label: 'เป้าหมาย', icon: 'target', color: '#10b981' },
  learn: { label: 'เรียนรู้', icon: 'bulb', color: '#d9a21b' },
  portfolio: { label: 'แฟ้มผลงาน', icon: 'trophy', color: '#f59e0b' },
};

export function navSectionHTML() {
  return `<div class="gc-box nv-box" id="nv-box"></div>`;
}

function inner() {
  const c = navCfg();
  const rows = c.order
    .map((id, i) => {
      const m = META[id];
      const shown = !c.hidden.has(id);
      const tab = c.tabs.includes(id);
      return `<li class="nv-row${shown ? '' : ' off'}" data-id="${id}">
        <span class="nv-move">
          <button type="button" class="icon-btn sm" data-up ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">${icon('left')}</button>
          <button type="button" class="icon-btn sm" data-down ${i === c.order.length - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">${icon('right')}</button>
        </span>
        ${tile(m.icon, m.color, 'xs')}
        <span class="nv-label">${esc(m.label)}${id === LOCKED ? '<small>หน้าแรก</small>' : ''}</span>
        <button type="button" class="nv-tab${tab ? ' on' : ''}" data-tab ${shown ? '' : 'disabled'} aria-pressed="${tab}" title="แสดงบนแถบล่าง (มือถือ)">${icon('grid')}<span>แถบล่าง</span></button>
        <label class="switch-row" title="${id === LOCKED ? 'หน้าแรกซ่อนไม่ได้' : 'แสดงในเมนู'}"><input type="checkbox" data-show ${shown ? 'checked' : ''} ${id === LOCKED ? 'disabled' : ''} aria-label="แสดง ${esc(m.label)}" /><span class="switch" aria-hidden="true"></span></label>
      </li>`;
    })
    .join('');
  const preview = c.tabs.map((id) => `<span>${icon(META[id].icon)}<small>${esc(META[id].label)}</small></span>`).join('');
  return `
    <div class="install-head"><span class="gc-sub-ico">🧭</span><div><b>เมนู</b>
      <p class="muted">ซ่อนหน้าที่ไม่ได้ใช้ · เลือกหน้าบนแถบล่างมือถือ (สูงสุด ${MAX_TABS}) · ใช้ลูกศรเรียงลำดับ</p></div></div>
    <div class="nv-preview" aria-label="ตัวอย่างแถบล่างมือถือ">${preview}<span class="more">${icon('grid')}<small>เพิ่มเติม</small></span></div>
    <p class="muted nv-sum">แสดง ${c.visible.length} จาก ${c.order.length} หน้า · แถบล่าง ${c.tabs.length}/${MAX_TABS} · หน้าที่เหลืออยู่ในปุ่ม "เพิ่มเติม"</p>
    <ul class="nv-list">${rows}</ul>
    <div class="chips"><button type="button" class="btn btn-ghost btn-sm" data-nv-reset>${icon('repeat')}คืนค่าเริ่มต้น</button></div>`;
}

export function bindNavSection(root) {
  const box = $('#nv-box', root);
  if (!box) return;
  const render = () => (box.innerHTML = inner());
  render();
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-nv-reset]')) {
      resetNav();
      render();
      return toast('คืนค่าเมนูเริ่มต้นแล้ว', { icon: '🧭' });
    }
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    const c = navCfg();
    const move = e.target.closest('[data-up], [data-down]');
    if (move) {
      const order = [...c.order];
      const i = order.indexOf(id);
      const j = move.hasAttribute('data-up') ? i - 1 : i + 1;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      setNav({ order });
      render();
      box.querySelector(`[data-id="${id}"] ${move.hasAttribute('data-up') ? '[data-up]' : '[data-down]'}`)?.focus();
      return;
    }
    if (e.target.closest('[data-tab]')) {
      let tabs = [...c.tabs];
      if (tabs.includes(id)) {
        if (tabs.length <= 1) return toast('แถบล่างต้องมีอย่างน้อย 1 หน้า', { icon: 'ℹ️' });
        tabs = tabs.filter((x) => x !== id);
      } else {
        if (tabs.length >= MAX_TABS) return toast(`แถบล่างใส่ได้สูงสุด ${MAX_TABS} หน้า เอาหน้าอื่นออกก่อน`, { icon: 'ℹ️' });
        tabs.push(id);
      }
      setNav({ tabs });
      render();
    }
  });
  box.addEventListener('change', (e) => {
    if (!e.target.matches('[data-show]')) return;
    const id = e.target.closest('[data-id]').dataset.id;
    const c = navCfg();
    const hidden = new Set(c.hidden);
    if (e.target.checked) hidden.delete(id);
    else {
      if (c.visible.length <= 1) {
        e.target.checked = true;
        return;
      }
      hidden.add(id);
    }
    // ซ่อนหน้าที่อยู่บนแถบล่าง: เอาออกจากแถบล่างด้วย
    setNav({ hidden: [...hidden], tabs: c.tabs.filter((t) => !hidden.has(t)) });
    render();
  });
}
