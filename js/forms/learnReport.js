// ==========================================================
// learnReport.js — แชทรายงานการเรียนรู้ (หน้าตาแบบห้องแชท) + ส่งเข้า LINE
//                + หน้าต่างแก้ไขบันทึกการเรียนรู้ทีละข้อ
// ==========================================================
import { store } from '../core/store.js';
import { esc, todayKey, formatDate, $, $$, prefersReducedMotion } from '../core/utils.js';
import { LEARN_CATS, learnCat, reportText, botIntro, lineShareURL, classify } from '../core/learn.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { segmented, bindSegmented } from '../ui/widgets.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

const PERIODS = [
  { id: 'today', label: 'วันนี้' },
  { id: 'week', label: 'สัปดาห์นี้' },
  { id: 'month', label: 'เดือนนี้' },
];

const clock = () => new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** ส่งข้อความเข้า LINE: มือถือเปิดแอป LINE ให้เลือกห้องแชท */
export function sendToLine(text) {
  const url = lineShareURL(text);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) location.href = url;
}

async function copyText(text, msg = 'คัดลอกแล้ว วางใน LINE ได้เลย') {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg, { icon: '📋' });
  } catch (_) {
    toast('คัดลอกไม่ได้ในเบราว์เซอร์นี้', { icon: '⚠️' });
  }
}

/** เปิดแชทรายงาน */
export function openLearnReport({ period = 'today' } = {}) {
  let per = period;
  let text = '';
  let edited = false;
  let run = 0; // ยกเลิก animation เดิมเมื่อเปลี่ยนช่วงเวลา

  openModal({
    title: '💬 แชทรายงานการเรียนรู้',
    size: 560,
    body: `
      <div class="lr">
        ${segmented(PERIODS, per, { name: 'lrper', block: true })}
        <div class="chat" aria-live="polite">
          <div class="chat-bar">
            <img src="icons/icon-192.png" alt="" class="chat-ava" width="34" height="34" />
            <div><b>Life Planner</b><small><i class="chat-dot"></i>ผู้ช่วยบันทึกการเรียนรู้</small></div>
          </div>
          <div class="chat-body" id="lr-chat"></div>
        </div>
      </div>`,
    footer: `
      <button class="icon-btn" type="button" data-lr="copy" title="คัดลอกข้อความ" aria-label="คัดลอกข้อความ">${icon('copy')}</button>
      ${navigator.share ? `<button class="icon-btn" type="button" data-lr="share" title="แชร์ไปแอปอื่น" aria-label="แชร์ไปแอปอื่น">${icon('upload')}</button>` : ''}
      <button class="icon-btn" type="button" data-lr="edit" title="แก้ไขข้อความก่อนส่ง" aria-label="แก้ไขข้อความก่อนส่ง">${icon('edit')}</button>
      <span class="spacer"></span>
      <button class="btn btn-line" type="button" data-lr="line">${lineLogo()}ส่งไป LINE</button>`,
    onMount(root) {
      const chat = $('#lr-chat', root);
      const scroll = () => (chat.scrollTop = chat.scrollHeight);

      const addBubble = (html, cls = 'bot') => {
        const b = document.createElement('div');
        b.className = `msg ${cls}`;
        b.innerHTML = html;
        chat.appendChild(b);
        scroll();
        return b;
      };

      const play = async () => {
        const my = ++run;
        text = reportText(per);
        edited = false;
        chat.innerHTML = `<div class="chat-day">${formatDate(todayKey(), { weekday: true, short: true, year: false })}</div>`;
        const fast = prefersReducedMotion();
        const intro = botIntro(per);
        for (const line of intro) {
          if (!fast) {
            const typing = addBubble('<span class="typing"><i></i><i></i><i></i></span>', 'bot typing-msg');
            await wait(Math.min(900, 280 + line.length * 12));
            if (my !== run) return;
            typing.remove();
          }
          addBubble(`<p>${esc(line)}</p>`, 'bot');
        }
        if (!fast) await wait(250);
        if (my !== run) return;
        const me = addBubble(
          `<div class="msg-report" id="lr-text">${esc(text)}</div><span class="msg-meta">${clock()} · พร้อมส่ง</span>`,
          'me',
        );
        me.querySelector('.msg-report').addEventListener('dblclick', () => startEdit());
        // ให้เห็นหัวรายงานก่อน (เลื่อนลงอ่านต่อได้)
        requestAnimationFrame(() => (chat.scrollTop = Math.max(0, me.offsetTop - chat.offsetTop - 70)));
      };

      const startEdit = () => {
        const host = $('#lr-text', root);
        if (!host || host.querySelector('textarea')) return;
        host.innerHTML = `<textarea class="lr-edit" aria-label="แก้ไขข้อความ">${esc(text)}</textarea>`;
        const ta = host.querySelector('textarea');
        const fit = () => {
          ta.style.height = 'auto';
          ta.style.height = ta.scrollHeight + 'px';
        };
        ta.addEventListener('input', () => {
          text = ta.value;
          edited = true;
          fit();
        });
        fit();
        ta.focus();
        $('[data-lr="edit"]', root).classList.add('on');
      };

      bindSegmented($('[data-seg="lrper"]', root), (v) => {
        per = v;
        play();
      });

      root.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-lr]')?.dataset.lr;
        if (!act) return;
        if (act === 'edit') return startEdit();
        if (act === 'copy') return copyText(text);
        if (act === 'share') {
          try {
            await navigator.share({ text });
          } catch (err) {
            if (err?.name !== 'AbortError') copyText(text);
          }
          return;
        }
        if (act === 'line') {
          sendToLine(text);
          const meta = $('.msg.me .msg-meta', root);
          if (meta) meta.textContent = `${clock()} · ส่งไป LINE แล้ว ✓`;
          if (!$('.msg.sent-ok', root)) {
            setTimeout(() => {
              addBubble(`<p>${edited ? 'ส่งฉบับที่แก้ไขแล้ว' : 'ส่งแล้ว'} 🎉 เลือกห้องแชทใน LINE แล้วกดส่งได้เลยครับ</p>`, 'bot sent-ok');
            }, 500);
          }
        }
      });

      play();
    },
    onClose: () => run++,
  });
}

/** โลโก้ LINE แบบเรียบ (ฟองแชท) */
function lineLogo() {
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s6-3.5 8.2-6.1C21.6 14.2 22 12.7 22 11c0-4.4-4.5-8-10-8Zm-3.6 10.4H6.5c-.3 0-.5-.2-.5-.5V9.1c0-.3.2-.5.5-.5s.5.2.5.5v3.3h1.4c.3 0 .5.2.5.5s-.2.5-.5.5Zm2-.5c0 .3-.2.5-.5.5s-.5-.2-.5-.5V9.1c0-.3.2-.5.5-.5s.5.2.5.5v3.8Zm4.4 0c0 .2-.1.4-.3.5h-.2c-.2 0-.3-.1-.4-.2l-2-2.7v2.4c0 .3-.2.5-.5.5s-.5-.2-.5-.5V9.1c0-.2.1-.4.3-.5h.2c.2 0 .3.1.4.2l2 2.7V9.1c0-.3.2-.5.5-.5s.5.2.5.5v3.8Zm3.1-2.4c.3 0 .5.2.5.5s-.2.5-.5.5h-1.4v.9h1.4c.3 0 .5.2.5.5s-.2.5-.5.5h-1.9c-.3 0-.5-.2-.5-.5V9.1c0-.3.2-.5.5-.5h1.9c.3 0 .5.2.5.5s-.2.5-.5.5h-1.4v.9h1.4Z"/></svg>`;
}

/** เลือกหมวด (ปุ่มกลมเล็ก ๆ) */
export function catPicker(active, name = 'cat') {
  return `<div class="chips ln-cats" role="radiogroup" aria-label="หมวด">${LEARN_CATS.map(
    (c) => `<button type="button" class="chip${c.id === active ? ' active' : ''}" role="radio" aria-checked="${c.id === active}" data-${name}="${c.id}" style="--c:${c.color}">${c.emoji} ${c.short}</button>`,
  ).join('')}</div>`;
}

/** แก้ไขบันทึกการเรียนรู้ 1 ข้อ */
export function openLearnEdit(item) {
  if (!item) return;
  let cat = item.cat;
  openModal({
    title: '💡 แก้ไขสิ่งที่ได้เรียนรู้',
    size: 520,
    body: `
      <div class="form-grid"><div class="field"><label for="le-text">เรียนรู้อะไร</label>
        <textarea class="textarea" id="le-text" maxlength="500" rows="3">${esc(item.text)}</textarea></div>
      <div class="field"><label>หมวด <button type="button" class="link-btn" data-auto>✨ จัดหมวดใหม่อัตโนมัติ</button></label>
        <div id="le-cats">${catPicker(cat)}</div></div>
      <div class="field"><label for="le-date">วันที่</label>
        <input class="input" type="date" id="le-date" value="${esc(item.date)}" max="${todayKey()}" /></div></div>`,
    footer: `<button class="btn btn-danger" type="button" data-del>${icon('trash')}ลบ</button>
      <span class="spacer"></span>
      <button class="btn btn-ghost hide-mobile" data-close type="button">ยกเลิก</button>
      <button class="btn btn-primary" type="button" data-save>บันทึก</button>`,
    onMount(root, close) {
      const setCat = (c) => {
        cat = c;
        $$('[data-cat]', root).forEach((b) => {
          b.classList.toggle('active', b.dataset.cat === c);
          b.setAttribute('aria-checked', b.dataset.cat === c);
        });
      };
      root.addEventListener('click', async (e) => {
        const c = e.target.closest('[data-cat]');
        if (c) return setCat(c.dataset.cat);
        if (e.target.closest('[data-auto]')) {
          const next = classify($('#le-text', root).value);
          setCat(next);
          toast(`จัดเป็นหมวด ${learnCat(next).emoji} ${learnCat(next).label}`, { icon: '✨' });
          return;
        }
        if (e.target.closest('[data-del]')) {
          close();
          const ok = await confirmDialog({ title: 'ลบบันทึกนี้?', message: esc(item.text), okLabel: 'ลบ', danger: true });
          if (!ok) return;
          const snap = store.remove('learnings', item.id);
          toast('ลบบันทึกแล้ว', { icon: '🗑️', action: 'เลิกทำ', onAction: () => store.restore(snap), duration: 5000 });
          return;
        }
        if (e.target.closest('[data-save]')) {
          const text = $('#le-text', root).value.trim();
          if (!text) return $('#le-text', root).focus();
          const date = $('#le-date', root).value || item.date;
          store.update('learnings', item.id, { text, cat, date });
          toast('บันทึกแล้ว', { icon: '💡' });
          close();
        }
      });
    },
  });
}
