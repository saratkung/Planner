// ==========================================================
// toast.js — small notifications with optional action (undo)
// ==========================================================
import { el, esc, $ } from '../core/utils.js';

export function toast(message, { icon = '✨', action, onAction, duration = 3200 } = {}) {
  const root = $('#toast-root');
  const t = el(`
    <div class="toast" role="status">
      <span class="t-ico">${icon}</span>
      <span class="t-msg">${esc(message)}</span>
      ${action ? `<button type="button">${esc(action)}</button>` : ''}
    </div>`);
  root.appendChild(t);
  while (root.children.length > 3) root.firstElementChild.remove();

  let timer;
  const hide = () => {
    clearTimeout(timer);
    t.classList.add('out');
    setTimeout(() => t.remove(), 260);
  };
  t.querySelector('button')?.addEventListener('click', () => {
    onAction?.();
    hide();
  });
  timer = setTimeout(hide, duration);
  return hide;
}
