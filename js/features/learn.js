// ==========================================================
// learn.js (feature) — หน้า "เรียนรู้": จดสิ่งที่ได้เรียนรู้ → ประมวลผล/จัดหมวด → ดูย้อนหลัง → แชทรายงานส่ง LINE
// ==========================================================
import { store } from '../core/store.js';
import { esc, todayKey, toKey, addDays, fromKey, formatDate, diffDays, enterTracker, countUp, $, $$ } from '../core/utils.js';
import { removeWithUndo } from '../core/actions.js';
import {
  LEARN_CATS, learnCat, processLearning, saveLearnings, learnings, learningsBetween, learnStreak, byCategory,
} from '../core/learn.js';
import { aiReady, aiLearn } from '../sync/ai.js';
import { icon, tile } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confetti } from '../ui/confetti.js';
import { emptyState, segmented, bindSegmented, moveSegIndicator, animateMeters } from '../ui/widgets.js';
import { openLearnReport, openLearnEdit } from '../forms/learnReport.js';

const PLACEHOLDERS = [
  'พิมพ์ได้หลายเรื่อง ขึ้นบรรทัดใหม่ทีละเรื่อง เช่น\n- จับโดยไม่มีหมายได้เมื่อเป็นความผิดซึ่งหน้า (ป.วิ.อาญา ม.78)\n- ฟังลูกน้องให้จบก่อนสั่งงาน ได้ไอเดียดีกว่าเดิม',
  'วันนี้ได้บทเรียนอะไรจากงาน คดี หรือคนรอบตัว?\n- ประสานธนาคารให้เร็ว ก่อนเงินถูกโอนต่อ\n- นอนเร็วแล้วสมองโล่งกว่ามาก',
  'อะไรที่ทำได้ดี / อะไรที่พลาดแล้วได้เรียนรู้?\n- ตรวจเอกสารซ้ำก่อนเสนอผู้บังคับบัญชา\n- ใช้ AI ช่วยสรุปหนังสือราชการได้เร็วขึ้น',
];
const RANGES = [
  { id: '7', label: '7 วัน' },
  { id: '30', label: '30 วัน' },
  { id: 'all', label: 'ทั้งหมด' },
];
const PAGE = 40;

const dayTitle = (k) => {
  const n = diffDays(todayKey(), k);
  const f = formatDate(k, { weekday: true, short: true, year: fromKey(k).getFullYear() !== new Date().getFullYear() });
  return n === 0 ? `วันนี้ · ${f}` : n === -1 ? `เมื่อวาน · ${f}` : f;
};

/** การประมวลผล (ในเครื่อง หรือ AI) แล้วให้ตรวจก่อนบันทึก */
async function process(text, { useAI = false } = {}) {
  if (useAI) return aiLearn(text);
  await new Promise((r) => setTimeout(r, 450)); // ให้เห็นว่ากำลังประมวลผล
  return processLearning(text);
}

export default {
  id: 'learn',
  label: 'เรียนรู้',
  icon: 'bulb',
  subtitle: () => {
    const n = learningsBetween(todayKey(), todayKey()).length;
    return n ? `วันนี้เรียนรู้แล้ว ${n} เรื่อง · จดต่อได้เรื่อย ๆ` : 'วันนี้เรียนรู้อะไรบ้าง? จดไว้ แล้วระบบจัดหมวดให้';
  },

  mount(root) {
    const track = enterTracker();
    let range = '30';
    let cat = 'all';
    let limit = PAGE;
    let review = null; // [{ text, cat }] ที่รอตรวจ
    let busy = false;
    let first = true;

    root.innerHTML = `
      <div class="learn-view">
        <div class="goal-stats" id="ln-stats"></div>

        <div class="learn-grid">
          <div class="card ln-compose">
            <div class="card-head"><h3>${icon('edit')}วันนี้เรียนรู้อะไรบ้าง?</h3>
              <input class="input ln-date" type="date" id="ln-date" value="${todayKey()}" max="${todayKey()}" aria-label="วันที่" /></div>
            <textarea class="textarea" id="ln-text" rows="5" maxlength="4000" placeholder="${esc(PLACEHOLDERS[new Date().getDate() % PLACEHOLDERS.length])}"></textarea>
            <div class="ln-actions">
              <button class="btn btn-primary" type="button" data-act="process">${icon('sparkles')}ประมวลผล & จัดหมวด</button>
              ${aiReady() ? `<button class="btn btn-outline" type="button" data-act="ai">🤖 ให้ AI ช่วยสรุป</button>` : ''}
              <span class="muted ln-hint">แยกเป็นข้อ ๆ ให้อัตโนมัติ</span>
            </div>
            <div id="ln-review" hidden></div>
          </div>

          <div class="ln-side">
            <div class="card ln-chat-cta">
              <div class="ln-cta-bubbles" aria-hidden="true"><span>💡</span><span>📚</span><span>🔥</span></div>
              <h3>💬 แชทรายงาน</h3>
              <p>สรุปสิ่งที่ได้เรียนรู้พร้อมอิโมจิ ส่งเข้า LINE ได้ในแตะเดียว</p>
              <div class="ln-cta-btns">
                <button class="btn btn-line btn-sm" type="button" data-report="today">วันนี้</button>
                <button class="btn btn-glass btn-sm" type="button" data-report="week">สัปดาห์นี้</button>
                <button class="btn btn-glass btn-sm" type="button" data-report="month">เดือนนี้</button>
              </div>
            </div>
            <div class="card">
              <div class="card-head"><h3>${icon('chart')}หมวดการเรียนรู้</h3><span class="muted ln-small">30 วันล่าสุด</span></div>
              <div id="ln-cats"></div>
            </div>
          </div>
        </div>

        <div class="card ln-journal">
          <div class="card-head ln-journal-head">
            <h3>${icon('note')}สมุดบันทึกการเรียนรู้</h3>
            <div id="ln-range"></div>
          </div>
          <div class="chips ln-filter" id="ln-filter"></div>
          <div id="ln-list"></div>
        </div>
      </div>`;

    const textEl = $('#ln-text', root);
    const reviewEl = $('#ln-review', root);

    $('#ln-range', root).innerHTML = segmented(RANGES, range, { name: 'lnrange' });
    bindSegmented($('[data-seg="lnrange"]', root), (v) => {
      range = v;
      limit = PAGE;
      track.reset();
      renderList();
      renderFilter();
    });

    // ---------- สถิติ ----------
    const renderStats = () => {
      const today = learningsBetween(todayKey(), todayKey()).length;
      const all = learnings().length;
      const st = learnStreak();
      const recent = learningsBetween(toKey(addDays(new Date(), -29)), todayKey());
      const top = byCategory(recent).sort((a, b) => b.n - a.n)[0];
      $('#ln-stats', root).innerHTML = `
        <div class="card mini-stat">${tile('bulb', '#d9a21b')}<div><b data-count="${today}">${today}</b><p class="muted">เรื่องวันนี้</p></div></div>
        <div class="card mini-stat">${tile('fire', '#f97316', st ? 'flame' : '')}<div><b data-count="${st}">${st}</b><p class="muted">วันต่อเนื่อง</p></div></div>
        <div class="card mini-stat">${tile('book', '#0ea5e9')}<div><b data-count="${all}">${all}</b><p class="muted">เรื่องทั้งหมด</p></div></div>
        <div class="card mini-stat">${top ? tile(top.cat.icon, top.cat.color) : tile('trophy', '#94a3b8')}<div><b class="ln-top">${top ? esc(top.cat.short) : '–'}</b><p class="muted">หมวดเด่น 30 วัน</p></div></div>`;
      if (first) $$('[data-count]', root).forEach((n) => countUp(n, Number(n.dataset.count)));
    };

    // ---------- หมวด (กราฟแท่ง) ----------
    const renderCats = () => {
      const list = learningsBetween(toKey(addDays(new Date(), -29)), todayKey());
      const groups = byCategory(list).sort((a, b) => b.n - a.n);
      const host = $('#ln-cats', root);
      if (!groups.length) {
        host.innerHTML = emptyState('🗂️', 'ยังไม่มีหมวด', 'จดสิ่งที่ได้เรียนรู้ แล้วระบบจะจัดหมวดให้เอง', true);
        return;
      }
      const max = groups[0].n;
      host.innerHTML = `<div class="ln-bars">${groups
        .map(
          (g, i) => `<button type="button" class="ln-bar${cat === g.cat.id ? ' on' : ''}" data-cat="${g.cat.id}" style="--i:${i};--c:${g.cat.color}">
            <span class="ln-bar-label">${tile(g.cat.icon, g.cat.color, 'xxs')}${esc(g.cat.label)}</span>
            <span class="progress"><span data-p="${Math.round((g.n / max) * 100)}%" style="--p:0%;--c:${g.cat.color}"></span></span>
            <b>${g.n}</b></button>`,
        )
        .join('')}</div>`;
      animateMeters(host);
    };

    // ---------- รายการย้อนหลัง ----------
    const inRange = () => {
      if (range === 'all') return learnings();
      return learningsBetween(toKey(addDays(new Date(), -(Number(range) - 1))), todayKey());
    };

    const renderFilter = () => {
      const list = inRange();
      const counts = {};
      list.forEach((l) => (counts[l.cat] = (counts[l.cat] || 0) + 1));
      $('#ln-filter', root).innerHTML = [
        `<button class="chip ${cat === 'all' ? 'active' : ''}" data-cat="all">ทุกหมวด <span class="seg-count">${list.length}</span></button>`,
        ...LEARN_CATS.filter((c) => counts[c.id] || cat === c.id).map(
          (c) => `<button class="chip ${cat === c.id ? 'active' : ''}" data-cat="${c.id}">${c.emoji} ${c.short} <span class="seg-count">${counts[c.id] || 0}</span></button>`,
        ),
      ].join('');
    };

    const renderList = () => {
      track.frame();
      let list = inRange();
      if (cat !== 'all') list = list.filter((l) => l.cat === cat);
      list = [...list].sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
      const host = $('#ln-list', root);
      if (!list.length) {
        host.innerHTML = emptyState(
          cat === 'all' ? '🌱' : learnCat(cat).emoji,
          cat === 'all' ? 'ยังไม่มีบันทึกในช่วงนี้' : `ยังไม่มีเรื่องหมวด${learnCat(cat).label}`,
          'เริ่มจากวันละ 1 เรื่องเล็ก ๆ ก็พอ',
          true,
        );
        return;
      }
      const shown = list.slice(0, limit);
      const days = [];
      shown.forEach((l) => {
        if (!days.length || days[days.length - 1].date !== l.date) days.push({ date: l.date, items: [] });
        days[days.length - 1].items.push(l);
      });
      host.innerHTML =
        days
          .map(
            (d) => `<section class="ln-day">
            <h4 class="ln-day-head"><span>${dayTitle(d.date)}</span><span class="count">${d.items.length}</span></h4>
            <ul class="ln-items">${d.items
              .map((l) => {
                const c = learnCat(l.cat);
                const { cls, vars } = track.attrs(l.id);
                return `<li class="ln-item${cls}" data-ln="${l.id}" style="${vars}--c:${c.color}" tabindex="0" role="button" aria-label="แก้ไข: ${esc(l.text)}">
                  <span class="ln-emoji" title="${esc(c.label)}">${tile(c.icon, c.color, 'sm')}</span>
                  <div class="ln-body"><p>${esc(l.text)}</p><span class="ln-cat">${esc(c.label)}${l.source === 'ai' ? ' · 🤖 AI' : l.source === 'review' ? ' · 🌙 สรุปวัน' : ''}</span></div>
                  <button type="button" class="icon-btn sm danger" data-del aria-label="ลบ">${icon('trash')}</button>
                </li>`;
              })
              .join('')}</ul></section>`,
          )
          .join('') + (list.length > limit ? `<div class="ln-more"><button class="btn btn-ghost btn-sm" data-more>แสดงเพิ่ม (${list.length - limit})</button></div>` : '');
    };

    // ---------- ตรวจผลการประมวลผล ----------
    const renderReview = () => {
      if (!review) {
        reviewEl.hidden = true;
        reviewEl.innerHTML = '';
        return;
      }
      reviewEl.hidden = false;
      const n = review.length;
      reviewEl.innerHTML = `
        <div class="ln-review-head"><b>✨ แยกได้ ${n} เรื่อง</b><span class="muted">แตะหมวดเพื่อเปลี่ยน · แก้ข้อความได้</span></div>
        <ul class="ln-review">${review
          .map((p, i) => {
            const c = learnCat(p.cat);
            return `<li class="ln-rv" data-i="${i}" style="--i:${i};--c:${c.color}">
              <button type="button" class="ln-rv-cat" data-pick="${i}" aria-label="เปลี่ยนหมวด (ตอนนี้: ${esc(c.label)})"><span>${c.emoji}</span><small>${esc(c.short)}</small></button>
              <textarea class="ln-rv-text" rows="1" data-text="${i}" aria-label="ข้อความ">${esc(p.text)}</textarea>
              <button type="button" class="icon-btn sm" data-drop="${i}" aria-label="ไม่บันทึกข้อนี้">${icon('x')}</button>
              <div class="ln-picker" data-picker="${i}" hidden>${LEARN_CATS.map((x) => `<button type="button" class="chip${x.id === p.cat ? ' active' : ''}" data-set="${x.id}">${x.emoji} ${x.short}</button>`).join('')}</div>
            </li>`;
          })
          .join('')}</ul>
        <div class="ln-review-foot">
          <button class="btn btn-ghost btn-sm" type="button" data-act="cancel">ยกเลิก</button>
          <button class="btn btn-gold" type="button" data-act="save">💾 บันทึก ${n} เรื่อง</button>
        </div>`;
      $$('.ln-rv-text', reviewEl).forEach(fit);
    };
    const fit = (ta) => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    };

    const runProcess = async (useAI) => {
      const text = textEl.value.trim();
      if (!text) {
        textEl.focus();
        textEl.classList.remove('shake');
        void textEl.offsetWidth;
        textEl.classList.add('shake');
        return toast('พิมพ์สิ่งที่ได้เรียนรู้ก่อนนะ', { icon: '✍️' });
      }
      if (busy) return;
      busy = true;
      const btn = $(`[data-act="${useAI ? 'ai' : 'process'}"]`, root);
      const label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="btn-spin"></span>${useAI ? 'AI กำลังอ่าน…' : 'กำลังประมวลผล…'}`;
      try {
        let pts = await process(text, { useAI });
        if (!pts.length) pts = processLearning(text);
        if (!pts.length) throw new Error('ไม่พบข้อความที่แยกได้');
        review = pts.map((p) => ({ text: p.text, cat: learnCat(p.cat).id, ai: !!p.ai }));
        renderReview();
        reviewEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (err) {
        toast(err.message, { icon: '⚠️', duration: 5000, ...(useAI ? { action: 'ใช้แบบปกติ', onAction: () => runProcess(false) } : {}) });
      } finally {
        busy = false;
        btn.disabled = false;
        btn.innerHTML = label;
      }
    };

    const saveReview = (btn) => {
      const pts = review.filter((p) => p.text.trim());
      if (!pts.length) return;
      const date = $('#ln-date', root).value || todayKey();
      const ai = pts.some((p) => p.ai);
      saveLearnings(pts, date > todayKey() ? todayKey() : date, ai ? 'ai' : '');
      const r = btn.getBoundingClientRect();
      confetti({ x: r.left + r.width / 2, y: r.top, count: 28, spread: Math.PI, power: 7 });
      const cats = [...new Set(pts.map((p) => learnCat(p.cat).emoji))].join(' ');
      toast(`บันทึก ${pts.length} เรื่องแล้ว ${cats}`, { icon: '💡', action: 'ส่งรายงาน', onAction: () => openLearnReport({ period: date === todayKey() ? 'today' : 'week' }), duration: 6000 });
      review = null;
      textEl.value = '';
      renderReview();
    };

    // ---------- events ----------
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'process') return runProcess(false);
      if (act === 'ai') return runProcess(true);
      if (act === 'cancel') {
        review = null;
        return renderReview();
      }
      if (act === 'save') return saveReview(e.target.closest('[data-act]'));

      const rep = e.target.closest('[data-report]');
      if (rep) return openLearnReport({ period: rep.dataset.report });

      // ในส่วนตรวจทาน
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const p = $(`[data-picker="${pick.dataset.pick}"]`, reviewEl);
        $$('[data-picker]', reviewEl).forEach((x) => x !== p && (x.hidden = true));
        p.hidden = !p.hidden;
        return;
      }
      const set = e.target.closest('[data-set]');
      if (set) {
        const i = Number(set.closest('[data-picker]').dataset.picker);
        review[i].cat = set.dataset.set;
        renderReview();
        const cell = $(`.ln-rv[data-i="${i}"] .ln-rv-cat`, reviewEl);
        cell?.classList.add('pop');
        return;
      }
      const drop = e.target.closest('[data-drop]');
      if (drop) {
        review.splice(Number(drop.dataset.drop), 1);
        if (!review.length) review = null;
        return renderReview();
      }

      // ตัวกรองหมวด (ชิปหรือกราฟ)
      const c = e.target.closest('[data-cat]');
      if (c) {
        cat = cat === c.dataset.cat && c.classList.contains('ln-bar') ? 'all' : c.dataset.cat;
        limit = PAGE;
        track.reset();
        renderFilter();
        renderCats();
        renderList();
        if (c.classList.contains('ln-bar')) $('.ln-journal', root).scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (e.target.closest('[data-more]')) {
        limit += PAGE;
        return renderList();
      }
      const item = e.target.closest('[data-ln]');
      if (item) {
        const l = store.find('learnings', item.dataset.ln);
        if (!l) return;
        if (e.target.closest('[data-del]')) {
          return removeWithUndo('learnings', l.id, item);
        }
        openLearnEdit(l);
      }
    });

    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target === textEl) {
        e.preventDefault();
        runProcess(false);
      }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ln-item')) {
        e.preventDefault();
        openLearnEdit(store.find('learnings', e.target.dataset.ln));
      }
    });
    root.addEventListener('input', (e) => {
      const t = e.target.closest('[data-text]');
      if (t) {
        review[Number(t.dataset.text)].text = t.value;
        fit(t);
      }
    });

    const renderAll = () => {
      renderStats();
      renderCats();
      renderFilter();
      renderList();
      first = false;
    };
    renderAll();

    return {
      update(change) {
        if (!change || ['settings', 'day'].includes(change.type)) return;
        if (change.col && change.col !== 'learnings') return;
        renderAll();
      },
      onResize() {
        $$('.segmented', root).forEach((s) => moveSegIndicator(s, true));
      },
      focusInput() {
        textEl.focus();
      },
    };
  },
};
