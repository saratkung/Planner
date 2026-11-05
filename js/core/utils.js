// ==========================================================
// utils.js — date helpers, formatting, DOM helpers
// ==========================================================

export const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
export const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];
export const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
export const THAI_DAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export const uid = () =>
  Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-5);

export const pad = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD' (local time) */
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 'YYYY-MM-DD' -> Date (local midnight) */
export const fromKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const todayKey = () => toKey(new Date());

export const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};

export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

export const startOfWeek = (d, weekStart = 0) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (x.getDay() - weekStart + 7) % 7;
  return addDays(x, -diff);
};

export const sameDay = (a, b) => toKey(a) === toKey(b);

/** whole days from key a to key b (b - a) */
export const diffDays = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);

export const thaiYear = (d) => d.getFullYear() + 543;

export function formatDate(d, { weekday = false, short = false, year = true } = {}) {
  if (typeof d === 'string') d = fromKey(d);
  const m = short ? THAI_MONTHS_SHORT[d.getMonth()] : THAI_MONTHS[d.getMonth()];
  let s = `${d.getDate()} ${m}`;
  if (year) s += ` ${thaiYear(d)}`;
  if (weekday) s = `${short ? THAI_DAYS_SHORT[d.getDay()] + '.' : 'วัน' + THAI_DAYS[d.getDay()]} ${s}`;
  return s;
}

/** 'วันนี้' / 'พรุ่งนี้' / 'เมื่อวาน' / 'อีก 3 วัน' / 'เลยมา 2 วัน' */
export function relativeDay(key) {
  const n = diffDays(todayKey(), key);
  if (n === 0) return 'วันนี้';
  if (n === 1) return 'พรุ่งนี้';
  if (n === -1) return 'เมื่อวาน';
  if (n > 1 && n <= 6) return `อีก ${n} วัน`;
  if (n < -1) return `เลยมา ${-n} วัน`;
  return formatDate(key, { short: true, year: fromKey(key).getFullYear() !== new Date().getFullYear() });
}

export const timeToMin = (t) => {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};
export const minToTime = (m) => {
  m = Math.max(0, Math.min(24 * 60 - 1, Math.round(m)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};
export const nowMinutes = () => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};

export function durationLabel(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} ชม. ${m} น.`;
  if (h) return `${h} ชม.`;
  return `${m} นาที`;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'ราตรีสวัสดิ์';
  if (h < 12) return 'สวัสดีตอนเช้า';
  if (h < 17) return 'สวัสดีตอนบ่าย';
  if (h < 21) return 'สวัสดีตอนเย็น';
  return 'ราตรีสวัสดิ์';
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Build a DOM element from an HTML string (first element). */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animate an element out, then run cb. */
export function animateOut(node, cb, cls = 'leaving') {
  if (!node || prefersReducedMotion()) return cb();
  node.style.height = node.offsetHeight + 'px';
  node.classList.add(cls);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    cb();
  };
  node.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 500);
}

/**
 * Tracks which ids were already rendered, so only new items get an entrance
 * animation on re-render (instead of the whole list flashing).
 */
export function enterTracker() {
  const seen = new Set();
  let i = 0;
  return {
    /** returns ' enter' class + style index for unseen ids */
    attrs(id) {
      if (seen.has(id)) return { cls: '', style: '', vars: '' };
      seen.add(id);
      const n = Math.min(i++, 12);
      return { cls: ' enter', style: ` style="--i:${n}"`, vars: `--i:${n};` };
    },
    reset() {
      seen.clear();
      i = 0;
    },
    frame() {
      i = 0;
    },
  };
}

/** Count-up animation for numbers. */
export function countUp(node, to, { duration = 900, suffix = '' } = {}) {
  if (prefersReducedMotion()) {
    node.textContent = to + suffix;
    return;
  }
  const from = Number(node.dataset.from || 0);
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / duration);
    const e = 1 - Math.pow(1 - p, 3);
    node.textContent = Math.round(from + (to - from) * e) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Add a ripple effect where the user clicked. */
export function ripple(e, host) {
  if (prefersReducedMotion()) return;
  const r = host.getBoundingClientRect();
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.left = e.clientX - r.left + 'px';
  s.style.top = e.clientY - r.top + 'px';
  host.appendChild(s);
  setTimeout(() => s.remove(), 650);
}
