// ==========================================================
// notionPanel.js — ส่วน "Notion" ในหน้าตั้งค่า
// ==========================================================
import { store } from '../core/store.js';
import { esc, $ } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { timeAgo } from './gcalPanel.js';
import {
  KINDS, cfg, setNotion, setNotionLocal, connectNotion, disconnectNotion, syncNotion, notionStatus, onNotionChange,
  notionPageUrl, pendingCount,
} from './notion.js';

const HELP = `<details class="gc-help"><summary>วิธีตั้งค่า (ทำครั้งเดียว ประมาณ 5 นาที)</summary>
  <ol class="install-steps">
    <li>เข้า <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener">notion.so/my-integrations</a> → <b>New integration</b> (แบบ Internal) → ตั้งชื่อ เช่น Life Planner → คัดลอก <b>Internal Integration Secret</b></li>
    <li>ใน Notion สร้างหน้าว่างชื่อ <b>Life Planner</b> → ⋯ มุมขวาบน → <b>Connections</b> → เลือก Integration ที่เพิ่งสร้าง</li>
    <li>Vercel → โปรเจกต์ plannercsd → <b>Settings → Environment Variables</b> เพิ่ม
      <code>NOTION_TOKEN</code> = Secret จากข้อ 1 และ <code>NOTION_ACCESS_CODE</code> = รหัสที่ตั้งเอง (ถ้าไม่ตั้ง จะใช้ <code>AI_ACCESS_CODE</code>)</li>
    <li>Vercel → <b>Deployments</b> → ⋯ → <b>Redeploy</b></li>
    <li>กลับมาที่นี่ วางลิงก์หน้า Life Planner (Notion → Share → Copy link) ใส่รหัสใช้งาน แล้วกด <b>เชื่อมต่อ</b></li>
  </ol>
  <p class="muted gc-note">อย่าวาง Secret ของ Notion ในแอปหรือในแชต ใส่ใน Vercel เท่านั้น</p>
</details>`;

export function notionSectionHTML() {
  return `<div class="gc-box" id="no-box">${inner()}</div>`;
}

function inner() {
  const c = cfg();
  const loc = store.state.settings.notionLocal || {};
  const head = `<div class="install-head"><span class="gc-sub-ico">🗒️</span><div><b>ส่งข้อมูลไป Notion</b>
    <p class="muted">ส่งทางเดียว: แก้ในแอปแล้วหน้าใน Notion อัปเดตตาม · แก้ใน Notion ไม่กลับเข้าแอป</p></div></div>`;
  const warn = `<p class="gc-error ai-warn">⚠️ ข้อมูลที่ส่งจะไปเก็บที่ Notion (นอกเครื่อง) อย่าใส่รายละเอียดคดีลับหรือข้อมูลบุคคล</p>`;
  const codeField = `<div class="field"><label for="no-code">รหัสใช้งาน</label>
    <input class="input" id="no-code" type="password" autocomplete="off" value="${esc(loc.code || store.state.settings.ai?.code || '')}" placeholder="รหัสเดียวกับ NOTION_ACCESS_CODE ใน Vercel" /></div>`;
  if (!c.enabled || !c.pageId) {
    return `${head}${warn}
      <div class="field"><label for="no-page">ลิงก์หน้า Notion</label>
        <input class="input" id="no-page" value="${esc(c.pageUrl || '')}" placeholder="https://www.notion.so/Life-Planner-…" /></div>
      ${codeField}
      <div class="chips"><button class="btn btn-primary btn-sm" type="button" data-no="connect">🔗 เชื่อมต่อ</button></div>
      <p class="muted gc-note" id="no-result"></p>
      ${HELP}`;
  }
  const st = notionStatus();
  const n = pendingCount();
  return `${head}${warn}
    <p class="no-linked">✅ เชื่อมกับหน้า <a href="${esc(c.pageUrl || notionPageUrl(c.pageId))}" target="_blank" rel="noopener"><b>${esc(c.title || 'Notion')}</b></a></p>
    <div class="no-kinds">${KINDS.map((k) => `<label class="switch-row"><input type="checkbox" data-no-kind="${k.id}" ${c.kinds[k.id] ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span><span>${k.emoji} ${k.label}</span></label>`).join('')}</div>
    <label class="switch-row"><input type="checkbox" id="no-auto" ${c.auto ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span><span>ส่งอัตโนมัติหลังแก้ไข (ประมาณ 30 วินาที)</span></label>
    <p class="muted gc-note" id="no-result">${statusText(st, n)}</p>
    <div class="chips">
      <button class="btn btn-primary btn-sm" type="button" data-no="sync">🚀 ส่งไป Notion ตอนนี้</button>
      <button class="btn btn-ghost btn-sm" type="button" data-no="off">ยกเลิกการเชื่อมต่อ</button>
    </div>
    <details class="gc-help"><summary>รหัสใช้งาน / เชื่อมหน้าอื่น</summary>${codeField}
      <div class="field"><label for="no-page">ลิงก์หน้า Notion</label><input class="input" id="no-page" value="${esc(c.pageUrl || '')}" /></div>
      <div class="chips"><button class="btn btn-outline btn-sm" type="button" data-no="connect">บันทึก / เชื่อมใหม่</button></div>
    </details>`;
}

function statusText(st, pending) {
  if (st.state === 'working') return `⏳ กำลังส่ง ${st.done}/${st.total} รายการ…`;
  if (st.error) return `<span class="gc-error">${esc(st.error)}</span>`;
  const last = st.lastSync ? `ส่งล่าสุด ${timeAgo(st.lastSync)}` : 'ยังไม่เคยส่ง';
  return `${last} · ${pending ? `รอส่ง ${pending} รายการ` : 'ข้อมูลตรงกับ Notion แล้ว'}`;
}

export function bindNotionSection(root) {
  const box = $('#no-box', root);
  if (!box) return () => {};
  const rerender = () => (box.innerHTML = inner());
  const off = onNotionChange((st) => {
    const out = $('#no-result', box);
    if (out && cfg().enabled) out.innerHTML = statusText({ ...st, lastSync: notionStatus().lastSync }, st.state === 'working' ? 0 : pendingCount());
  });

  const send = async (btn) => {
    if (btn) btn.disabled = true;
    try {
      const r = await syncNotion({ manual: true });
      toast(r.sent || r.archived ? `ส่งไป Notion แล้ว ${r.sent} รายการ${r.archived ? ` · ย้ายไปถังขยะ ${r.archived}` : ''}` : 'Notion เป็นปัจจุบันแล้ว', { icon: '🗒️' });
    } catch (e) {
      toast(e.message, { icon: '⚠️', duration: 6000 });
    } finally {
      if (btn) btn.disabled = false;
      rerender();
    }
  };

  box.addEventListener('change', (e) => {
    const k = e.target.dataset.noKind;
    if (k) return setNotion({ kinds: { ...cfg().kinds, [k]: e.target.checked } });
    if (e.target.id === 'no-auto') return setNotion({ auto: e.target.checked });
    if (e.target.id === 'no-code') setNotionLocal({ code: e.target.value.trim() });
  });

  box.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-no]')?.dataset.no;
    if (!act) return;
    const btn = e.target.closest('button');
    if (act === 'connect') {
      const page = $('#no-page', box).value.trim();
      const code = $('#no-code', box).value.trim();
      const out = $('#no-result', box);
      if (!page) return $('#no-page', box).focus();
      btn.disabled = true;
      if (out) out.textContent = 'กำลังเชื่อมต่อและสร้างตารางใน Notion…';
      try {
        const r = await connectNotion(page, code);
        toast(`เชื่อมกับ “${r.title}” แล้ว กำลังส่งข้อมูล…`, { icon: '🗒️' });
        rerender();
        send($('[data-no="sync"]', box));
      } catch (err) {
        if (out) out.innerHTML = `<span class="gc-error">${esc(err.message)}</span>`;
        btn.disabled = false;
      }
    }
    if (act === 'sync') send(btn);
    if (act === 'off') {
      disconnectNotion();
      rerender();
      toast('ยกเลิกการเชื่อมต่อ Notion แล้ว (ข้อมูลใน Notion ยังอยู่)', { icon: '🗒️' });
    }
  });
  return off;
}
