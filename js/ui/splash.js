// ==========================================================
// splash.js — หน้าโหลดตอนเปิดแอป
// แถบความคืบหน้าเดินตามขั้นตอนจริง แล้วค่อยเปิดเข้าแอป
// ==========================================================
// เปิดครั้งแรกในแท็บ: เล่นเต็ม ~1.9 วินาที / รีโหลดในแท็บเดิม: สั้น ๆ
let seen = false;
try {
  seen = sessionStorage.getItem('planner.splashSeen') === '1';
  sessionStorage.setItem('planner.splashSeen', '1');
} catch (_) {}
const MIN_SHOW_MS = seen ? 700 : 1900;
const shownAt = performance.now();
if (seen) document.getElementById('splash')?.classList.add('sp-quick');

const el = () => document.getElementById('splash');

export function splashStep(pct, text) {
  const bar = document.getElementById('sp-bar');
  const status = document.getElementById('sp-status');
  if (bar) bar.style.width = pct + '%';
  if (status && text) status.textContent = text;
}

/** ปิดหน้าโหลด; onRevealed ถูกเรียกตอนเริ่มเปิดเข้าแอป */
export function hideSplash(onRevealed) {
  const s = el();
  if (!s) return onRevealed?.();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = reduce ? 150 : Math.max(450, MIN_SHOW_MS - (performance.now() - shownAt));
  // แถบค่อย ๆ เดินจนเต็มพอดีตอนเปิดเข้าแอป
  const bar = document.getElementById('sp-bar');
  if (bar) {
    bar.style.transition = `width ${wait}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    requestAnimationFrame(() => (bar.style.width = '100%'));
  }
  setTimeout(() => splashStep(100, 'พร้อมแล้ว!'), Math.max(0, wait - 380));
  setTimeout(() => {
    s.classList.add('sp-out');
    document.documentElement.classList.remove('sp-lock');
    onRevealed?.();
    setTimeout(() => s.remove(), reduce ? 50 : 750);
  }, wait);
}
