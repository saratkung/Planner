// ==========================================================
// modal.js — dialog / bottom sheet
// ==========================================================
import { el, $ } from '../core/utils.js';
import { icon } from './icons.js';

let current = null;

/**
 * openModal({ title, body, footer, onMount, onClose })
 * - body: HTML string or element
 * - footer: HTML string (buttons)
 * returns { root, close }
 */
export function openModal({ title, body = '', footer = '', onMount, onClose, size } = {}) {
  if (current) current.close(true);

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${title}" ${size ? `style="width:min(${size}px,100%)"` : ''}>
        <div class="modal-head">
          <h2>${title}</h2>
          <button class="icon-btn sm" data-close type="button" aria-label="ปิด">${icon('x')}</button>
        </div>
        <div class="modal-body"></div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>`);

  const bodyEl = $('.modal-body', overlay);
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else bodyEl.appendChild(body);

  const prevFocus = document.activeElement;
  let closed = false;

  const close = (instant = false) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    current = null;
    onClose?.();
    if (instant) overlay.remove();
    else {
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 260);
    }
    prevFocus?.focus?.();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);

  $('#modal-root').appendChild(overlay);
  current = { root: overlay, close };
  onMount?.(overlay, close);

  // focus first field
  requestAnimationFrame(() => {
    const f = overlay.querySelector('[autofocus], input:not([type=hidden]), textarea, select');
    if (f && window.matchMedia('(min-width: 761px)').matches) f.focus();
  });

  return current;
}

export const isModalOpen = () => !!current;

/** Simple confirmation dialog -> Promise<boolean> */
export function confirmDialog({ title = 'ยืนยัน', message = '', okLabel = 'ยืนยัน', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    openModal({
      title,
      size: 420,
      body: `<p class="muted" style="color:var(--text-2)">${message}</p>`,
      footer: `<span class="spacer"></span>
        <button class="btn btn-ghost" data-close type="button">ยกเลิก</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok type="button">${okLabel}</button>`,
      onMount(root, close) {
        root.querySelector('[data-ok]').addEventListener('click', () => {
          result = true;
          close();
        });
      },
      onClose: () => resolve(result),
    });
  });
}
