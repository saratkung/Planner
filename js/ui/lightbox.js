// ==========================================================
// lightbox.js — ดูรูปเต็มจอ: ปัด/ลูกศรเพื่อเลื่อน, Esc ปิด, แถบรูปย่อด้านล่าง
// items: [{ file, title }]  (file = ไฟล์แนบของผลงาน: thumb / id / link / name)
// ==========================================================
import { esc } from '../core/utils.js';
import { icon } from './icons.js';
import { bestPhotoURL } from '../core/photoStore.js';

let open = null;

export function openLightbox(items, start = 0) {
  if (!items.length) return;
  open?.close();
  let i = Math.max(0, Math.min(start, items.length - 1));
  const el = document.createElement('div');
  el.className = 'lb';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'ดูรูป');
  el.innerHTML = `
    <div class="lb-top">
      <span class="lb-count" aria-live="polite"></span>
      <span class="spacer"></span>
      <a class="lb-btn lb-drive" target="_blank" rel="noopener" hidden title="เปิดรูปเต็มใน Google Drive">${icon('link')}<span>Drive</span></a>
      <button type="button" class="lb-btn" data-lb="close" aria-label="ปิด">${icon('x')}</button>
    </div>
    <div class="lb-stage">
      <button type="button" class="lb-nav prev" data-lb="prev" aria-label="รูปก่อนหน้า">${icon('left')}</button>
      <figure class="lb-fig"><img alt="" draggable="false" /><span class="lb-spin" hidden></span></figure>
      <button type="button" class="lb-nav next" data-lb="next" aria-label="รูปถัดไป">${icon('right')}</button>
    </div>
    <div class="lb-cap"></div>
    ${items.length > 1 ? `<div class="lb-strip">${items.map((it, k) => `<button type="button" data-lb-i="${k}" aria-label="รูปที่ ${k + 1}"><img src="${esc(it.file.thumb || '')}" alt="" /></button>`).join('')}</div>` : ''}`;
  document.body.appendChild(el);
  const img = el.querySelector('.lb-fig img');
  const spin = el.querySelector('.lb-spin');
  let token = 0;

  const show = async (dir = 0) => {
    const it = items[i];
    const my = ++token;
    el.querySelector('.lb-count').textContent = items.length > 1 ? `${i + 1} / ${items.length}` : '';
    el.querySelector('.lb-cap').innerHTML = `<b>${esc(it.title || '')}</b>${it.file.name ? `<span>${esc(it.file.name)}</span>` : ''}`;
    const drive = el.querySelector('.lb-drive');
    drive.hidden = !it.file.link;
    if (it.file.link) drive.href = it.file.link;
    el.querySelectorAll('[data-lb-i]').forEach((b) => b.classList.toggle('on', Number(b.dataset.lbI) === i));
    el.querySelector(`[data-lb-i="${i}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    el.querySelectorAll('.lb-nav').forEach((b) => (b.hidden = items.length < 2));
    // แสดงรูปย่อทันที แล้วเปลี่ยนเป็นรูปชัดเมื่อโหลดได้
    img.classList.remove('in', 'from-left', 'from-right');
    void img.offsetWidth;
    img.src = it.file.thumb || '';
    img.classList.add('in', dir < 0 ? 'from-left' : dir > 0 ? 'from-right' : 'in');
    img.classList.toggle('blur', true);
    spin.hidden = false;
    const url = await bestPhotoURL(it.file);
    if (my !== token) return;
    spin.hidden = true;
    if (url) img.src = url;
    img.classList.toggle('blur', !url && !!it.file.thumb);
    // โหลดรูปข้าง ๆ ไว้ก่อน
    [i + 1, i - 1].forEach((k) => items[k] && bestPhotoURL(items[k].file));
  };
  const go = (d) => {
    if (items.length < 2) return;
    i = (i + d + items.length) % items.length;
    show(d);
  };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
    open = null;
  };
  // ดักปุ่มก่อนหน้าต่างอื่น (Esc ไม่ปิดหน้ารายละเอียดด้านหลัง)
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lb], [data-lb-i]');
    if (!b) {
      if (e.target === el || e.target.classList.contains('lb-stage')) close();
      return;
    }
    if (b.dataset.lb === 'close') return close();
    if (b.dataset.lb === 'prev') return go(-1);
    if (b.dataset.lb === 'next') return go(1);
    if (b.dataset.lbI != null) {
      const k = Number(b.dataset.lbI);
      const d = k > i ? 1 : -1;
      i = k;
      show(d);
    }
  });
  // ปัดซ้าย/ขวา (มือถือ) · ปัดลงเพื่อปิด
  let sx = 0;
  let sy = 0;
  let down = false;
  const stage = el.querySelector('.lb-stage');
  stage.addEventListener('pointerdown', (e) => {
    down = true;
    sx = e.clientX;
    sy = e.clientY;
  });
  stage.addEventListener('pointerup', (e) => {
    if (!down) return;
    down = false;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
  });
  requestAnimationFrame(() => el.classList.add('show'));
  show(0);
  open = { close };
  return open;
}
