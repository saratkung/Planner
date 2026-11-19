// ==========================================================
// portfolio.js (feature) — แฟ้มสะสมผลงาน: การ์ด / เส้นทาง (Timeline) / สรุปตัวเลข
// ==========================================================
import { store } from '../core/store.js';
import { esc, todayKey, fromKey, formatDate, thaiYear, THAI_MONTHS_SHORT, enterTracker, countUp, $, $$ } from '../core/utils.js';
import {
  PF_TYPES, pfType, portfolio, filterPortfolio, countByType, sumFigures, fmtNum, withUnit, fiscalYear, fiscalRange, figureText,
} from '../core/portfolio.js';
import { icon } from '../ui/icons.js';
import { emptyState, segmented, bindSegmented, moveSegIndicator } from '../ui/widgets.js';
import { openPortfolioForm, openPortfolioDetail } from '../forms/portfolioForm.js';
import { openPortfolioReport } from '../forms/portfolioReport.js';
import { openPortfolioPaste } from '../forms/portfolioPaste.js';

const VIEW_KEY = 'planner.pfView';
const FIG_EMOJI = [
  [/จับ|ผู้ต้องหา/, '🚔'], [/ยึด|ทรัพย์|บาท|เงิน/, '💰'], [/ของกลาง/, '📦'], [/ผู้เสียหาย|ช่วยเหลือ/, '🤝'],
  [/ชั่วโมง|อบรม/, '⏱️'], [/ผู้เข้าร่วม|คน/, '👥'],
];
const figEmoji = (f) => (FIG_EMOJI.find(([re]) => re.test(`${f.label} ${f.unit}`)) || [null, '🔢'])[1];
const shortDate = (k) => {
  const d = fromKey(k);
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]} ${String(thaiYear(d)).slice(2)}`;
};

function card(p, track) {
  const t = pfType(p.type);
  const { cls, vars } = track.attrs(p.id);
  const thumbs = p.files.filter((f) => f.thumb).slice(0, 3);
  const more = p.files.length + p.links.length - thumbs.length;
  return `<article class="card pf-card card-hover${p.highlight ? ' hl' : ''}${cls}" style="${vars}--c:${t.color}" data-pf="${p.id}" tabindex="0" role="button" aria-label="${esc(p.title)}">
    <div class="pf-card-top">
      <span class="pf-badge">${t.emoji}</span>
      <div class="pf-card-meta"><span class="pf-type">${esc(t.label)}</span><span class="muted">${shortDate(p.date)}${p.endDate && p.endDate !== p.date ? ` – ${shortDate(p.endDate)}` : ''}</span></div>
      ${p.highlight ? '<span class="pf-star" title="ผลงานเด่น">⭐</span>' : ''}
    </div>
    <h3>${esc(p.title)}</h3>
    ${p.role || p.org ? `<p class="pf-role">${p.role ? `👤 ${esc(p.role)}` : ''}${p.role && p.org ? ' · ' : ''}${p.org ? esc(p.org) : ''}</p>` : ''}
    ${p.result ? `<p class="pf-result">${esc(p.result)}</p>` : ''}
    ${p.figures.length ? `<div class="pf-figpills">${p.figures.slice(0, 3).map((f) => `<span class="pf-figpill"><b>${figEmoji(f)} ${esc(withUnit(f.n, f.unit))}</b>${esc(f.label)}</span>`).join('')}</div>` : ''}
    ${thumbs.length || more > 0 ? `<div class="pf-thumbs">${thumbs.map((f) => `<img src="${esc(f.thumb)}" alt="" loading="lazy" />`).join('')}${more > 0 ? `<span class="pf-more">📎 ${more}</span>` : ''}</div>` : ''}
  </article>`;
}

function timeline(list, track) {
  const years = [];
  list.forEach((p) => {
    const y = thaiYear(fromKey(p.date));
    if (!years.length || years[years.length - 1].y !== y) years.push({ y, items: [] });
    years[years.length - 1].items.push(p);
  });
  return `<div class="pf-tl">${years
    .map(
      (yr) => `<section class="pf-year">
        <h3 class="pf-year-head"><span>พ.ศ. ${yr.y}</span><small>${yr.items.length} ผลงาน · ${countByType(yr.items).map((c) => c.type.emoji).join('')}</small></h3>
        <ol>${yr.items
          .map((p) => {
            const t = pfType(p.type);
            const { cls, vars } = track.attrs('tl' + p.id);
            const big = p.type === 'career' || p.highlight;
            return `<li class="pf-node${big ? ' big' : ''}${cls}" style="${vars}--c:${t.color}" data-pf="${p.id}" tabindex="0" role="button">
              <span class="pf-dot">${t.emoji}</span>
              <div class="pf-node-body">
                <span class="pf-node-date">${formatDate(p.date, { short: true, year: false })} · ${esc(t.short)}${p.highlight ? ' · ⭐' : ''}</span>
                <b>${esc(p.title)}</b>
                ${p.role ? `<span class="muted">${esc(p.role)}</span>` : ''}
                ${p.figures.length ? `<span class="pf-node-fig">${p.figures.slice(0, 2).map((f) => `${figEmoji(f)} ${esc(figureText(f))}`).join(' · ')}</span>` : ''}
              </div>
            </li>`;
          })
          .join('')}</ol>
      </section>`,
    )
    .join('')}
    <div class="pf-tl-start"><span>🌱</span>จุดเริ่มต้น</div></div>`;
}

export default {
  id: 'portfolio',
  label: 'แฟ้มผลงาน',
  icon: 'trophy',
  subtitle: () => {
    const n = portfolio().length;
    return n ? `เก็บไว้แล้ว ${n} ผลงาน · ทุกก้าวที่ผ่านมามีความหมาย` : 'เก็บผลงานที่ผ่านมา ไว้ดูภาพรวมและออกรายงานประเมิน';
  },

  mount(root) {
    const track = enterTracker();
    let view = 'cards';
    try {
      view = localStorage.getItem(VIEW_KEY) || 'cards';
    } catch (_) {}
    let type = 'all';
    let year = 'all';
    let onlyHl = false;
    let first = true;
    let io = null;

    root.innerHTML = `
      <div class="pf-view">
        <div class="goal-stats" id="pf-stats"></div>
        <div class="pf-figbar" id="pf-figbar"></div>
        <div class="tasks-toolbar pf-toolbar">
          <div id="pf-viewseg"></div>
          <div class="pf-tools">
            <select class="select pf-year-sel" id="pf-year" aria-label="ปี"></select>
            <button class="btn btn-outline" id="pf-report">📄 ออกรายงาน</button>
            <button class="btn btn-gold" id="pf-paste" title="วางข้อความจาก LINE / ข่าว / รายงาน แล้วแยกเป็นผลงานให้">${icon('clipboard')}วางข้อความ</button>
            <button class="btn btn-primary" id="pf-new">${icon('plus')}เพิ่มผลงาน</button>
          </div>
        </div>
        <div class="chips" id="pf-types"></div>
        <div id="pf-body"></div>
      </div>`;

    $('#pf-viewseg', root).innerHTML = segmented(
      [
        { id: 'cards', label: 'การ์ด', icon: icon('grid') },
        { id: 'timeline', label: 'เส้นทาง', icon: icon('flag') },
      ],
      view,
      { name: 'pfview' },
    );
    bindSegmented($('[data-seg="pfview"]', root), (v) => {
      view = v;
      try {
        localStorage.setItem(VIEW_KEY, v);
      } catch (_) {}
      track.reset();
      renderBody();
    });

    const filtered = () => {
      let from;
      let to;
      if (year !== 'all') ({ from, to } = fiscalRange(Number(year)));
      return filterPortfolio({ from, to, types: type === 'all' ? null : [type], highlight: onlyHl });
    };

    const renderStats = () => {
      const all = portfolio();
      const fy = fiscalYear();
      const { from, to } = fiscalRange(fy);
      const thisFy = all.filter((p) => p.date >= from && p.date <= to).length;
      const years = all.length ? thaiYear(new Date()) - Math.min(...all.map((p) => thaiYear(fromKey(p.date)))) + 1 : 0;
      $('#pf-stats', root).innerHTML = `
        <div class="card mini-stat"><span class="ms-emoji">🏆</span><div><b data-count="${all.length}">${all.length}</b><p class="muted">ผลงานทั้งหมด</p></div></div>
        <div class="card mini-stat"><span class="ms-emoji">⭐</span><div><b data-count="${all.filter((p) => p.highlight).length}">${all.filter((p) => p.highlight).length}</b><p class="muted">ผลงานเด่น</p></div></div>
        <div class="card mini-stat"><span class="ms-emoji">🗓️</span><div><b data-count="${thisFy}">${thisFy}</b><p class="muted">ปีงบประมาณ ${fy}</p></div></div>
        <div class="card mini-stat"><span class="ms-emoji">🛤️</span><div><b data-count="${years}">${years}</b><p class="muted">ปีที่บันทึกไว้</p></div></div>`;
      if (first) $$('[data-count]', root).forEach((n) => countUp(n, Number(n.dataset.count)));
      const figs = sumFigures(filtered()).slice(0, 6);
      $('#pf-figbar', root).innerHTML = figs.length
        ? figs.map((f, i) => `<div class="pf-total" style="--i:${i}"><span>${figEmoji(f)}</span><b>${fmtNum(f.n, f.unit)}</b><small>${esc(f.unit)} · ${esc(f.label)}</small></div>`).join('')
        : '';
      $('#pf-figbar', root).hidden = !figs.length;
    };

    const renderFilters = () => {
      const all = portfolio();
      const counts = {};
      all.forEach((p) => (counts[p.type] = (counts[p.type] || 0) + 1));
      $('#pf-types', root).innerHTML = [
        `<button class="chip ${type === 'all' ? 'active' : ''}" data-type="all">ทุกประเภท</button>`,
        ...PF_TYPES.filter((t) => counts[t.id] || type === t.id).map((t) => `<button class="chip ${type === t.id ? 'active' : ''}" data-type="${t.id}">${t.emoji} ${t.short} <span class="seg-count">${counts[t.id] || 0}</span></button>`),
        `<button class="chip ${onlyHl ? 'active' : ''}" data-hl>⭐ เฉพาะผลงานเด่น</button>`,
      ].join('');
      const fys = [...new Set(all.map((p) => fiscalYear(p.date)))].sort((a, b) => b - a);
      $('#pf-year', root).innerHTML = `<option value="all">ทุกปี</option>${fys.map((y) => `<option value="${y}" ${String(y) === year ? 'selected' : ''}>ปีงบ ${y}</option>`).join('')}`;
    };

    const renderBody = () => {
      track.frame();
      io?.disconnect();
      const list = filtered();
      const host = $('#pf-body', root);
      if (!list.length) {
        const none = !portfolio().length;
        host.innerHTML = `<div class="card pf-empty">${
          none
            ? emptyState('🗂️', 'แฟ้มผลงานยังว่างอยู่', 'เริ่มจากผลงานที่ภูมิใจที่สุด 3 อย่าง แล้วค่อยเติมย้อนหลังทีละนิด')
            : emptyState('🔍', 'ไม่มีผลงานตามที่เลือก', 'ลองเปลี่ยนประเภทหรือปี')
        }${none ? `<div class="pf-empty-ideas">${['🕵️ คดีที่ภูมิใจ', '🏅 รางวัล / หนังสือชมเชย', '🎓 หลักสูตรที่ผ่าน', '📈 วันที่ได้เลื่อนตำแหน่ง'].map((x) => `<span>${x}</span>`).join('')}</div>
          <div class="pf-empty-btns"><button class="btn btn-gold" data-paste>${icon('clipboard')}วางข้อความ</button><button class="btn btn-primary" data-new>${icon('plus')}กรอกเอง</button></div>` : ''}</div>`;
        return;
      }
      if (view === 'timeline') {
        host.innerHTML = timeline(list, track);
        // ค่อย ๆ ปรากฏตอนเลื่อนลง
        const nodes = $$('.pf-node', host);
        if ('IntersectionObserver' in window) {
          io = new IntersectionObserver((ents) => ents.forEach((en) => en.isIntersecting && (en.target.classList.add('in'), io.unobserve(en.target))), { rootMargin: '0px 0px -8% 0px' });
          nodes.forEach((n) => io.observe(n));
        } else nodes.forEach((n) => n.classList.add('in'));
      } else {
        const hl = list.filter((p) => p.highlight);
        const rest = list.filter((p) => !p.highlight);
        host.innerHTML = `${hl.length && !onlyHl ? `<h4 class="section-title pf-sec">⭐ ผลงานเด่น <span class="count">${hl.length}</span></h4><div class="pf-grid">${hl.map((p) => card(p, track)).join('')}</div>` : ''}
          ${rest.length || onlyHl ? `${hl.length && !onlyHl ? `<h4 class="section-title pf-sec">🗂️ ผลงานทั้งหมด <span class="count">${rest.length}</span></h4>` : ''}<div class="pf-grid">${(onlyHl ? list : rest).map((p) => card(p, track)).join('')}</div>` : ''}`;
      }
    };

    const renderAll = () => {
      renderStats();
      renderFilters();
      renderBody();
      first = false;
    };

    $('#pf-new', root).addEventListener('click', () => openPortfolioForm());
    $('#pf-report', root).addEventListener('click', () => openPortfolioReport());
    $('#pf-paste', root).addEventListener('click', () => openPortfolioPaste());
    $('#pf-year', root).addEventListener('change', (e) => {
      year = e.target.value;
      track.reset();
      renderStats();
      renderBody();
    });
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-new]')) return openPortfolioForm();
      if (e.target.closest('[data-paste]')) return openPortfolioPaste();
      const tb = e.target.closest('#pf-types [data-type]');
      if (tb) {
        type = tb.dataset.type;
        track.reset();
        renderFilters();
        renderStats();
        return renderBody();
      }
      if (e.target.closest('#pf-types [data-hl]')) {
        onlyHl = !onlyHl;
        track.reset();
        renderFilters();
        renderStats();
        return renderBody();
      }
      const it = e.target.closest('[data-pf]');
      if (it) openPortfolioDetail(it.dataset.pf);
    });
    root.addEventListener('keydown', (e) => {
      const it = e.target.closest?.('[data-pf]');
      if (it && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openPortfolioDetail(it.dataset.pf);
      }
    });

    renderAll();
    return {
      update(change) {
        if (change?.col && change.col !== 'portfolio') return;
        if (change?.type === 'day') return;
        renderAll();
      },
      onResize: () => $$('.segmented', root).forEach((s) => moveSegIndicator(s, true)),
      unmount: () => io?.disconnect(),
    };
  },
};
