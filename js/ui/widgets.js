// ==========================================================
// widgets.js — small render helpers shared across views
// ==========================================================
import { esc } from '../core/utils.js';
import { checkIcon } from './icons.js';

/** Progress ring (SVG). Animates from 0 when `animate` is true. */
export function ring(pct, { size = 64, stroke = 7, color = 'var(--accent)', label, from = 0 } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  const start = c * (1 - from / 100);
  return `
    <div class="ring" style="width:${size}px;height:${size}px;--c:${color}" role="img" aria-label="${pct}%">
      <svg width="${size}" height="${size}">
        <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
        <circle class="ring-bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"
          stroke-dasharray="${c}" style="stroke-dashoffset:${start}" data-offset="${off}"/>
      </svg>
      <span class="ring-label">${label ?? pct + '%'}</span>
    </div>`;
}

/** Progress bar. `from` = previous pct so updates animate smoothly. */
export function bar(pct, color, from = 0) {
  return `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <span data-p="${pct}%" style="--p:${from}%;${color ? `--c:${color}` : ''}"></span></div>`;
}

/** Remembers last rendered value per key, so meters animate from old → new. */
export function meterMemory() {
  const m = new Map();
  return (key, value) => {
    const prev = m.has(key) ? m.get(key) : 0;
    m.set(key, value);
    return prev;
  };
}

/** Kick off ring/bar animations for freshly inserted markup. */
export function animateMeters(root) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      root.querySelectorAll('.ring-bar[data-offset]').forEach((c) => {
        c.style.strokeDashoffset = c.dataset.offset;
      });
      root.querySelectorAll('.progress > span[data-p]').forEach((s) => {
        s.style.setProperty('--p', s.dataset.p);
      });
    }),
  );
}

export function checkbox(checked, { round = false, label = '' } = {}) {
  return `<button type="button" class="check${checked ? ' checked' : ''}${round ? ' round' : ''}" role="checkbox"
    aria-checked="${checked}" aria-label="${esc(label)}" data-check>${checkIcon()}</button>`;
}

export function emptyState(emoji, title, text = '', small = false) {
  return `<div class="empty${small ? ' sm' : ''}"><div class="empty-emoji">${emoji}</div>
    <h4>${esc(title)}</h4>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
}

/** Segmented control with sliding indicator. call bindSegmented after insertion. */
export function segmented(options, active, { name = '', block = false } = {}) {
  return `<div class="segmented${block ? ' block' : ''}" data-seg="${name}" role="tablist">
    <span class="seg-indicator"></span>
    ${options
      .map(
        (o) => `<button type="button" role="tab" data-value="${o.id}" class="${o.id === active ? 'active' : ''}"
          aria-selected="${o.id === active}">${o.icon || ''}${esc(o.label)}${
          o.count != null ? ` <span class="seg-count">${o.count}</span>` : ''
        }</button>`,
      )
      .join('')}
  </div>`;
}

export function moveSegIndicator(seg, instant = false) {
  const ind = seg.querySelector('.seg-indicator');
  const act = seg.querySelector('button.active');
  if (!ind || !act) return;
  if (instant) ind.style.transition = 'none';
  ind.style.width = act.offsetWidth + 'px';
  ind.style.transform = `translateX(${act.offsetLeft}px)`;
  if (instant) requestAnimationFrame(() => (ind.style.transition = ''));
}

/**
 * Bind a segmented control. onChange(value)
 * Keeps indicator in place on resize.
 */
export function bindSegmented(seg, onChange) {
  if (!seg) return;
  moveSegIndicator(seg, true);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b || b.classList.contains('active')) return;
    seg.querySelectorAll('button').forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-selected', x === b);
    });
    moveSegIndicator(seg);
    onChange(b.dataset.value);
  });
}
