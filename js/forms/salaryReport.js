// ==========================================================
// salaryReport.js — แบบรายงานผลการปฏิบัติงานเพื่อประกอบการพิจารณาเลื่อนเงินเดือน (.docx)
// เลือกรอบ → เลือกผลงาน/หัวข้อ → สร้างไฟล์ Word พร้อมภาพประกอบ
// ==========================================================
import { store } from '../core/store.js';
import { esc, fromKey, THAI_MONTHS, THAI_MONTHS_SHORT, thaiYear, $, $$ } from '../core/utils.js';
import { pfType } from '../core/portfolio.js';
import { buildDocx, prepareImage } from '../core/docxWriter.js';
import { bestPhotoURL, isPhoto, putPhoto, photoURL, makePreview } from '../core/photoStore.js';
import { openModal } from '../ui/modal.js';
import { segmented, bindSegmented } from '../ui/widgets.js';
import { toast } from '../ui/toast.js';
import { icon, chipIcon } from '../ui/icons.js';

const PORTRAIT_KEY = 'profile-photo';
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const thaiNum = (s) => String(s).replace(/\d/g, (d) => THAI_DIGITS[d]);

export const defaultSalaryReport = () => ({
  sections: [
    { id: 'act', heading: 'การเข้าร่วมกิจกรรมจิตอาสา หรือกิจกรรมของหน่วยงาน (ระบุชื่อกิจกรรม วันที่จัดกิจกรรม และสถานที่)', types: ['volunteer', 'mission', 'training', 'speaker'] },
    { id: 'pride', heading: 'ผลงานหรือรางวัล ที่เป็นความภาคภูมิใจ/คุณงามความดีที่ได้รับ (ระบุชื่อรางวัล และหน่วยงานที่ให้รางวัล)', types: ['award', 'career', 'project', 'case', 'other'] },
  ],
  conduct: { on: true, heading: 'ความประพฤติ เคยถูกตัดคะแนนความประพฤติ หรือไม่', clean: true },
  certify: 'ขอรับรองว่าข้อมูลดังกล่าวเป็นความจริง',
  thaiNum: false,
  photos: true,
  portrait: true,
});
const cfg = () => {
  const d = defaultSalaryReport();
  const s = store.state.settings.salaryReport || {};
  return { ...d, ...s, conduct: { ...d.conduct, ...(s.conduct || {}) }, sections: s.sections?.length ? s.sections : d.sections };
};

/** รอบประเมิน: ครั้งที่ 1 = 1 เม.ย. (ผลงาน 1 ต.ค.–31 มี.ค.) · ครั้งที่ 2 = 1 ต.ค. (ผลงาน 1 เม.ย.–30 ก.ย.) */
export function roundInfo(yearBE, n) {
  const y = yearBE - 543;
  return n === 1
    ? { from: `${y - 1}-10-01`, to: `${y}-03-31`, label: 'ครั้งที่ 1 ครึ่งปีแรก', date: `1 เมษายน ${yearBE}` }
    : { from: `${y}-04-01`, to: `${y}-09-30`, label: 'ครั้งที่ 2 ครึ่งปีหลัง', date: `1 ตุลาคม ${yearBE}` };
}
/** รอบที่กำลังจะถึง */
function upcoming() {
  const d = new Date();
  const m = d.getMonth();
  const be = thaiYear(d);
  if (m < 3) return { year: be, n: 1 };
  if (m < 9) return { year: be, n: 2 };
  return { year: be + 1, n: 1 };
}

const shortDate = (k) => {
  const d = fromKey(k);
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]}${String(thaiYear(d)).slice(2)}`;
};
const fullDate = (k) => {
  const d = fromKey(k);
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${thaiYear(d)}`;
};

/** ข้อความของผลงาน 1 ข้อ: ใช้ข้อความเดิม (จากไฟล์ที่นำเข้า) ถ้ามี ไม่อย่างนั้นประกอบจาก ชื่อ + สถานที่ + วันที่ */
export function itemLine(p) {
  const r = (p.result || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => s.replace(/[^\p{L}\p{N}]/gu, '');
  if (r && r.length <= 360 && norm(r).startsWith(norm(p.title).slice(0, 14))) return r;
  const parts = [p.title.replace(/…$/, '')];
  if (p.org && !p.title.includes(p.org)) parts.push(`ณ ${p.org}`);
  if (p.endDate && p.endDate !== p.date) parts.push(`ระหว่างวันที่ ${shortDate(p.date)} – ${shortDate(p.endDate)}`);
  else if (p.date && !/-01-01$/.test(p.date)) parts.push(`วันที่ ${shortDate(p.date)}`);
  return parts.join(' ');
}

async function photoBlob(f) {
  const url = (await bestPhotoURL(f)) || f.thumb;
  if (!url) return null;
  try {
    return await (await fetch(url)).blob();
  } catch (_) {
    return null;
  }
}

/** สร้างเอกสาร */
export async function buildSalaryDocx(o, onProgress = () => {}) {
  const base = 16;
  const blocks = [];
  const images = [];
  let n = 0;
  const addImage = async (blob, maxW, maxH) => {
    const im = await prepareImage(blob);
    images.push(im);
    n++;
    const ar = im.w / im.h;
    let w = maxW;
    let h = w / ar;
    if (h > maxH) {
      h = maxH;
      w = h * ar;
    }
    return { rid: `rIdImg${images.length}`, n, file: `image${images.length}.jpeg`, wCm: w, hCm: h };
  };
  const num = (k) => (o.thaiNum ? thaiNum(k) : String(k));
  const titleParas = o.title.split('\n').filter((l) => l.trim()).map((l) => ({ text: l.trim(), bold: true, align: 'center' }));

  // หัวรายงาน (+ รูปถ่ายหน้าตรงมุมขวา)
  if (o.portraitBlob) {
    const img = await addImage(o.portraitBlob, 2.4, 3.2);
    blocks.push({ type: 'table', widths: [13.4, 2.85], rows: [[{ vAlign: 'center', paragraphs: titleParas }, { paragraphs: [{ align: 'right', images: [img] }] }]] });
  } else blocks.push(...titleParas);
  blocks.push({ text: '' });
  blocks.push({ text: `${num(1)}. ยศ ชื่อ สกุล ${o.name}`, bold: true, after: 6 });

  // หัวข้อและผลงาน
  let sec = 2;
  for (const s of o.sections) {
    blocks.push({ text: `${num(sec)}. ${s.heading}`, bold: true, indent: { left: 0.63, hanging: 0.63 }, before: 4, keepNext: true });
    if (!s.items.length) blocks.push({ text: '-', indent: { firstLine: 0.63 } });
    s.items.forEach((it, k) => blocks.push({ text: `${num(k + 1)}) ${it.line}`, indent: { firstLine: 0.63 } }));
    sec++;
  }
  if (o.conduct.on) {
    blocks.push({ text: `${num(sec)}. ${o.conduct.heading}`, bold: true, indent: { left: 0.63, hanging: 0.63 }, before: 4, keepNext: true });
    blocks.push({ text: `${o.conduct.clean ? '☑' : '☐'} ไม่เคยถูกตัดคะแนนความประพฤติ`, indent: { firstLine: 0.63 } });
    blocks.push({ text: `${o.conduct.clean ? '☐' : '☑'} เคยถูกตัดคะแนนความประพฤติ จำนวน.................คะแนน ฐานความผิด........................................`, indent: { firstLine: 0.63 } });
  }

  // ลงชื่อรับรอง
  const sign = (text) => ({ text, align: 'center', indent: { left: 6 }, keepNext: true });
  blocks.push({ text: '' }, { text: '' }, sign(o.certify), { text: '' }, sign('(ลงชื่อ).......................................'), sign(`(${o.signName || '.......................................'})`));
  if (o.position) blocks.push(sign(o.position));

  // ภาพประกอบ
  const withPhotos = o.photos ? o.sections.flatMap((s) => s.items).filter((it) => it.photos.length) : [];
  if (withPhotos.length) {
    blocks.push({ text: 'ภาพประกอบ', bold: true, align: 'center', pageBreakBefore: true });
    blocks.push(...titleParas.map((p) => ({ ...p })));
    blocks.push({ text: '' });
    const total = withPhotos.reduce((a, it) => a + it.photos.length, 0);
    let done = 0;
    for (const it of withPhotos) {
      const blobs = [];
      for (const f of it.photos) {
        const b = await photoBlob(f);
        if (b) blobs.push(b);
        onProgress(++done, total);
      }
      if (!blobs.length) continue;
      const single = blobs.length === 1;
      for (let i = 0; i < blobs.length; i += 2) {
        const pair = blobs.slice(i, i + 2);
        const imgs = [];
        for (const b of pair) imgs.push(await addImage(b, single ? 13.5 : 7.8, single ? 9 : 6.5));
        blocks.push({ align: 'center', images: imgs, keepNext: true, after: 2 });
      }
      blocks.push({ text: it.line, align: 'center', after: 14 });
    }
  }
  return buildDocx({ blocks, images, size: base, title: o.title.split('\n')[0], author: o.signName || '' });
}

/** บันทึก/แชร์ไฟล์ */
async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  const mobile = matchMedia('(pointer: coarse)').matches;
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancel';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(a.href);
  }, 4000);
  return 'downloaded';
}

export function openSalaryReport() {
  const c = cfg();
  const pf = store.state.settings.profile || {};
  const up = upcoming();
  let year = up.year;
  let round = up.n;
  let titleEdited = false;
  let showAll = false;
  let sections = c.sections.map((s) => ({ ...s }));
  // ผลงานที่เลือก: id → { on, sec, line }
  const pick = new Map();
  const all = [...(store.state.portfolio || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const secFor = (p) => (sections.find((s) => s.types?.includes(p.type)) || sections[sections.length - 1]).id;
  const inRound = (p) => {
    const r = roundInfo(year, round);
    return p.date >= r.from && p.date <= r.to;
  };
  const defaults = () => {
    pick.clear();
    all.forEach((p) => {
      const sec = secFor(p);
      // หัวข้อผลงาน/รางวัล: ใส่ทุกปี (แบบฟอร์มให้ระบุตั้งแต่เริ่มรับราชการ) · หัวข้อกิจกรรม: เฉพาะในรอบ
      const on = sec === sections[sections.length - 1].id ? true : inRound(p);
      pick.set(p.id, { on, sec, line: itemLine(p) });
    });
  };
  defaults();
  const titleFor = () => {
    const r = roundInfo(year, round);
    return `รายงานผลการปฏิบัติงานเพื่อใช้ประกอบการพิจารณาเลื่อนเงินเดือน\nของ ${pf.position || '..............................'}\nประจำปี ${year} ${r.label} (${r.date})`;
  };
  let save = null;
  const persist = () => {
    clearTimeout(save);
    save = setTimeout(() => {
      const cur = cfg();
      store.setSettings({ salaryReport: { ...cur, sections: sections.map(({ id, heading, types }) => ({ id, heading, types })), conduct: opt.conduct, thaiNum: opt.thaiNum, photos: opt.photos, portrait: opt.portrait, certify: opt.certify } });
    }, 500);
  };
  const opt = { conduct: { ...c.conduct }, thaiNum: c.thaiNum, photos: c.photos, portrait: c.portrait, certify: c.certify };

  openModal({
    title: '📝 แบบรายงานเลื่อนเงินเดือน (Word)',
    size: 820,
    body: `
      <div class="sr">
        <div class="sr-round">
          <label class="sr-year"><span>ปี พ.ศ.</span><select class="select" id="sr-year">${[up.year - 1, up.year, up.year + 1].map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
          <div id="sr-roundseg"></div>
          <p class="muted sr-period" id="sr-period"></p>
        </div>
        <div class="field"><label for="sr-title">หัวรายงาน</label><textarea class="textarea sr-title" id="sr-title" rows="3">${esc(titleFor())}</textarea></div>
        <div class="row">
          <div class="field"><label for="sr-name">ยศ ชื่อ สกุล</label><input class="input" id="sr-name" value="${esc([pf.rank, pf.fullName || store.state.settings.name].filter(Boolean).join(''))}" placeholder="เช่น ว่าที่ ร.ต.ต.สมชาย ใจดี" /></div>
          <div class="field"><label for="sr-pos">ตำแหน่ง (ใต้ลายเซ็น)</label><input class="input" id="sr-pos" value="${esc(pf.position || '')}" placeholder="เช่น รอง สว.ประจำ รร.นรต." /></div>
        </div>
        <div class="sr-portrait">
          <span class="sr-face" id="sr-face">${icon('users')}</span>
          <div><b>รูปถ่ายหน้าตรง (มุมขวาบน)</b><p class="muted">เก็บไว้ในเครื่องนี้ ใช้ซ้ำได้ทุกรอบ</p></div>
          <label class="btn btn-outline btn-sm">${icon('image')}เลือกรูป<input type="file" id="sr-face-file" accept="image/*" hidden /></label>
          <label class="switch-row"><input type="checkbox" id="sr-portrait" ${opt.portrait ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span><span>ใส่รูป</span></label>
        </div>
        <h4 class="section-title">${icon('list')} หัวข้อในรายงาน <span class="muted sr-note">ข้อ 1 คือ ยศ ชื่อ สกุล</span></h4>
        <div id="sr-sections"></div>
        <button type="button" class="btn btn-ghost btn-sm" data-sr="addsec">${icon('plus')}เพิ่มหัวข้อ (เช่น แยกตามช่วงเวลา)</button>
        <h4 class="section-title sr-items-head">${icon('trophy')} ผลงานที่จะใส่ <span class="count" id="sr-count"></span>
          <span class="sr-filter" id="sr-filter"></span></h4>
        <div class="sr-items" id="sr-items"></div>
        <div class="sr-opts">
          <label class="switch-row"><input type="checkbox" id="sr-photos" ${opt.photos ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span><span>แนบภาพประกอบท้ายรายงาน (หน้าใหม่)</span></label>
          <label class="switch-row"><input type="checkbox" id="sr-thai" ${opt.thaiNum ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span><span>ใช้เลขไทยในลำดับข้อ</span></label>
          <label class="switch-row"><input type="checkbox" id="sr-conduct" ${opt.conduct.on ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span><span>ใส่หัวข้อความประพฤติ</span></label>
          <div class="sr-conduct" ${opt.conduct.on ? '' : 'hidden'}>
            <input class="input" id="sr-conduct-h" value="${esc(opt.conduct.heading)}" aria-label="หัวข้อความประพฤติ" />
            <div class="chips"><button type="button" class="chip ${opt.conduct.clean ? 'active' : ''}" data-clean="1">☑ ไม่เคยถูกตัดคะแนน</button><button type="button" class="chip ${opt.conduct.clean ? '' : 'active'}" data-clean="0">☑ เคยถูกตัดคะแนน (กรอกเองใน Word)</button></div>
          </div>
          <div class="field"><label for="sr-certify">ข้อความรับรอง</label><input class="input" id="sr-certify" value="${esc(opt.certify)}" /></div>
        </div>
        <div class="sr-progress" id="sr-progress" hidden></div>
      </div>`,
    footer: `<span class="sp-count" id="sr-summary"></span><span class="spacer"></span>
      <button class="btn btn-ghost hide-mobile" data-close type="button">ปิด</button>
      <button class="btn btn-primary" type="button" data-sr="build">${icon('download')}สร้างไฟล์ Word</button>`,
    onMount(root) {
      const secEl = $('#sr-sections', root);
      const itemsEl = $('#sr-items', root);
      const num = (k) => (opt.thaiNum ? thaiNum(k) : k);

      const renderSections = () => {
        secEl.innerHTML = sections
          .map(
            (s, i) => `<div class="sr-sec" data-sec="${s.id}"><span class="sr-num">${num(i + 2)}.</span>
              <textarea class="textarea" rows="2" data-head="${s.id}" aria-label="หัวข้อที่ ${i + 2}">${esc(s.heading)}</textarea>
              ${sections.length > 1 ? `<button type="button" class="icon-btn sm danger" data-delsec="${s.id}" aria-label="ลบหัวข้อ">${icon('trash')}</button>` : ''}</div>`,
          )
          .join('');
      };
      const renderItems = () => {
        const r = roundInfo(year, round);
        $('#sr-period', root).textContent = `ผลงานในรอบนี้: ${fullDate(r.from)} – ${fullDate(r.to)}`;
        const list = showAll ? all : all.filter((p) => pick.get(p.id)?.on || inRound(p));
        itemsEl.innerHTML = list.length
          ? list
              .map((p) => {
                const s = pick.get(p.id);
                const t = pfType(p.type);
                const photos = p.files.filter(isPhoto).length;
                return `<div class="sr-item${s.on ? '' : ' off'}" data-id="${p.id}">
                  <label class="pp-inc" title="ใส่ในรายงาน"><input type="checkbox" data-on ${s.on ? 'checked' : ''} /><span class="pp-check" style="--c:${t.color}">${icon('check')}</span></label>
                  <div class="sr-item-main">
                    <div class="sr-item-top">${chipIcon(t.icon, t.color)}<span class="muted">${shortDate(p.date)}</span>
                      <select class="select sr-sec-sel" data-sec-sel aria-label="ใส่ในหัวข้อ">${sections.map((x, i) => `<option value="${x.id}" ${x.id === s.sec ? 'selected' : ''}>ข้อ ${num(i + 2)}</option>`).join('')}</select>
                      ${photos ? `<span class="sr-ph">${icon('image')}${photos}</span>` : ''}</div>
                    <textarea class="sr-line" rows="1" data-line aria-label="ข้อความในรายงาน">${esc(s.line)}</textarea>
                  </div></div>`;
              })
              .join('')
          : `<p class="muted sr-empty">ยังไม่มีผลงานในรอบนี้ · <button type="button" class="link-btn" data-sr="all">แสดงผลงานทั้งหมด</button></p>`;
        $$('.sr-line', itemsEl).forEach(fit);
        summary();
      };
      const fit = (ta) => {
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
      };
      const summary = () => {
        const on = [...pick.values()].filter((v) => v.on);
        const ph = all.filter((p) => pick.get(p.id)?.on).reduce((a, p) => a + p.files.filter(isPhoto).length, 0);
        $('#sr-count', root).textContent = on.length;
        $('#sr-summary', root).textContent = `${on.length} ผลงาน${opt.photos ? ` · ภาพประกอบ ${ph} รูป` : ''}`;
      };
      const renderFace = async () => {
        const url = await photoURL(PORTRAIT_KEY);
        $('#sr-face', root).innerHTML = url ? `<img src="${url}" alt="" />` : icon('users');
      };

      $('#sr-roundseg', root).innerHTML = segmented(
        [
          { id: '1', label: 'ครั้งที่ 1 (1 เม.ย.)' },
          { id: '2', label: 'ครั้งที่ 2 (1 ต.ค.)' },
        ],
        String(round),
        { name: 'srround' },
      );
      $('#sr-filter', root).innerHTML = segmented(
        [
          { id: 'round', label: 'ในรอบ + ที่เลือก' },
          { id: 'all', label: 'ทั้งหมด' },
        ],
        'round',
        { name: 'srfilter' },
      );
      const recompute = () => {
        if (!titleEdited) $('#sr-title', root).value = titleFor();
        defaults();
        renderItems();
      };
      bindSegmented($('[data-seg="srround"]', root), (v) => {
        round = Number(v);
        recompute();
      });
      bindSegmented($('[data-seg="srfilter"]', root), (v) => {
        showAll = v === 'all';
        renderItems();
      });

      root.addEventListener('input', (e) => {
        if (e.target.id === 'sr-title') titleEdited = true;
        const h = e.target.dataset.head;
        if (h) {
          sections.find((s) => s.id === h).heading = e.target.value;
          persist();
        }
        if (e.target.matches('[data-line]')) {
          pick.get(e.target.closest('[data-id]').dataset.id).line = e.target.value;
          fit(e.target);
        }
        if (e.target.id === 'sr-conduct-h') {
          opt.conduct.heading = e.target.value;
          persist();
        }
        if (e.target.id === 'sr-certify') {
          opt.certify = e.target.value;
          persist();
        }
      });
      root.addEventListener('change', async (e) => {
        if (e.target.id === 'sr-year') {
          year = Number(e.target.value);
          recompute();
        }
        if (e.target.matches('[data-on]')) {
          const row = e.target.closest('[data-id]');
          pick.get(row.dataset.id).on = e.target.checked;
          row.classList.toggle('off', !e.target.checked);
          summary();
        }
        if (e.target.matches('[data-sec-sel]')) pick.get(e.target.closest('[data-id]').dataset.id).sec = e.target.value;
        if (e.target.id === 'sr-photos') {
          opt.photos = e.target.checked;
          summary();
          persist();
        }
        if (e.target.id === 'sr-thai') {
          opt.thaiNum = e.target.checked;
          renderSections();
          renderItems();
          persist();
        }
        if (e.target.id === 'sr-portrait') {
          opt.portrait = e.target.checked;
          persist();
        }
        if (e.target.id === 'sr-conduct') {
          opt.conduct.on = e.target.checked;
          $('.sr-conduct', root).hidden = !e.target.checked;
          persist();
        }
        if (e.target.id === 'sr-face-file' && e.target.files[0]) {
          await putPhoto(PORTRAIT_KEY, await makePreview(e.target.files[0]));
          e.target.value = '';
          opt.portrait = true;
          $('#sr-portrait', root).checked = true;
          renderFace();
          persist();
        }
      });
      root.addEventListener('click', async (e) => {
        const cl = e.target.closest('[data-clean]');
        if (cl) {
          opt.conduct.clean = cl.dataset.clean === '1';
          $$('[data-clean]', root).forEach((b) => b.classList.toggle('active', b === cl));
          return persist();
        }
        const del = e.target.closest('[data-delsec]');
        if (del) {
          const id = del.dataset.delsec;
          sections = sections.filter((s) => s.id !== id);
          const fallback = sections[sections.length - 1].id;
          pick.forEach((v) => v.sec === id && (v.sec = fallback));
          renderSections();
          renderItems();
          return persist();
        }
        const act = e.target.closest('[data-sr]')?.dataset.sr;
        if (act === 'addsec') {
          sections.splice(sections.length - 1, 0, { id: 's' + Date.now().toString(36), heading: 'หัวข้อใหม่ (แก้ข้อความได้)', types: [] });
          renderSections();
          renderItems();
          $$('[data-head]', root).at(-2)?.focus();
          return persist();
        }
        if (act === 'all') {
          showAll = true;
          $('[data-seg="srfilter"] [data-value="all"]', root)?.click();
          return renderItems();
        }
        if (act === 'build') {
          const btn = e.target.closest('button');
          const chosen = all.filter((p) => pick.get(p.id)?.on);
          if (!chosen.length) return toast('เลือกผลงานอย่างน้อย 1 รายการ', { icon: 'ℹ️' });
          btn.disabled = true;
          const prog = $('#sr-progress', root);
          prog.hidden = false;
          prog.innerHTML = '<span class="btn-spin"></span> กำลังสร้างไฟล์…';
          try {
            const name = $('#sr-name', root).value.trim();
            const position = $('#sr-pos', root).value.trim();
            // จำชื่อ/ตำแหน่งไว้ใช้รอบหน้า (เก็บในข้อมูลผู้จัดทำ)
            if (position !== (pf.position || '')) store.setSettings({ profile: { ...store.state.settings.profile, position } });
            const portraitURL = opt.portrait ? await photoURL(PORTRAIT_KEY) : null;
            const blob = await buildSalaryDocx(
              {
                title: $('#sr-title', root).value,
                name,
                signName: name,
                position,
                portraitBlob: portraitURL ? await (await fetch(portraitURL)).blob() : null,
                sections: sections.map((s) => ({
                  heading: s.heading,
                  items: chosen.filter((p) => pick.get(p.id).sec === s.id).map((p) => ({ line: pick.get(p.id).line, photos: p.files.filter(isPhoto) })),
                })),
                conduct: opt.conduct,
                certify: opt.certify,
                thaiNum: opt.thaiNum,
                photos: opt.photos,
              },
              (d, t) => (prog.innerHTML = `<span class="btn-spin"></span> กำลังใส่ภาพประกอบ ${d}/${t}…`),
            );
            const fname = `รายงานเลื่อนเงินเดือน-ครั้งที่${round}-${year}.docx`;
            const how = await deliver(blob, fname);
            prog.innerHTML = how === 'cancel' ? '' : `✅ สร้างไฟล์แล้ว <b>${esc(fname)}</b> (${(blob.size / 1024 / 1024).toFixed(1)} MB) · เปิดใน Word เพื่อตรวจและแก้ไขต่อได้`;
            if (how !== 'cancel') toast('สร้างไฟล์ Word แล้ว', { icon: '📝' });
          } catch (err) {
            console.error(err);
            prog.innerHTML = `<span class="gc-error">สร้างไฟล์ไม่สำเร็จ: ${esc(err.message || err)}</span>`;
          } finally {
            btn.disabled = false;
          }
        }
      });

      renderSections();
      renderItems();
      renderFace();
    },
  });
}

