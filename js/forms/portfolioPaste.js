// ==========================================================
// portfolioPaste.js — วางข้อความ → ประมวลผลเป็นผลงาน → ตรวจแล้วบันทึกเข้าแฟ้ม
// ==========================================================
import { store } from '../core/store.js';
import { esc, uid, todayKey, formatDate, $, $$ } from '../core/utils.js';
import { PF_TYPES, pfType, withUnit } from '../core/portfolio.js';
import { parsePortfolio, personalInfo, stripPersonal } from '../core/portfolioParse.js';
import { aiReady, aiPortfolio } from '../sync/ai.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { confetti } from '../ui/confetti.js';
import { readDocx } from '../core/docx.js';
import { docxToDrafts } from '../core/portfolioImport.js';
import { makeThumb } from './portfolioForm.js';
import { uploadAttachment, canAttach } from '../sync/drive.js';

const SAMPLE = `สรุปผลการปฏิบัติเดือนนี้
1. ชุดสืบสวนจับกุมเครือข่ายยาเสพติด ผู้ต้องหา 5 ราย ของกลางยาบ้า 200,000 เม็ด ยึดทรัพย์ 3.5 ล้านบาท เมื่อวันที่ 12 ต.ค. 69 ณ อ.เมือง จ.เชียงใหม่ (เป็นหัวหน้าชุด)
2. เป็นวิทยากรบรรยายเรื่องภัยออนไลน์ ให้นักเรียน 300 คน ที่ ร.ร.บ้านหนองบัว 20 ต.ค. 69
3. ได้รับหนังสือชมเชยจาก ผบก. เมื่อ 28 ต.ค. 69`;

const isDup = (d) => (store.state.portfolio || []).some((p) => p.title.trim() === d.title.trim() && p.date === d.date);

export function openPortfolioPaste(initial = '') {
  let items = [];
  let timer = null;
  let fromAI = false;
  let docx = null; // { doc, name, mode, thumbs: Map(File → dataURL) }
  let busy = false;
  const canRead = !!navigator.clipboard?.readText;

  openModal({
    title: '📋 วางข้อความ / นำเข้าไฟล์ → บันทึกผลงาน',
    size: 700,
    body: `
      <div class="pp">
        <textarea class="textarea pp-text" id="pp-text" rows="5" placeholder="วางข้อความจาก LINE ข่าว รายงานผลการปฏิบัติ คำสั่ง หรือเกียรติบัตร…&#10;เช่น “จับกุมผู้ต้องหา 5 ราย ของกลางยาบ้า 2 แสนเม็ด เมื่อ 12 ต.ค. 69 (เป็นหัวหน้าชุด)”">${esc(initial)}</textarea>
        <div class="sp-tools">
          ${canRead ? `<button type="button" class="btn btn-outline btn-sm" data-pp="clip">${icon('clipboard')}วางจากคลิปบอร์ด</button>` : ''}
          <label class="btn btn-outline btn-sm pp-filebtn">${icon('note')}นำเข้าไฟล์ Word<input type="file" id="pp-file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden /></label>
          ${aiReady() ? `<button type="button" class="btn btn-sm btn-ai" data-pp="ai">✨ ให้ AI อ่าน</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-pp="sample">${icon('sparkles')}ลองตัวอย่าง</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pp="clear">${icon('x')}ล้าง</button>
          <span class="sp-private">🔒 ประมวลผลในเครื่อง</span>
        </div>
        <div id="pp-results" class="pp-results" aria-live="polite"></div>
      </div>`,
    footer: `<span class="sp-count" id="pp-count"></span><span class="spacer"></span>
      <button class="btn btn-ghost hide-mobile" data-close type="button">ยกเลิก</button>
      <button class="btn btn-gold" data-pp="save" type="button" disabled>💾 <span>บันทึกเข้าแฟ้ม</span></button>`,
    onMount(root, close) {
      const ta = $('#pp-text', root);
      const host = $('#pp-results', root);
      const saveBtn = $('[data-pp="save"]', root);

      const count = () => {
        const n = items.filter((d) => d.include).length;
        $('#pp-count', root).textContent = items.length ? `เลือก ${n} จาก ${items.length} ผลงาน` : '';
        saveBtn.disabled = !n || busy;
        saveBtn.querySelector('span').textContent = n > 1 ? `บันทึก ${n} ผลงาน` : 'บันทึกเข้าแฟ้ม';
      };

      const card = (d, i, animate) => {
        const t = pfType(d.type);
        return `<article class="pp-card${d.include ? '' : ' off'}${animate ? ' enter' : ''}" data-i="${i}" style="--c:${t.color};--i:${i}">
          <div class="pp-head">
            <label class="pp-inc" title="บันทึกผลงานนี้"><input type="checkbox" data-f="include" ${d.include ? 'checked' : ''} /><span class="pp-check">${icon('check')}</span></label>
            <select class="select pp-type" data-f="type" aria-label="ประเภท">${PF_TYPES.map((x) => `<option value="${x.id}" ${x.id === d.type ? 'selected' : ''}>${x.emoji} ${x.short}</option>`).join('')}</select>
            <input class="input pp-date" type="date" data-f="date" value="${esc(d.date)}" aria-label="วันที่" />
            <button type="button" class="pp-star${d.highlight ? ' on' : ''}" data-star title="ผลงานเด่น" aria-pressed="${d.highlight}">⭐</button>
          </div>
          <input class="input pp-title" data-f="title" value="${esc(d.title)}" maxlength="140" aria-label="ชื่อผลงาน" />
          <div class="pp-meta">
            <input class="input" data-f="role" value="${esc(d.role)}" placeholder="บทบาท" list="pf-roles-pp" aria-label="บทบาท" />
            <input class="input" data-f="org" value="${esc(d.org)}" placeholder="หน่วยงาน / ผู้มอบ / สถานที่" aria-label="หน่วยงาน" />
          </div>
          ${d.endDate ? `<p class="pp-range">🗓️ ${formatDate(d.date, { short: true })} – ${formatDate(d.endDate, { short: true })}</p>` : ''}
          ${d.figures.length ? `<div class="pf-figpills">${d.figures.map((f, k) => `<span class="pf-figpill pp-fig"><b>${esc(withUnit(f.n, f.unit))}</b>${esc(f.label)}<button type="button" data-rmfig="${k}" aria-label="ลบตัวเลขนี้">${icon('x')}</button></span>`).join('')}</div>` : ''}
          ${d.privacy.length ? `<div class="pp-privacy">🔒 พบ<b>${esc(d.privacy.join(' / '))}</b>ของบุคคลในข้อความ <button type="button" class="btn btn-sm btn-outline" data-strip>ลบข้อมูลส่วนตัวให้</button></div>` : ''}
          ${d.dup ? '<p class="pp-warn">⚠️ มีผลงานนี้ในแฟ้มแล้ว (ชื่อและวันที่ตรงกัน)</p>' : ''}
          ${(d.photos || []).length ? `<div class="pp-photos">${d.photos.map((ph, k) => `<span class="pp-photo">${docx?.thumbs.get(ph.file) ? `<img src="${docx.thumbs.get(ph.file)}" alt="" />` : '<span class="btn-spin"></span>'}<button type="button" data-rmphoto="${k}" aria-label="เอารูปนี้ออก">${icon('x')}</button></span>`).join('')}<small>${d.photos.length} รูป</small></div>` : ''}
          ${d.warnings.map((w) => `<span class="tag warn">${esc(w)}</span>`).join(' ')}
          <details class="pp-more"${d.result.length < 160 ? ' open' : ''}><summary>รายละเอียด / ผลการปฏิบัติ</summary>
            <textarea class="textarea" data-f="result" rows="3" maxlength="2000">${esc(d.result)}</textarea></details>
        </article>`;
      };

      const render = (animate = false) => {
        if (!items.length) {
          host.innerHTML = ta.value.trim()
            ? `<div class="empty sm"><div class="empty-emoji">🤔</div><h4>ยังแยกผลงานไม่ได้</h4><p>ลองใส่สิ่งที่ทำ ผลลัพธ์ และวันที่${aiReady() ? ' หรือกด “ให้ AI อ่าน”' : ''}</p></div>`
            : `<div class="pp-hint"><p>วางข้อความแล้วระบบจะแยกให้อัตโนมัติ:</p><div class="chips">${['🕵️ ประเภท', '📅 วันที่', '👤 บทบาท', '🔢 ตัวเลขผลงาน', '🏢 หน่วยงาน', '🔒 ซ่อนข้อมูลบุคคล'].map((x) => `<span class="chip">${x}</span>`).join('')}</div></div>`;
          return count();
        }
        const noDate = items.filter((d) => d.warnings.some((w) => /ไม่พบวันที่/.test(w))).length;
        const used = items.reduce((a, d) => a + (d.photos || []).length, 0);
        host.innerHTML = `<p class="pp-done">✨ ${fromAI ? 'AI ' : ''}แยกได้ ${items.length} ผลงาน — ตรวจแล้วกดบันทึก</p>
          ${docx ? `<div class="pp-docbar">
            <span>📄 <b>${esc(docx.name)}</b> · รูป ${used} รูป</span>
            <button type="button" class="btn btn-ghost btn-sm" data-pp="flip" title="ถ้ารูปไปอยู่ผิดข้อ (เลื่อนไปข้อก่อน/ถัดไป)">🔀 รูปอยู่ผิดข้อ? สลับ${docx.mode === 'above' ? 'เป็นรูปอยู่ใต้คำบรรยาย' : 'เป็นรูปอยู่เหนือคำบรรยาย'}</button>
            ${canAttach() ? `<label class="switch-row"><input type="checkbox" id="pp-upload" checked /><span class="switch" aria-hidden="true"></span><span>อัปโหลดรูปเต็มเข้า Google Drive</span></label>` : '<span class="muted pp-note">รูปจะเก็บเป็นรูปย่อในแอป (เชื่อม Google ในตั้งค่า เพื่อเก็บรูปเต็มใน Drive)</span>'}
          </div>` : ''}
          ${noDate ? `<div class="pp-docbar pp-nodate"><span>🗓️ ${noDate} ผลงานไม่พบวันที่ ตั้งเป็น</span><input class="input pp-date" type="date" id="pp-bulkdate" value="${todayKey()}" /><button type="button" class="btn btn-outline btn-sm" data-pp="bulkdate">ใช้กับทุกข้อที่ไม่มีวันที่</button></div>` : ''}
          ${items.map((d, i) => card(d, i, animate)).join('')}
          <datalist id="pf-roles-pp">${['หัวหน้าชุด', 'ผู้รับผิดชอบหลัก', 'ผู้ร่วมปฏิบัติ', 'ผู้ประสานงาน', 'ผู้สืบสวน', 'พนักงานสอบสวน', 'วิทยากร', 'ผู้เข้าอบรม', 'ผู้ได้รับรางวัล'].map((r) => `<option value="${r}"></option>`).join('')}</datalist>`;
        count();
      };

      const load = (list, animate = true) => {
        items = list.map((d) => {
          const it = { ...d, figures: d.figures || [], warnings: d.warnings || [], privacy: d.privacy?.length ? d.privacy : personalInfo([d.title, d.result, d.org].join(' ')) };
          it.dup = isDup(it);
          it.include = !it.dup;
          return it;
        });
        render(animate);
      };

      const parse = () => {
        fromAI = false;
        load(parsePortfolio(ta.value));
      };

      const importDocx = async (file) => {
        if (!/\.docx$/i.test(file.name)) return toast('รองรับเฉพาะไฟล์ .docx (Word 2007 ขึ้นไป)', { icon: '⚠️' });
        host.innerHTML = `<div class="sp-ai-loading"><span></span><span></span><span></span><p>กำลังอ่านไฟล์ ${esc(file.name)}…</p></div>`;
        try {
          const doc = await readDocx(file);
          const res = docxToDrafts(doc);
          docx = { doc, name: file.name, mode: res.mode, thumbs: new Map() };
          fromAI = false;
          if (!res.drafts.length) {
            docx = null;
            items = [];
            host.innerHTML = '<div class="empty sm"><div class="empty-emoji">📄</div><h4>ไม่พบผลงานในไฟล์นี้</h4><p>ลองคัดลอกข้อความมาวางแทน</p></div>';
            return;
          }
          load(res.drafts);
          // ทำรูปย่อทีละรูป แล้วแสดงในการ์ด
          const all = [...new Set(res.drafts.flatMap((d) => d.photos || []))];
          for (let k = 0; k < all.length; k++) {
            docx.thumbs.set(all[k].file, await makeThumb(all[k].file, 240, 0.68));
            if (k % 6 === 5) render();
          }
          render();
        } catch (err) {
          docx = null;
          toast(err.message || 'อ่านไฟล์ไม่ได้', { icon: '⚠️', duration: 5000 });
          render();
        }
      };
      $('#pp-file', root).addEventListener('change', (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (f) importDocx(f);
      });

      ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(parse, 350);
      });

      host.addEventListener('input', (e) => {
        const f = e.target.dataset.f;
        if (!f || f === 'include') return;
        const i = Number(e.target.closest('[data-i]').dataset.i);
        items[i][f] = e.target.value;
        if (f === 'title' || f === 'date') items[i].dup = isDup(items[i]);
      });
      host.addEventListener('change', (e) => {
        const f = e.target.dataset.f;
        const el = e.target.closest('[data-i]');
        if (!el) return;
        const i = Number(el.dataset.i);
        if (f === 'include') {
          items[i].include = e.target.checked;
          el.classList.toggle('off', !e.target.checked);
          count();
        }
        if (f === 'type') {
          items[i].type = e.target.value;
          el.style.setProperty('--c', pfType(e.target.value).color);
        }
      });

      root.addEventListener('click', async (e) => {
        const el = e.target.closest('.pp-card');
        const i = el ? Number(el.dataset.i) : -1;
        if (e.target.closest('[data-star]')) {
          items[i].highlight = !items[i].highlight;
          const b = e.target.closest('[data-star]');
          b.classList.toggle('on', items[i].highlight);
          b.setAttribute('aria-pressed', items[i].highlight);
          return;
        }
        const rp = e.target.closest('[data-rmphoto]');
        if (rp) {
          items[i].photos.splice(Number(rp.dataset.rmphoto), 1);
          return render();
        }
        const rf = e.target.closest('[data-rmfig]');
        if (rf) {
          items[i].figures.splice(Number(rf.dataset.rmfig), 1);
          return render();
        }
        if (e.target.closest('[data-strip]')) {
          const d = items[i];
          ['title', 'result', 'org'].forEach((k) => (d[k] = stripPersonal(d[k]).trim()));
          d.privacy = personalInfo([d.title, d.result, d.org].join(' '));
          render();
          return toast('ลบชื่อ เลขบัตร เบอร์โทร อายุ และที่อยู่ออกแล้ว', { icon: '🔒' });
        }
        const act = e.target.closest('[data-pp]')?.dataset.pp;
        if (act === 'clip') {
          try {
            const t = await navigator.clipboard.readText();
            if (!t) return toast('คลิปบอร์ดว่างอยู่', { icon: 'ℹ️' });
            ta.value = t;
            parse();
          } catch (_) {
            toast('อ่านคลิปบอร์ดไม่ได้ ให้กดค้างในช่องแล้วเลือก "วาง" แทน', { icon: 'ℹ️' });
            ta.focus();
          }
        }
        if (act === 'flip' && docx) {
          const res = docxToDrafts(docx.doc, { order: docx.mode === 'above' ? 'below' : 'above' });
          docx.mode = res.mode;
          load(res.drafts, false);
          for (const ph of new Set(res.drafts.flatMap((d) => d.photos || []))) if (!docx.thumbs.has(ph.file)) docx.thumbs.set(ph.file, await makeThumb(ph.file, 240, 0.68));
          render();
          return toast('สลับตำแหน่งรูปแล้ว', { icon: '🔀' });
        }
        if (act === 'bulkdate') {
          const v = $('#pp-bulkdate', root).value;
          if (!v) return;
          items.forEach((d) => {
            if (d.warnings.some((w) => /ไม่พบวันที่/.test(w))) {
              d.date = v;
              d.warnings = d.warnings.filter((w) => !/ไม่พบวันที่/.test(w));
              d.dup = isDup(d);
            }
          });
          return render();
        }
        if (act === 'sample') {
          ta.value = SAMPLE;
          parse();
        }
        if (act === 'clear') {
          ta.value = '';
          parse();
          ta.focus();
        }
        if (act === 'ai') {
          const text = ta.value.trim();
          if (!text) return toast('วางข้อความก่อน แล้วค่อยให้ AI อ่าน', { icon: 'ℹ️' });
          clearTimeout(timer); // ไม่ให้ตัวอ่านปกติทับผลของ AI
          const btn = e.target.closest('[data-pp="ai"]');
          btn.disabled = true;
          btn.classList.add('loading');
          host.innerHTML = `<div class="sp-ai-loading"><span></span><span></span><span></span><p>AI กำลังอ่านข้อความ…</p></div>`;
          try {
            const got = await aiPortfolio(text);
            fromAI = true;
            if (!got.length) toast('AI ไม่พบผลงานในข้อความนี้', { icon: 'ℹ️' });
            load(got);
          } catch (err) {
            toast(err.message, { icon: '⚠️', duration: 5000 });
            parse();
          } finally {
            btn.disabled = false;
            btn.classList.remove('loading');
          }
        }
        if (act === 'save') {
          const pick = items.filter((d) => d.include && d.title.trim());
          if (!pick.length || busy) return;
          const now = Date.now();
          const upload = !!$('#pp-upload', root)?.checked;
          const made = [];
          store.batch((state) => {
            pick.forEach((d, k) => {
              const id = uid();
              // ตั้งชื่อรูปตามผลงาน เช่น "ปฏิบัติหน้าที่ซุ้มกระบี่… (1).jpg" (หาใน Drive ง่าย)
              let base = d.title.trim().replace(/[\\/:*?"<>|…“”]+/g, '');
              if (base.length > 50) base = base.slice(0, 50).lastIndexOf(' ') > 25 ? base.slice(0, base.slice(0, 50).lastIndexOf(' ')) : base.slice(0, 50);
              base = base.trim() || 'ผลงาน';
              const photos = (d.photos || []).map((ph, n) => {
                const ext = (ph.name.split('.').pop() || 'jpg').toLowerCase();
                const name = d.photos.length > 1 ? `${base} (${n + 1}).${ext}` : `${base}.${ext}`;
                return { ...ph, name, file: new File([ph.file], name, { type: ph.file.type }), thumb: docx?.thumbs.get(ph.file) || '' };
              });
              const files = photos.map((ph) => ({ name: ph.name, mime: ph.file.type, thumb: ph.thumb, link: '', id: '' }));
              made.push({ id, photos });
              state.portfolio.push({
                id, type: d.type, title: d.title.trim().slice(0, 140), date: d.date || todayKey(), endDate: d.endDate || '',
                role: d.role.trim(), org: d.org.trim(), result: d.result.trim(), lesson: '', figures: d.figures,
                files, links: d.links || [], highlight: !!d.highlight, source: null, createdAt: now + k,
              });
            });
          });
          const total = made.reduce((a, m) => a + m.photos.length, 0);
          if (upload && total) {
            busy = true;
            count();
            let done = 0;
            let failed = 0;
            const bar = document.createElement('div');
            bar.className = 'pp-upbar';
            host.prepend(bar);
            const show = () => (bar.innerHTML = `<span>☁️ อัปโหลดรูปเข้า Google Drive ${done}/${total}${failed ? ` · ไม่สำเร็จ ${failed}` : ''}</span><div class="progress"><span style="--p:${Math.round((done / total) * 100)}%"></span></div>`);
            show();
            bar.scrollIntoView({ block: 'nearest' });
            let stop = false;
            for (const m of made) {
              const files = [...(store.find('portfolio', m.id)?.files || [])];
              for (let k = 0; k < m.photos.length && !stop; k++) {
                try {
                  const up = await uploadAttachment(m.photos[k].file);
                  files[k] = { ...files[k], ...up, thumb: files[k]?.thumb || '' };
                } catch (err) {
                  failed++;
                  // เข้าสู่ระบบ Google ไม่ได้: หยุด เก็บรูปย่อไว้ก่อน
                  if (err.needsAuth || err.needsScope || /เชื่อมต่อ Google|อนุญาต/.test(err.message)) {
                    toast(`${err.message} · รูปย่อยังอยู่ในแอป`, { icon: '⚠️', duration: 7000 });
                    stop = true;
                  }
                }
                done++;
                show();
              }
              store.update('portfolio', m.id, { files });
              if (stop) break;
            }
            busy = false;
            if (failed && !stop) toast(`อัปโหลดรูปไม่สำเร็จ ${failed} รูป (รูปย่อยังอยู่ในแอป)`, { icon: '⚠️', duration: 6000 });
          }
          const r = saveBtn.getBoundingClientRect();
          confetti({ x: r.left + r.width / 2, y: r.top, count: 36, spread: Math.PI, power: 8 });
          toast(`เก็บเข้าแฟ้มแล้ว ${pick.length} ผลงาน ${[...new Set(pick.map((d) => pfType(d.type).emoji))].join('')}`, {
            icon: '🏆', action: 'ดูแฟ้ม', onAction: () => (location.hash = '#portfolio'), duration: 6000,
          });
          close();
        }
      });

      if (initial) parse();
      else render();
    },
  });
}
