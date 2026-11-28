// ==========================================================
// portfolioReport.js — ออกรายงานแฟ้มผลงาน: เอกสารทางการ (พิมพ์ / บันทึก PDF) และข้อความส่ง LINE
// ==========================================================
import { store } from '../core/store.js';
import { esc, todayKey, formatDate, $, $$ } from '../core/utils.js';
import {
  PF_TYPES, periodRange, rangeText, filterPortfolio, countByType, sumFigures, figureText, withUnit,
  profileLines, portfolioText,
} from '../core/portfolio.js';
import { openModal } from '../ui/modal.js';
import { segmented, bindSegmented } from '../ui/widgets.js';
import { toast } from '../ui/toast.js';
import { icon, tile, chipIcon } from '../ui/icons.js';
import { sendToLine } from './learnReport.js';

const PERIODS = [
  { id: 'fy', label: 'ปีงบนี้' },
  { id: 'prevfy', label: 'ปีงบก่อน' },
  { id: 'year', label: 'ปีนี้' },
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'custom', label: 'กำหนดเอง' },
];
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const thaiNum = (n) => String(n).replace(/\d/g, (d) => THAI_DIGITS[d]);
const short = (k) => formatDate(k, { short: true });

/** เอกสารรายงาน (HTML สำหรับพิมพ์ A4) */
export function reportHTML(list, range, { links = true } = {}) {
  const who = profileLines();
  const counts = countByType(list);
  const figs = sumFigures(list);
  const sections = counts
    .map(({ type }, si) => {
      const items = [...list.filter((p) => p.type === type.id)].sort((a, b) => (a.date < b.date ? -1 : 1));
      return `<h2>${thaiNum(si + 2)}. ผลงานด้าน${esc(type.label)} (${thaiNum(items.length)} รายการ)</h2>
      <table><thead><tr><th class="c-no">ที่</th><th class="c-date">วัน เดือน ปี</th><th>ผลงาน / ผลการปฏิบัติ</th><th class="c-role">บทบาท</th>${links ? '<th class="c-ev">หลักฐาน</th>' : ''}</tr></thead>
      <tbody>${items
        .map((p, i) => {
          const ev = [...p.files.map((f) => (f.link ? `<a href="${esc(f.link)}">${esc(f.name)}</a>` : `รูป ${esc(f.name)}`)), ...p.links.map((u) => `<a href="${esc(u)}">ลิงก์ ${p.links.indexOf(u) + 1}</a>`)];
          return `<tr><td class="c-no">${i + 1}</td>
            <td class="c-date">${short(p.date)}${p.endDate && p.endDate !== p.date ? `<br>– ${short(p.endDate)}` : ''}</td>
            <td><b>${p.highlight ? '★ ' : ''}${esc(p.title)}</b>${p.org ? `<div class="sub">${esc(p.org)}</div>` : ''}
              ${p.result ? `<div class="res">${esc(p.result)}</div>` : ''}
              ${p.figures.length ? `<div class="fig">${p.figures.map((f) => esc(figureText(f))).join(' · ')}</div>` : ''}</td>
            <td class="c-role">${esc(p.role || '-')}</td>
            ${links ? `<td class="c-ev">${ev.length ? ev.join('<br>') : '-'}</td>` : ''}</tr>`;
        })
        .join('')}</tbody></table>`;
    })
    .join('');

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>แฟ้มสะสมผลงาน${who.name ? ' – ' + esc(who.name) : ''}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 2cm 2cm 2cm 3cm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', 'TH Sarabun New', Tahoma, sans-serif; font-size: 14pt; line-height: 1.45; color: #000; margin: 0; padding: 24px; background: #fff; }
  .page { max-width: 760px; margin: 0 auto; }
  h1 { text-align: center; font-size: 20pt; margin: 0 0 2px; }
  .range { text-align: center; margin: 0 0 14px; }
  .who { margin: 0 0 14px; }
  .who div { display: flex; gap: 8px; }
  .who b { min-width: 90px; display: inline-block; }
  h2 { font-size: 15pt; margin: 18px 0 6px; break-after: avoid; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5pt; }
  th, td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; text-align: left; }
  th { background: #eee; text-align: center; font-weight: 600; }
  tr { break-inside: avoid; }
  .c-no { width: 34px; text-align: center; } .c-date { width: 92px; } .c-role { width: 110px; } .c-ev { width: 120px; font-size: 11pt; word-break: break-all; }
  .sub { font-size: 11.5pt; color: #333; } .res { margin-top: 2px; white-space: pre-wrap; } .fig { margin-top: 2px; font-weight: 600; }
  .sum td:last-child { text-align: right; width: 140px; }
  .sign { margin-top: 36px; margin-left: 45%; text-align: center; break-inside: avoid; }
  .sign p { margin: 4px 0; }
  .note { font-size: 11pt; color: #444; margin-top: 18px; }
  a { color: #000; }
  .empty { text-align: center; padding: 40px 0; }
  @media print { body { padding: 0; } a { text-decoration: none; } }
</style></head><body><div class="page">
  <h1>แฟ้มสะสมผลงาน</h1>
  <p class="range">${esc(range.label)}${rangeText(range) ? ` (${esc(rangeText(range))})` : ''}</p>
  <div class="who">
    ${who.name ? `<div><b>ชื่อ</b><span>${esc(who.name)}</span></div>` : ''}
    ${who.position ? `<div><b>ตำแหน่ง</b><span>${esc(who.position)}</span></div>` : ''}
    ${who.unit ? `<div><b>สังกัด</b><span>${esc(who.unit)}</span></div>` : ''}
  </div>
  ${list.length ? `
  <h2>${thaiNum(1)}. สรุปผลงาน</h2>
  <table class="sum"><tbody>
    ${counts.map((c) => `<tr><td>ผลงานด้าน${esc(c.type.label)}</td><td>${c.n} รายการ</td></tr>`).join('')}
    <tr><td><b>รวมทั้งสิ้น</b></td><td><b>${list.length} รายการ</b></td></tr>
    ${figs.map((f) => `<tr><td>${esc(f.label)}</td><td>${esc(withUnit(f.n, f.unit))}</td></tr>`).join('')}
  </tbody></table>
  ${sections}` : '<p class="empty">ไม่มีผลงานในช่วงเวลาที่เลือก</p>'}
  <div class="sign">
    <p>ขอรับรองว่าข้อมูลข้างต้นเป็นความจริง</p>
    <p style="margin-top:28px">(ลงชื่อ) ..................................................</p>
    <p>( ${esc(who.name || '..................................................')} )</p>
    ${who.position ? `<p>ตำแหน่ง ${esc(who.position)}</p>` : '<p>ตำแหน่ง ..................................................</p>'}
    <p>วันที่ ${formatDate(todayKey())}</p>
  </div>
  <p class="note">★ = ผลงานเด่น · จัดทำจาก Life Planner</p>
</div></body></html>`;
}

/** พิมพ์ / บันทึกเป็น PDF ผ่าน iframe ที่ซ่อนไว้ */
async function printHTML(html) {
  const frame = document.createElement('iframe');
  frame.className = 'print-frame';
  frame.setAttribute('aria-hidden', 'true');
  document.body.appendChild(frame);
  frame.srcdoc = html;
  await new Promise((r) => (frame.onload = r));
  try {
    await Promise.race([frame.contentDocument.fonts?.ready, new Promise((r) => setTimeout(r, 2500))]);
  } catch (_) {}
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60000);
}

export function openPortfolioReport() {
  const pf = { ...(store.state.settings.profile || {}) };
  let per = 'fy';
  let custom = { from: '', to: todayKey() };
  let types = new Set(PF_TYPES.map((t) => t.id));
  let highlight = false;
  let links = true;
  let timer;

  const current = () => {
    const range = periodRange(per, custom);
    return { range, list: filterPortfolio({ from: range.from, to: range.to, types: [...types], highlight }) };
  };

  openModal({
    title: '📄 ออกรายงานแฟ้มผลงาน',
    size: 720,
    body: `
      <div class="pfr">
        <button type="button" class="pfr-word" data-r="salary">
          <span class="pfr-word-ico">${icon('note')}</span>
          <span><b>แบบรายงานเลื่อนเงินเดือน (.docx)</b><small>ไฟล์ Word ตามแบบฟอร์ม · เลือกรอบ 1 เม.ย. / 1 ต.ค. · พร้อมภาพประกอบ</small></span>
          ${icon('right')}
        </button>
        <details class="pfr-profile" ${pf.fullName || store.state.settings.name ? '' : 'open'}>
          <summary>👤 ข้อมูลผู้จัดทำ <span class="muted" id="pfr-who"></span></summary>
          <div class="pfr-grid">
            <div class="field"><label for="pfr-rank">ยศ</label><input class="input" id="pfr-rank" data-pf="rank" maxlength="20" placeholder="เช่น ร.ต.อ." value="${esc(pf.rank)}" /></div>
            <div class="field"><label for="pfr-name">ชื่อ – สกุล</label><input class="input" id="pfr-name" data-pf="fullName" maxlength="60" value="${esc(pf.fullName || store.state.settings.name || '')}" /></div>
            <div class="field"><label for="pfr-pos">ตำแหน่ง</label><input class="input" id="pfr-pos" data-pf="position" maxlength="80" value="${esc(pf.position)}" /></div>
            <div class="field"><label for="pfr-unit">สังกัด</label><input class="input" id="pfr-unit" data-pf="unit" maxlength="100" value="${esc(pf.unit)}" /></div>
          </div>
        </details>
        <div class="pfr-period">${segmented(PERIODS, per, { name: 'pfrper', block: true })}</div>
        <div class="row pfr-custom" hidden>
          <div class="field"><label for="pfr-from">ตั้งแต่</label><input class="input" type="date" id="pfr-from" /></div>
          <div class="field"><label for="pfr-to">ถึง</label><input class="input" type="date" id="pfr-to" value="${custom.to}" /></div>
        </div>
        <div class="chips pfr-types">${PF_TYPES.map((t) => `<button type="button" class="chip active" data-t="${t.id}" style="--c:${t.color}">${chipIcon(t.icon, t.color)}${t.short}</button>`).join('')}</div>
        <div class="pfr-opts">
          <label class="switch-row"><input type="checkbox" id="pfr-hl" /><span class="switch" aria-hidden="true"></span><span>เฉพาะ ⭐ ผลงานเด่น</span></label>
          <label class="switch-row"><input type="checkbox" id="pfr-links" checked /><span class="switch" aria-hidden="true"></span><span>ใส่ลิงก์หลักฐาน</span></label>
        </div>
        <p class="pfr-count" id="pfr-count"></p>
        <div class="pfr-preview"><iframe id="pfr-frame" title="ตัวอย่างรายงาน" loading="lazy"></iframe></div>
      </div>`,
    footer: `<button class="icon-btn" type="button" data-r="copy" title="คัดลอกข้อความ" aria-label="คัดลอกข้อความ">${icon('copy')}</button>
      <button class="btn btn-line btn-sm" type="button" data-r="line">💬 ส่ง LINE</button>
      <span class="spacer"></span>
      <button class="btn btn-primary" type="button" data-r="print">📄 พิมพ์ / บันทึก PDF</button>`,
    onMount(root) {
      const frame = $('#pfr-frame', root);
      const render = () => {
        const { range, list } = current();
        $('#pfr-count', root).innerHTML = `${esc(range.label)}${rangeText(range) ? ` · ${esc(rangeText(range))}` : ''} · <b>${list.length} ผลงาน</b>`;
        const who = profileLines();
        $('#pfr-who', root).textContent = who.name ? `· ${who.name}` : '· ยังไม่ได้กรอก';
        frame.srcdoc = reportHTML(list, range, { links });
      };
      const savePf = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          store.setSettings({ profile: { ...pf } });
          render();
        }, 400);
      };
      bindSegmented($('[data-seg="pfrper"]', root), (v) => {
        per = v;
        $('.pfr-custom', root).hidden = v !== 'custom';
        render();
      });
      root.addEventListener('input', (e) => {
        const k = e.target.dataset.pf;
        if (k) {
          pf[k] = e.target.value.trim();
          return savePf();
        }
        if (e.target.id === 'pfr-from' || e.target.id === 'pfr-to') {
          custom = { from: $('#pfr-from', root).value, to: $('#pfr-to', root).value };
          render();
        }
      });
      root.addEventListener('change', (e) => {
        if (e.target.id === 'pfr-hl') highlight = e.target.checked;
        if (e.target.id === 'pfr-links') links = e.target.checked;
        if (e.target.id === 'pfr-hl' || e.target.id === 'pfr-links') render();
      });
      root.addEventListener('click', async (e) => {
        const tb = e.target.closest('[data-t]');
        if (tb) {
          const id = tb.dataset.t;
          if (types.has(id) && types.size === 1) return;
          types.has(id) ? types.delete(id) : types.add(id);
          tb.classList.toggle('active', types.has(id));
          return render();
        }
        const act = e.target.closest('[data-r]')?.dataset.r;
        if (!act) return;
        if (act === 'salary') {
          const { openSalaryReport } = await import('./salaryReport.js');
          return openSalaryReport();
        }
        const { range, list } = current();
        if (act === 'print') {
          if (!list.length) return toast('ไม่มีผลงานในช่วงที่เลือก', { icon: '📭' });
          return printHTML(reportHTML(list, range, { links }));
        }
        const text = portfolioText(list, range);
        if (act === 'line') return sendToLine(text);
        try {
          await navigator.clipboard.writeText(text);
          toast('คัดลอกแล้ว วางใน LINE ได้เลย', { icon: '📋' });
        } catch (_) {
          toast('คัดลอกไม่ได้ในเบราว์เซอร์นี้', { icon: '⚠️' });
        }
      });
      render();
    },
    onClose: () => {
      clearTimeout(timer);
      if (JSON.stringify(pf) !== JSON.stringify(store.state.settings.profile)) store.setSettings({ profile: { ...pf } });
    },
  });
}

