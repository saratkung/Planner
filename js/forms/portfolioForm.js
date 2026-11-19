// ==========================================================
// portfolioForm.js — เพิ่ม/แก้ไขผลงาน และหน้ารายละเอียดผลงาน
// ==========================================================
import { store } from '../core/store.js';
import { esc, todayKey, formatDate, $, $$ } from '../core/utils.js';
import {
  PF_TYPES, pfType, ROLES, FIGURE_HINTS, sensitiveWarnings, withUnit, itemText,
} from '../core/portfolio.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { confetti } from '../ui/confetti.js';
import { uploadAttachment, canAttach } from '../sync/drive.js';

const isImage = (f) => /^image\//.test(f.mime || '');
const fileIcon = (f) => (isImage(f) ? '🖼️' : /pdf/.test(f.mime || '') ? '📄' : /word|document/.test(f.mime || '') ? '📝' : '📎');
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

/** รูปย่อขนาดเล็ก (เก็บในแอป ให้เห็นรูปได้ทันทีโดยไม่ต้องโหลดจาก Drive) */
async function makeThumb(file) {
  if (!/^image\//.test(file.type)) return '';
  try {
    const bmp = await createImageBitmap(file);
    const s = 160 / Math.max(bmp.width, bmp.height);
    const w = Math.max(1, Math.round(bmp.width * Math.min(1, s)));
    const h = Math.max(1, Math.round(bmp.height * Math.min(1, s)));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.62);
  } catch (_) {
    return '';
  }
}

export function fileChip(f, { removable = false, i = 0 } = {}) {
  const thumb = f.thumb ? `<img src="${esc(f.thumb)}" alt="" loading="lazy" />` : `<span class="pf-file-ico">${fileIcon(f)}</span>`;
  const inner = `${thumb}<span class="pf-file-name">${esc(f.name || 'ไฟล์')}</span>`;
  if (f.uploading) return `<span class="pf-file uploading"><span class="btn-spin"></span><span class="pf-file-name">${esc(f.name)}</span></span>`;
  return `<span class="pf-file">${safeUrl(f.link) ? `<a href="${esc(f.link)}" target="_blank" rel="noopener" title="เปิดใน Google Drive">${inner}</a>` : inner}${
    removable ? `<button type="button" class="pf-file-x" data-rmfile="${i}" aria-label="เอาไฟล์ออก">${icon('x')}</button>` : ''
  }</span>`;
}

/** เพิ่ม / แก้ไขผลงาน (prefill = ร่างจากหน้าอื่น) */
export function openPortfolioForm(item = null, prefill = {}) {
  const isEdit = !!item;
  const d = {
    type: 'case', title: '', date: todayKey(), endDate: '', role: '', org: '', result: '', lesson: '',
    figures: [], files: [], links: [], highlight: false, source: null,
    ...(item ? JSON.parse(JSON.stringify(item)) : {}), ...prefill,
  };
  let type = d.type;
  let figures = d.figures.length ? d.figures : [];
  let files = d.files;
  let links = d.links;
  let uploading = 0;

  const figRow = (f, i) => `<div class="pf-fig" data-fig="${i}">
      <input class="input" list="pf-fig-labels" placeholder="เช่น จับกุมผู้ต้องหา" value="${esc(f.label || '')}" data-fk="label" aria-label="ชื่อตัวเลข" maxlength="40" />
      <input class="input" type="number" inputmode="decimal" placeholder="0" value="${f.n ?? ''}" data-fk="n" aria-label="จำนวน" />
      <input class="input" list="pf-fig-units" placeholder="หน่วย" value="${esc(f.unit || '')}" data-fk="unit" aria-label="หน่วย" maxlength="12" />
      <button type="button" class="icon-btn sm" data-rmfig="${i}" aria-label="ลบตัวเลขนี้">${icon('x')}</button>
    </div>`;

  openModal({
    title: isEdit ? '✏️ แก้ไขผลงาน' : '🏆 เพิ่มผลงานเข้าแฟ้ม',
    size: 640,
    body: `
      <form class="form-grid pf-form" id="pf-form" novalidate>
        <div class="field"><label>ประเภทผลงาน</label>
          <div class="chips pf-types" role="radiogroup" aria-label="ประเภทผลงาน">${PF_TYPES.map(
            (t) => `<button type="button" class="chip${t.id === type ? ' active' : ''}" role="radio" aria-checked="${t.id === type}" data-type="${t.id}" style="--c:${t.color}">${t.emoji} ${t.short}</button>`,
          ).join('')}</div></div>
        <div class="field"><label for="pf-title">ชื่อผลงาน</label>
          <input class="input" id="pf-title" required maxlength="140" value="${esc(d.title)}" placeholder="เช่น สืบสวนจับกุมเครือข่ายยาเสพติด" /></div>
        <div class="row">
          <div class="field"><label for="pf-date">วันที่</label><input class="input" type="date" id="pf-date" value="${esc(d.date)}" /></div>
          <div class="field"><label for="pf-end">ถึงวันที่ <span class="muted">(ถ้ามี)</span></label><input class="input" type="date" id="pf-end" value="${esc(d.endDate || '')}" /></div>
        </div>
        <div class="row">
          <div class="field"><label for="pf-role">บทบาทของเรา</label>
            <input class="input" id="pf-role" list="pf-roles" maxlength="60" value="${esc(d.role)}" placeholder="เช่น หัวหน้าชุด" /></div>
          <div class="field"><label for="pf-org">หน่วยงาน / ผู้มอบ / สถานที่</label>
            <input class="input" id="pf-org" maxlength="80" value="${esc(d.org)}" /></div>
        </div>
        <div class="field"><label for="pf-result">ผลการปฏิบัติ / รายละเอียด</label>
          <textarea class="textarea" id="pf-result" rows="3" maxlength="2000" placeholder="ทำอะไร ใช้วิธีไหน ได้ผลอย่างไร">${esc(d.result)}</textarea></div>
        <p class="pf-privacy" id="pf-privacy" hidden></p>
        <div class="field"><label>ตัวเลขผลงาน <span class="muted">(ใช้รวมยอดในรายงาน)</span></label>
          <div id="pf-figs" class="pf-figs"></div>
          <button type="button" class="btn btn-ghost btn-sm pf-addfig" data-addfig>${icon('plus')}เพิ่มตัวเลข</button></div>
        <div class="field"><label for="pf-lesson">💡 บทเรียนที่ได้ <span class="muted">(ถ้ามี)</span></label>
          <textarea class="textarea" id="pf-lesson" rows="2" maxlength="1000">${esc(d.lesson)}</textarea></div>
        <div class="field"><label>หลักฐาน / ไฟล์แนบ</label>
          <div class="pf-files" id="pf-files"></div>
          <div class="pf-attach">
            <label class="btn btn-outline btn-sm pf-upload${canAttach() ? '' : ' disabled'}">${icon('upload')}แนบรูป / ไฟล์
              <input type="file" id="pf-file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" ${canAttach() ? '' : 'disabled'} hidden /></label>
            <span class="muted pf-attach-hint">${canAttach() ? 'เก็บใน Google Drive ของคุณ (โฟลเดอร์ “Life Planner – แฟ้มผลงาน”)' : 'เชื่อม Google ในตั้งค่าก่อน จึงจะแนบไฟล์ได้ · หรือวางลิงก์ด้านล่าง'}</span>
          </div>
          <div class="pf-linkadd"><input class="input" id="pf-link" type="url" placeholder="วางลิงก์ เช่น ข่าว หรือไฟล์ใน Drive แล้วกด Enter" />
            <button type="button" class="btn btn-ghost btn-sm" data-addlink>${icon('link')}เพิ่มลิงก์</button></div>
          <ul class="pf-links" id="pf-links"></ul></div>
        <label class="switch-row"><input type="checkbox" id="pf-hl" ${d.highlight ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span><span>⭐ ผลงานเด่น (แสดงก่อน และเลือกเฉพาะผลงานเด่นตอนออกรายงานได้)</span></label>
        <datalist id="pf-roles">${ROLES.map((r) => `<option value="${esc(r)}"></option>`).join('')}</datalist>
        <datalist id="pf-fig-labels">${FIGURE_HINTS.map((f) => `<option value="${esc(f.label)}"></option>`).join('')}</datalist>
        <datalist id="pf-fig-units">${[...new Set(FIGURE_HINTS.map((f) => f.unit))].map((u) => `<option value="${esc(u)}"></option>`).join('')}</datalist>
      </form>`,
    footer: `${isEdit ? `<button class="btn btn-danger" type="button" data-del>${icon('trash')}ลบ</button>` : ''}
      <span class="spacer"></span>
      <button class="btn btn-ghost hide-mobile" type="button" data-close>ยกเลิก</button>
      <button class="btn btn-primary" type="submit" form="pf-form" data-save>${icon('check')}${isEdit ? 'บันทึก' : 'เก็บเข้าแฟ้ม'}</button>`,
    onMount(root, close) {
      const form = $('#pf-form', root);
      const renderFigs = () => ($('#pf-figs', root).innerHTML = figures.map(figRow).join(''));
      const renderFiles = () => {
        $('#pf-files', root).innerHTML = files.map((f, i) => fileChip(f, { removable: true, i })).join('');
        $('[data-save]', root).disabled = uploading > 0;
      };
      const renderLinks = () =>
        ($('#pf-links', root).innerHTML = links
          .map((u, i) => `<li><a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${icon('link')}${esc(u)}</a><button type="button" class="icon-btn sm" data-rmlink="${i}" aria-label="ลบลิงก์">${icon('x')}</button></li>`)
          .join(''));
      const privacy = () => {
        const warn = sensitiveWarnings([$('#pf-title', root).value, $('#pf-result', root).value, $('#pf-lesson', root).value].join(' '));
        const el = $('#pf-privacy', root);
        const caseNote = type === 'case' && !warn.length;
        el.hidden = !warn.length && !caseNote;
        el.className = `pf-privacy${warn.length ? ' warn' : ''}`;
        el.innerHTML = warn.length
          ? `⚠️ พบข้อความที่อาจเป็น<b>${warn.join(' / ')}</b> ควรลบออก แฟ้มผลงานควรมีแค่ผลงานและบทบาทของเรา`
          : '🔒 เพื่อความปลอดภัย ไม่ต้องใส่ชื่อ เลขบัตร หรือที่อยู่ของผู้ต้องหา / ผู้เสียหาย';
      };
      renderFigs();
      renderFiles();
      renderLinks();
      privacy();

      const syncFigs = () =>
        $$('[data-fig]', root).forEach((row) => {
          const i = Number(row.dataset.fig);
          figures[i] = {
            label: $('[data-fk="label"]', row).value.trim(),
            n: $('[data-fk="n"]', row).value === '' ? '' : Number($('[data-fk="n"]', row).value),
            unit: $('[data-fk="unit"]', row).value.trim(),
          };
        });

      const addLink = () => {
        const inp = $('#pf-link', root);
        let u = inp.value.trim();
        if (!u) return;
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        try {
          new URL(u);
        } catch (_) {
          return toast('ลิงก์ไม่ถูกต้อง', { icon: '⚠️' });
        }
        links.push(u);
        inp.value = '';
        renderLinks();
      };

      root.addEventListener('input', (e) => {
        if (e.target.closest('[data-fig]')) {
          syncFigs();
          // เลือกชื่อที่แนะนำ → เติมหน่วยให้
          if (e.target.dataset.fk === 'label') {
            const hint = FIGURE_HINTS.find((h) => h.label === e.target.value.trim());
            const unit = $('[data-fk="unit"]', e.target.closest('[data-fig]'));
            if (hint && !unit.value) {
              unit.value = hint.unit;
              syncFigs();
            }
          }
        }
        if (['pf-title', 'pf-result', 'pf-lesson'].includes(e.target.id)) privacy();
      });

      root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.id === 'pf-link') {
          e.preventDefault();
          addLink();
        }
      });

      $('#pf-file', root)?.addEventListener('change', async (e) => {
        const list = [...e.target.files];
        e.target.value = '';
        for (const file of list) {
          const tmp = { name: file.name, uploading: true };
          files.push(tmp);
          uploading++;
          renderFiles();
          try {
            const [up, thumb] = await Promise.all([uploadAttachment(file), makeThumb(file)]);
            Object.assign(tmp, up, { thumb, uploading: false });
            delete tmp.uploading;
          } catch (err) {
            files = files.filter((f) => f !== tmp);
            toast(err.message, { icon: '⚠️', duration: 5000 });
          } finally {
            uploading--;
            renderFiles();
          }
        }
      });

      root.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-type]');
        if (t) {
          type = t.dataset.type;
          $$('[data-type]', root).forEach((b) => {
            b.classList.toggle('active', b === t);
            b.setAttribute('aria-checked', b === t);
          });
          privacy();
          return;
        }
        if (e.target.closest('[data-addfig]')) {
          syncFigs();
          figures.push({ label: '', n: '', unit: '' });
          renderFigs();
          $$('[data-fig] [data-fk="label"]', root).pop()?.focus();
          return;
        }
        const rf = e.target.closest('[data-rmfig]');
        if (rf) {
          syncFigs();
          figures.splice(Number(rf.dataset.rmfig), 1);
          return renderFigs();
        }
        const rmf = e.target.closest('[data-rmfile]');
        if (rmf) {
          files.splice(Number(rmf.dataset.rmfile), 1);
          renderFiles();
          return toast('เอาไฟล์ออกจากผลงานแล้ว (ไฟล์ยังอยู่ใน Google Drive)', { icon: '📎' });
        }
        if (e.target.closest('[data-addlink]')) return addLink();
        const rl = e.target.closest('[data-rmlink]');
        if (rl) {
          links.splice(Number(rl.dataset.rmlink), 1);
          return renderLinks();
        }
        if (e.target.closest('.pf-upload.disabled')) {
          return toast('เชื่อม Google ในตั้งค่าก่อน จึงจะแนบไฟล์ได้', { icon: '🔗' });
        }
        if (e.target.closest('[data-del]')) {
          close();
          if (!(await confirmDialog({ title: 'ลบผลงานนี้?', message: esc(item.title), okLabel: 'ลบ', danger: true }))) return;
          const snap = store.remove('portfolio', item.id);
          toast('ลบผลงานแล้ว', { icon: '🗑️', action: 'เลิกทำ', onAction: () => store.restore(snap), duration: 5000 });
        }
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (uploading) return toast('รออัปโหลดไฟล์ให้เสร็จก่อน', { icon: '⏳' });
        const title = $('#pf-title', root).value.trim();
        if (!title) {
          const inp = $('#pf-title', root);
          inp.focus();
          inp.classList.remove('shake');
          void inp.offsetWidth;
          inp.classList.add('shake');
          return;
        }
        syncFigs();
        const date = $('#pf-date', root).value || todayKey();
        let endDate = $('#pf-end', root).value || '';
        if (endDate && endDate < date) endDate = '';
        const data = {
          type, title, date, endDate,
          role: $('#pf-role', root).value.trim(),
          org: $('#pf-org', root).value.trim(),
          result: $('#pf-result', root).value.trim(),
          lesson: $('#pf-lesson', root).value.trim(),
          figures: figures.filter((f) => f.label && f.n !== '' && Number.isFinite(Number(f.n))).map((f) => ({ ...f, n: Number(f.n) })),
          files: files.filter((f) => f.id),
          links,
          highlight: $('#pf-hl', root).checked,
          source: d.source || null,
        };
        if (isEdit) {
          store.update('portfolio', item.id, data);
          toast('บันทึกผลงานแล้ว', { icon: '🏆' });
        } else {
          store.add('portfolio', data);
          const r = $('[data-save]', root).getBoundingClientRect();
          confetti({ x: r.left + r.width / 2, y: r.top, count: 34, spread: Math.PI, power: 8 });
          toast(`เก็บ “${title}” เข้าแฟ้มผลงานแล้ว`, { icon: pfType(type).emoji, action: 'ดูแฟ้ม', onAction: () => (location.hash = '#portfolio') });
        }
        close();
      });
    },
  });
}

/** รายละเอียดผลงาน */
export function openPortfolioDetail(id) {
  const p = store.find('portfolio', id);
  if (!p) return;
  const t = pfType(p.type);
  const src = p.source && store.find(p.source.col, p.source.id);
  openModal({
    title: `${t.emoji} ${esc(t.label)}`,
    size: 600,
    body: `
      <article class="pfd" style="--c:${t.color}">
        <div class="pfd-hero">
          <span class="pfd-emoji">${t.emoji}</span>
          <div><h3>${esc(p.title)}${p.highlight ? ' <span class="pf-star" title="ผลงานเด่น">⭐</span>' : ''}</h3>
            <p class="muted">${formatDate(p.date, { weekday: true })}${p.endDate && p.endDate !== p.date ? ` – ${formatDate(p.endDate)}` : ''}</p></div>
        </div>
        <div class="pfd-tags">
          ${p.role ? `<span class="tag accent">👤 ${esc(p.role)}</span>` : ''}
          ${p.org ? `<span class="tag">🏢 ${esc(p.org)}</span>` : ''}
        </div>
        ${p.figures.length ? `<div class="pf-figpills">${p.figures.map((f) => `<span class="pf-figpill"><b>${esc(withUnit(f.n, f.unit))}</b>${esc(f.label)}</span>`).join('')}</div>` : ''}
        ${p.result ? `<section><h4 class="section-title">${icon('note')} ผลการปฏิบัติ</h4><p class="pfd-text">${esc(p.result)}</p></section>` : ''}
        ${p.lesson ? `<section><h4 class="section-title">💡 บทเรียนที่ได้</h4><p class="pfd-text">${esc(p.lesson)}</p></section>` : ''}
        ${p.files.length || p.links.length ? `<section><h4 class="section-title">📎 หลักฐาน</h4>
          <div class="pf-files">${p.files.map((f) => fileChip(f)).join('')}</div>
          ${p.links.length ? `<ul class="pf-links">${p.links.map((u) => `<li><a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${icon('link')}${esc(u)}</a></li>`).join('')}</ul>` : ''}</section>` : ''}
        ${src ? `<p class="muted pfd-src">ที่มา: ${p.source.col === 'events' ? '👥 ประชุม' : p.source.col === 'goals' ? '🎯 เป้าหมาย' : '💡 การเรียนรู้'} “${esc(src.title || src.text)}”</p>` : ''}
      </article>`,
    footer: `<button class="icon-btn" type="button" data-pfd="copy" title="คัดลอกข้อความ" aria-label="คัดลอกข้อความ">${icon('copy')}</button>
      <button class="btn btn-line btn-sm" type="button" data-pfd="line">💬 ส่ง LINE</button>
      <span class="spacer"></span>
      <button class="btn btn-outline btn-sm" type="button" data-pfd="edit">${icon('edit')}แก้ไข</button>`,
    onMount(root, close) {
      root.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-pfd]')?.dataset.pfd;
        if (act === 'edit') {
          close(true);
          return openPortfolioForm(store.find('portfolio', id));
        }
        if (act === 'line') {
          const { sendToLine } = await import('./learnReport.js');
          return sendToLine(itemText(p));
        }
        if (act === 'copy') {
          try {
            await navigator.clipboard.writeText(itemText(p));
            toast('คัดลอกแล้ว', { icon: '📋' });
          } catch (_) {
            toast('คัดลอกไม่ได้ในเบราว์เซอร์นี้', { icon: '⚠️' });
          }
        }
      });
    },
  });
}
