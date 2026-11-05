// ==========================================================
// settings.js — profile, theme, data backup/restore
// ==========================================================
import { store } from '../core/store.js';
import { esc, todayKey, $ } from '../core/utils.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { segmented, bindSegmented } from '../ui/widgets.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { isStandalone, canPromptInstall, promptInstall, installSteps, onInstallChange, pwaSupported, isEmbedded } from '../pwa.js';

export function applyTheme(theme = store.state.settings.theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function installSection() {
  if (isStandalone())
    return `<div class="install-box done">📲 <div><b>ติดตั้งเป็นแอปแล้ว</b><p class="muted">ข้อมูลจะเก็บอยู่ในเครื่องนี้ ใช้ได้แม้ไม่มีอินเทอร์เน็ต</p></div></div>`;
  if (!pwaSupported())
    return `<div class="install-box">
      <div class="install-head"><img src="icons/icon-192.png" alt="" width="44" height="44" />
        <div><b>ติดตั้งบนมือถือ</b><p class="muted">หน้านี้เป็นเวอร์ชันทดลองใช้ จึงติดตั้งเป็นแอปไม่ได้ เมื่อเปิดจากเว็บจริง (GitHub Pages) จะมีปุ่มและวิธีติดตั้งแสดงตรงนี้</p></div></div>
    </div>`;
  return `<div class="install-box">
    <div class="install-head"><img src="icons/icon-192.png" alt="" width="44" height="44" />
      <div><b>ติดตั้ง Planner บนมือถือ</b><p class="muted">เปิดจากไอคอนบนหน้าจอโฮม เต็มจอ ใช้งานออฟไลน์ได้</p></div></div>
    ${canPromptInstall()
      ? `<button class="btn btn-primary btn-sm" data-install>${icon('download')}ติดตั้งแอป</button>`
      : `<ol class="install-steps">${installSteps().map((t) => `<li>${t}</li>`).join('')}</ol>`}
  </div>`;
}

export function openSettings({ focusInstall = false } = {}) {
  let offInstall = null;
  const s = store.state.settings;
  const body = `
    <div class="form-grid">
      <div id="st-install">${installSection()}</div>
      <div class="field">
        <label for="st-name">ชื่อของคุณ</label>
        <input class="input" id="st-name" value="${esc(s.name)}" placeholder="ใช้แสดงคำทักทายในหน้าภาพรวม" maxlength="40" />
      </div>
      <div class="field">
        <span class="field-label">ธีม</span>
        ${segmented(
          [
            { id: 'light', label: 'สว่าง', icon: icon('sun') },
            { id: 'dark', label: 'มืด', icon: icon('moon') },
            { id: 'auto', label: 'ตามระบบ', icon: icon('settings') },
          ],
          s.theme,
          { name: 'theme', block: true },
        )}
      </div>
      <div class="field">
        <span class="field-label">วันเริ่มต้นสัปดาห์</span>
        ${segmented(
          [
            { id: '0', label: 'วันอาทิตย์' },
            { id: '1', label: 'วันจันทร์' },
          ],
          String(s.weekStart),
          { name: 'week', block: true },
        )}
      </div>
      <div class="divider"></div>
      <div class="field">
        <span class="field-label">ข้อมูล (บันทึกไว้ในเบราว์เซอร์นี้)</span>
        <div class="chips">
          ${isEmbedded()
            ? `<p class="muted" style="font-size:13px">การสำรองเป็นไฟล์ใช้ได้เมื่อเปิดจากเว็บจริง</p>`
            : `<button class="btn btn-outline btn-sm" data-export>${icon('download')}สำรองข้อมูล (.json)</button>`}
          <label class="btn btn-outline btn-sm" style="cursor:pointer">${icon('upload')}นำเข้าข้อมูล
            <input type="file" accept="application/json,.json" data-import hidden /></label>
        </div>
        <div class="chips" style="margin-top:4px">
          <button class="btn btn-ghost btn-sm" data-demo>${icon('sparkles')}โหลดข้อมูลตัวอย่าง</button>
          <button class="btn btn-danger btn-sm" data-clear>${icon('trash')}ล้างข้อมูลทั้งหมด</button>
        </div>
      </div>
      <p class="kbd-hint">⌨️ คีย์ลัด: <b>N</b> งานใหม่ · <b>E</b> นัดหมายใหม่ · <b>G</b> เป้าหมายใหม่ · <b>1–5</b> สลับหน้า · <b>T</b> สลับธีม</p>
    </div>`;

  openModal({
    title: '⚙️ ตั้งค่า',
    body,
    footer: `<span class="spacer"></span><button class="btn btn-primary" data-close>${icon('check')}เสร็จสิ้น</button>`,
    onClose: () => offInstall?.(),
    onMount(root, close) {
      const inst = $('#st-install', root);
      const bindInstall = () =>
        $('[data-install]', inst)?.addEventListener('click', async () => {
          if (await promptInstall()) close();
        });
      bindInstall();
      offInstall = onInstallChange(() => {
        inst.innerHTML = installSection();
        bindInstall();
      });
      if (focusInstall) inst.firstElementChild.classList.add('pop');
      $('#st-name', root).addEventListener('change', (e) => store.setSettings({ name: e.target.value.trim() }));
      bindSegmented($('[data-seg="theme"]', root), (v) => {
        store.setSettings({ theme: v });
        applyTheme(v);
      });
      bindSegmented($('[data-seg="week"]', root), (v) => store.setSettings({ weekStart: Number(v) }));

      $('[data-export]', root)?.addEventListener('click', () => {
        const blob = new Blob([store.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `planner-backup-${todayKey()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast('ดาวน์โหลดไฟล์สำรองแล้ว', { icon: '💾' });
      });

      $('[data-import]', root).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          store.importJSON(await file.text());
          applyTheme();
          toast('นำเข้าข้อมูลสำเร็จ', { icon: '📥' });
          close();
        } catch (err) {
          toast('ไฟล์ไม่ถูกต้อง: ' + err.message, { icon: '⚠️' });
        }
      });

      $('[data-demo]', root).addEventListener('click', async () => {
        close();
        if (await confirmDialog({ title: 'โหลดข้อมูลตัวอย่าง?', message: 'ข้อมูลปัจจุบันจะถูกแทนที่ด้วยข้อมูลตัวอย่าง', okLabel: 'โหลดเลย' })) {
          store.reset({ demo: true });
          toast('โหลดข้อมูลตัวอย่างแล้ว', { icon: '✨' });
        }
      });

      $('[data-clear]', root).addEventListener('click', async () => {
        close();
        if (await confirmDialog({ title: 'ล้างข้อมูลทั้งหมด?', message: 'งาน นัดหมาย และเป้าหมายทั้งหมดจะถูกลบ และกู้คืนไม่ได้ (แนะนำให้สำรองข้อมูลก่อน)', okLabel: 'ล้างข้อมูล', danger: true })) {
          store.reset({ demo: false });
          toast('ล้างข้อมูลแล้ว เริ่มต้นใหม่ได้เลย', { icon: '🧹' });
        }
      });
    },
  });
}
