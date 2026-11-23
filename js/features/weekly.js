// ==========================================================
// weekly.js — สรุปประจำสัปดาห์ (ดูย้อนหลังได้ + แชร์ให้หัวหน้า/ทีม)
// ==========================================================
import { store } from '../core/store.js';
import { esc, fromKey, formatDate, durationLabel, todayKey, THAI_DAYS_SHORT, THAI_MONTHS_SHORT, thaiYear, $ } from '../core/utils.js';
import { weekStats } from '../core/selectors.js';
import { CATEGORIES, category } from '../core/constants.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon, tile } from '../ui/icons.js';

const MOOD = ['', '😣', '😮‍💨', '😐', '😊', '🤩'];

export function weekLabel(s) {
  const a = fromKey(s.first);
  const b = fromKey(s.last);
  const same = a.getMonth() === b.getMonth();
  return `${a.getDate()}${same ? '' : ' ' + THAI_MONTHS_SHORT[a.getMonth()]}–${b.getDate()} ${THAI_MONTHS_SHORT[b.getMonth()]} ${thaiYear(b)}`;
}

/** กราฟแท่งเล็ก: ค่าเดียวต่อวัน (ป้ายตัวเลขเฉพาะค่าสูงสุดและวันนี้) */
function miniChart(s, pick, fmt, label) {
  const vals = s.perDay.map(pick);
  const max = Math.max(1, ...vals);
  const top = Math.max(...vals);
  const today = todayKey();
  return `
    <div class="wk-chart" role="img" aria-label="${esc(label)}: ${s.perDay.map((d, i) => `${THAI_DAYS_SHORT[fromKey(d.key).getDay()]} ${fmt(vals[i])}`).join(', ')}">
      ${s.perDay
        .map((d, i) => {
          const v = vals[i];
          const isToday = d.key === today;
          const show = v > 0 && (v === top || isToday);
          return `<div class="wk-col${isToday ? ' today' : ''}" title="${formatDate(d.key, { weekday: true, short: true, year: false })}: ${fmt(v)}" style="--i:${i}">
            <div class="wk-track"><div class="wk-bar" style="height:${(v / max) * 100}%">${show ? `<span>${fmt(v)}</span>` : ''}</div></div>
            <span class="wk-x">${THAI_DAYS_SHORT[fromKey(d.key).getDay()]}</span>
          </div>`;
        })
        .join('')}
    </div>`;
}

function delta(n, prev) {
  const d = n - prev;
  if (!prev && !n) return '';
  if (d > 0) return `<span class="wk-delta up">▲ ${d} จากสัปดาห์ก่อน</span>`;
  if (d < 0) return `<span class="wk-delta down">▼ ${-d} จากสัปดาห์ก่อน</span>`;
  return '<span class="wk-delta">เท่ากับสัปดาห์ก่อน</span>';
}

function body(s) {
  const hrs = (m) => (m ? durationLabel(m) : '0');
  const catMax = Math.max(1, ...Object.values(s.byCategory));
  const moods = s.perDay.filter((d) => d.mood);
  return `
    <div class="wk">
      <section class="wk-tiles">
        <div class="wk-tile">${tile('checkSquare', '#10b981', 'wk-ico')}<b>${s.done.length}</b><p>งานที่ทำเสร็จ</p>${delta(s.done.length, s.prevDone)}</div>
        <div class="wk-tile">${tile('users', '#0ea5e9', 'wk-ico')}<b>${s.meetings}</b><p>ประชุม · ${hrs(s.meetingMins)}</p></div>
        <div class="wk-tile">${tile('note', '#5b4bc4', 'wk-ico')}<b>${s.withNotes}/${s.pastMeetings}</b><p>ประชุมที่จดบันทึกแล้ว</p></div>
        <div class="wk-tile ${s.open.length ? 'warn' : ''}">${s.open.length ? tile('alert', '#e11d48', 'wk-ico') : tile('sparkles', '#d9a21b', 'wk-ico')}<b>${s.open.length}</b><p>งานค้าง${s.isCurrent ? '' : 'ตอนสิ้นสัปดาห์'}</p></div>
      </section>

      <section class="wk-charts">
        <div class="wk-chart-card">
          <h4 class="section-title">งานที่ทำเสร็จรายวัน</h4>
          ${miniChart(s, (d) => d.done, (v) => `${v}`, 'งานที่ทำเสร็จรายวัน')}
        </div>
        <div class="wk-chart-card">
          <h4 class="section-title">ชั่วโมงประชุมรายวัน</h4>
          ${miniChart(s, (d) => Math.round((d.meetingMins / 60) * 10) / 10, (v) => `${v} ชม.`, 'ชั่วโมงประชุมรายวัน')}
        </div>
      </section>

      ${s.focusTotal ? `<p class="wk-line">⭐ งานสำคัญที่ทำสำเร็จ <b>${s.focusDone}/${s.focusTotal}</b></p>` : ''}
      ${s.focusMins ? `<p class="wk-line">⏱️ เวลาโฟกัสรวม <b>${durationLabel(s.focusMins)}</b></p>` : ''}
      ${s.learned ? `<p class="wk-line">💡 ได้เรียนรู้ใหม่ <b>${s.learned} เรื่อง</b></p>` : ''}
      ${moods.length ? `<div class="wk-moods">${s.perDay.map((d) => `<span title="${formatDate(d.key, { weekday: true, short: true, year: false })}"><i>${d.mood ? MOOD[d.mood] : '·'}</i><small>${THAI_DAYS_SHORT[fromKey(d.key).getDay()]}</small></span>`).join('')}</div>` : ''}

      ${Object.keys(s.byCategory).length ? `
      <section>
        <h4 class="section-title">${icon('clock')} เวลาตามหมวด</h4>
        <div class="sum-rows wk-cats">${CATEGORIES.filter((c) => s.byCategory[c.id]).map((c) => `
          <div class="sum-row"><span class="sum-label">${c.emoji} ${c.label}</span>
            <div class="progress"><span style="--p:${Math.round((s.byCategory[c.id] / catMax) * 100)}%;--c:${c.color}"></span></div>
            <span class="sum-val">${durationLabel(s.byCategory[c.id])}</span></div>`).join('')}</div>
      </section>` : ''}

      <section class="wk-lists">
        <div>
          <h4 class="section-title">✅ ทำเสร็จ <span class="count">${s.done.length}</span></h4>
          ${s.done.length ? `<ul class="wk-list">${s.done.slice(0, 8).map((t) => `<li>${esc(t.title)}</li>`).join('')}${s.done.length > 8 ? `<li class="muted">และอีก ${s.done.length - 8} งาน</li>` : ''}</ul>` : '<p class="muted wk-empty">ยังไม่มี</p>'}
        </div>
        <div>
          <h4 class="section-title ${s.open.length ? 'bad' : ''}">⚠️ ยังค้าง <span class="count">${s.open.length}</span></h4>
          ${s.open.length ? `<ul class="wk-list">${s.open.slice(0, 8).map((t) => `<li>${esc(t.title)} <span class="muted">· ${formatDate(t.due, { short: true, year: false })}</span></li>`).join('')}${s.open.length > 8 ? `<li class="muted">และอีก ${s.open.length - 8} งาน</li>` : ''}</ul>` : '<p class="muted wk-empty">ไม่มีงานค้าง 👍</p>'}
        </div>
      </section>

      ${s.milestones.length ? `
      <section>
        <h4 class="section-title">🎯 เป้าหมายที่คืบหน้า</h4>
        <ul class="wk-list">${s.milestones.map(({ goal, m }) => `<li>${esc(m.title)} <span class="muted">· ${esc(goal.title)}</span></li>`).join('')}</ul>
      </section>` : ''}
    </div>`;
}

/** ข้อความสรุปสำหรับแชร์ */
export function weeklyText(s) {
  const lines = [
    `📊 สรุปงานประจำสัปดาห์ ${weekLabel(s)}`,
    '',
    `✅ งานที่ทำเสร็จ ${s.done.length} งาน`,
    `👥 ประชุม ${s.meetings} นัด (${s.meetingMins ? durationLabel(s.meetingMins) : '0 ชม.'})`,
  ];
  if (s.pastMeetings) lines.push(`📝 จดบันทึกประชุมแล้ว ${s.withNotes}/${s.pastMeetings}`);
  if (s.focusMins) lines.push(`⏱️ เวลาโฟกัสรวม ${durationLabel(s.focusMins)}`);
  if (s.learned) lines.push(`💡 ได้เรียนรู้ใหม่ ${s.learned} เรื่อง`);
  if (s.done.length) {
    lines.push('', 'งานที่เสร็จ');
    s.done.slice(0, 15).forEach((t) => lines.push(`• ${t.title}`));
    if (s.done.length > 15) lines.push(`• และอีก ${s.done.length - 15} งาน`);
  }
  if (s.open.length) {
    lines.push('', 'งานที่ยังค้าง');
    s.open.slice(0, 10).forEach((t) => lines.push(`• ${t.title} (กำหนด ${formatDate(t.due, { short: true, year: false })})`));
  }
  if (s.milestones.length) {
    lines.push('', 'เป้าหมายที่คืบหน้า');
    s.milestones.forEach(({ goal, m }) => lines.push(`• ${m.title} (${goal.title})`));
  }
  return lines.join('\n');
}

export function openWeekly({ offset = 0 } = {}) {
  let off = offset;
  openModal({
    title: '📊 สรุปประจำสัปดาห์',
    size: 680,
    body: `<div class="wk-nav">
        <button type="button" class="icon-btn" data-wk="prev" aria-label="สัปดาห์ก่อน">${icon('left')}</button>
        <div class="wk-range"><b id="wk-label"></b><span id="wk-sub" class="muted"></span></div>
        <button type="button" class="icon-btn" data-wk="next" aria-label="สัปดาห์ถัดไป">${icon('right')}</button>
      </div>
      <div id="wk-body"></div>`,
    footer: `<button class="icon-btn mr-copy-btn" type="button" data-wk="copy" title="คัดลอกข้อความ" aria-label="คัดลอกข้อความ">${icon('copy')}</button>
      <span class="spacer"></span>
      <button class="btn btn-ghost hide-mobile" data-close type="button">ปิด</button>
      <button class="btn btn-primary mr-share" data-wk="share" type="button">${icon('upload')}แชร์สรุปสัปดาห์</button>`,
    onMount(root) {
      const render = (dir = '') => {
        const s = weekStats(off);
        $('#wk-label', root).textContent = weekLabel(s);
        $('#wk-sub', root).textContent = off === 0 ? 'สัปดาห์นี้' : off === -1 ? 'สัปดาห์ที่แล้ว' : `${-off} สัปดาห์ก่อน`;
        const host = $('#wk-body', root);
        host.innerHTML = body(s);
        host.className = dir ? (dir === 'next' ? 'slide-next' : 'slide-prev') : '';
        root.querySelector('[data-wk="next"]').disabled = off >= 0;
        root._stats = s;
      };
      root.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-wk]')?.dataset.wk;
        if (act === 'prev') {
          off--;
          render('prev');
        }
        if (act === 'next' && off < 0) {
          off++;
          render('next');
        }
        if (act === 'share' || act === 'copy') {
          const text = weeklyText(root._stats);
          if (act === 'share' && navigator.share) {
            try {
              await navigator.share({ title: `สรุปงานสัปดาห์ ${weekLabel(root._stats)}`, text });
              return;
            } catch (err) {
              if (err?.name === 'AbortError') return;
            }
          }
          try {
            await navigator.clipboard.writeText(text);
            toast('คัดลอกสรุปสัปดาห์แล้ว วางใน LINE ได้เลย', { icon: '📋' });
          } catch (_) {
            toast('คัดลอกไม่ได้ในเบราว์เซอร์นี้', { icon: '⚠️' });
          }
        }
      });
      render();
    },
  });
}

/** การ์ดย่อในหน้าภาพรวม */
export function weeklyCardHTML() {
  const s = weekStats(0);
  return `
    <div class="wk-mini">
      <div><b>${s.done.length}</b><span>งานเสร็จ</span></div>
      <div><b>${s.meetings}</b><span>ประชุม</span></div>
      <div><b>${s.meetingMins ? Math.round(s.meetingMins / 6) / 10 : 0}</b><span>ชม.ประชุม</span></div>
      <div class="${s.open.length ? 'warn' : ''}"><b>${s.open.length}</b><span>งานค้าง</span></div>
    </div>`;
}

export const categoryOf = category;
