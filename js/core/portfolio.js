// ==========================================================
// portfolio.js — แฟ้มสะสมผลงาน: ประเภท สถิติ ปีงบประมาณ ตรวจข้อมูลอ่อนไหว และข้อความรายงาน
// ==========================================================
import { store } from './store.js';
import { todayKey, fromKey, toKey, formatDate, THAI_MONTHS_SHORT, thaiYear } from './utils.js';

export const PF_TYPES = [
  { id: 'case', label: 'คดี / การจับกุม', short: 'คดี', emoji: '🕵️', color: '#2a2563' },
  { id: 'award', label: 'รางวัล / คำชมเชย', short: 'รางวัล', emoji: '🏅', color: '#d9a21b' },
  { id: 'training', label: 'หลักสูตร / อบรม', short: 'อบรม', emoji: '🎓', color: '#0ea5e9' },
  { id: 'mission', label: 'ภารกิจพิเศษ', short: 'ภารกิจ', emoji: '🎯', color: '#e11d48' },
  { id: 'project', label: 'โครงการ / งานริเริ่ม', short: 'โครงการ', emoji: '🛠️', color: '#10b981' },
  { id: 'speaker', label: 'วิทยากร / ถ่ายทอดความรู้', short: 'วิทยากร', emoji: '🎤', color: '#8b5cf6' },
  { id: 'career', label: 'ตำแหน่ง / เลื่อนยศ / ย้าย', short: 'ตำแหน่ง', emoji: '📈', color: '#5b4bc4' },
  { id: 'other', label: 'อื่น ๆ', short: 'อื่น ๆ', emoji: '⭐', color: '#64748b' },
];
export const pfType = (id) => PF_TYPES.find((t) => t.id === id) || PF_TYPES[PF_TYPES.length - 1];

export const ROLES = ['หัวหน้าชุด', 'ผู้รับผิดชอบหลัก', 'ผู้ร่วมปฏิบัติ', 'ผู้ประสานงาน', 'ผู้สืบสวน', 'พนักงานสอบสวน', 'วิทยากร', 'ผู้เข้าอบรม', 'ผู้ได้รับรางวัล'];

/** หน่วยตัวเลขผลงานที่ใช้บ่อย (แนะนำตอนกรอก) */
export const FIGURE_HINTS = [
  { label: 'จับกุมผู้ต้องหา', unit: 'ราย' },
  { label: 'ยึดทรัพย์', unit: 'บาท' },
  { label: 'ของกลาง', unit: 'รายการ' },
  { label: 'ผู้เสียหายได้รับการช่วยเหลือ', unit: 'ราย' },
  { label: 'ผู้เข้าร่วม', unit: 'คน' },
  { label: 'ชั่วโมงอบรม', unit: 'ชั่วโมง' },
];

export const portfolio = () => store.state.portfolio || [];

// ---------------- ปีงบประมาณ (1 ต.ค. – 30 ก.ย.) ----------------
/** ปีงบประมาณ (พ.ศ.) ของวันที่ */
export function fiscalYear(key = todayKey()) {
  const d = fromKey(key);
  return thaiYear(d) + (d.getMonth() >= 9 ? 1 : 0);
}
export function fiscalRange(fyBE) {
  const y = fyBE - 543;
  return { from: `${y - 1}-10-01`, to: `${y}-09-30` };
}

/** ช่วงเวลาของรายงาน */
export function periodRange(period, custom = {}) {
  const today = todayKey();
  const fy = fiscalYear(today);
  if (period === 'fy') return { ...fiscalRange(fy), label: `ปีงบประมาณ พ.ศ. ${fy}` };
  if (period === 'prevfy') return { ...fiscalRange(fy - 1), label: `ปีงบประมาณ พ.ศ. ${fy - 1}` };
  if (period === 'year') {
    const y = new Date().getFullYear();
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `ปี พ.ศ. ${y + 543}` };
  }
  if (period === 'custom' && custom.from && custom.to) {
    return { from: custom.from, to: custom.to, label: `${formatDate(custom.from, { short: true })} – ${formatDate(custom.to, { short: true })}` };
  }
  return { from: '0000-01-01', to: '9999-12-31', label: 'ทั้งหมด' };
}
export const rangeText = (r) =>
  r.from === '0000-01-01' ? '' : `${formatDate(r.from)} – ${formatDate(r.to)}`;

export function filterPortfolio({ from = '0000-01-01', to = '9999-12-31', types = null, highlight = false } = {}) {
  return portfolio()
    .filter((p) => p.date >= from && p.date <= to)
    .filter((p) => !types || types.includes(p.type))
    .filter((p) => !highlight || p.highlight)
    .sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
}

// ---------------- สถิติ ----------------
export function countByType(list) {
  const m = {};
  list.forEach((p) => (m[p.type] = (m[p.type] || 0) + 1));
  return PF_TYPES.filter((t) => m[t.id]).map((t) => ({ type: t, n: m[t.id] }));
}

/** รวมตัวเลขผลงานที่ชื่อและหน่วยเดียวกัน เช่น "จับกุมผู้ต้องหา 48 ราย" */
export function sumFigures(list) {
  const m = new Map();
  list.forEach((p) =>
    (p.figures || []).forEach((f) => {
      const n = Number(f.n);
      if (!f.label?.trim() || !Number.isFinite(n)) return;
      const k = `${f.label.trim()}|${(f.unit || '').trim()}`;
      const cur = m.get(k) || { label: f.label.trim(), unit: (f.unit || '').trim(), n: 0, items: 0 };
      cur.n += n;
      cur.items++;
      m.set(k, cur);
    }),
  );
  return [...m.values()].sort((a, b) => b.items - a.items || b.n - a.n);
}

/** ตัวเลขอ่านง่าย: 12,500,000 -> "12.5 ล้าน" */
export function fmtNum(n, unit = '') {
  const v = Number(n) || 0;
  if (unit === 'บาท' && Math.abs(v) >= 1e6) return `${(Math.round((v / 1e6) * 100) / 100).toLocaleString('th-TH')} ล้าน`;
  return v.toLocaleString('th-TH', { maximumFractionDigits: 2 });
}
/** ตัวเลขพร้อมหน่วย: "12 ราย", "3.5 ล้านบาท" */
export const withUnit = (n, unit = '') => {
  const v = fmtNum(n, unit);
  return /ล้าน$/.test(v) ? `${v}${unit}` : `${v}${unit ? ' ' + unit : ''}`;
};
export const figureText = (f) => `${f.label} ${withUnit(f.n, f.unit)}`;

// ---------------- ข้อมูลอ่อนไหว ----------------
/** เตือนถ้าพบสิ่งที่อาจเป็นเลขบัตรประชาชน / เบอร์โทร / เลขบัญชี */
export function sensitiveWarnings(text) {
  const t = String(text || '').replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)));
  const out = [];
  if (/(?<!\d)\d[\s-]?\d{4}[\s-]?\d{5}[\s-]?\d{2}[\s-]?\d(?!\d)/.test(t)) out.push('เลขบัตรประชาชน');
  if (/(?<!\d)0[689]\d[\s-]?\d{3}[\s-]?\d{4}(?!\d)|(?<!\d)0[2-7][\s-]?\d{3}[\s-]?\d{4}(?!\d)/.test(t)) out.push('เบอร์โทรศัพท์');
  if (/(?<!\d)\d{3}[\s-]\d[\s-]\d{5}[\s-]\d(?!\d)|บัญชี(?:เลขที่)?\s*\d{6,}/.test(t)) out.push('เลขบัญชีธนาคาร');
  return out;
}

// ---------------- รายงาน ----------------
export function profileLines() {
  const pf = store.state.settings.profile || {};
  const name = [pf.rank, pf.fullName || store.state.settings.name].filter((x) => x?.trim()).join(' ');
  return { name, position: pf.position || '', unit: pf.unit || '' };
}

const shortDate = (k) => {
  const d = fromKey(k);
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]} ${String(thaiYear(d)).slice(2)}`;
};

/** ข้อความรายงานมีอิโมจิ (ส่ง LINE) */
export function portfolioText(list, range, { perType = 8 } = {}) {
  const who = profileLines();
  const lines = [`🏆 แฟ้มสะสมผลงาน${range.label && range.label !== 'ทั้งหมด' ? ` · ${range.label}` : ''}`];
  if (who.name) lines.push(`👤 ${who.name}${who.position ? ` (${who.position})` : ''}`);
  if (who.unit) lines.push(`🏢 ${who.unit}`);
  lines.push('━━━━━━━━━━━━');
  if (!list.length) {
    lines.push('ยังไม่มีผลงานในช่วงนี้');
    return lines.join('\n');
  }
  const counts = countByType(list);
  lines.push(`📊 ผลงานทั้งหมด ${list.length} ชิ้น${list.some((p) => p.highlight) ? ` · ⭐ ผลงานเด่น ${list.filter((p) => p.highlight).length}` : ''}`);
  lines.push(counts.map((c) => `${c.type.emoji} ${c.type.short} ${c.n}`).join(' · '));
  const figs = sumFigures(list).slice(0, 5);
  if (figs.length) {
    lines.push('');
    figs.forEach((f) => lines.push(`🔢 ${figureText(f)}`));
  }
  counts.forEach(({ type }) => {
    const items = list.filter((p) => p.type === type.id);
    lines.push('', `${type.emoji} ${type.label}`);
    items.slice(0, perType).forEach((p) => {
      const extra = [p.role, (p.figures || []).filter((f) => f.label).map(figureText).join(', ')].filter(Boolean).join(' · ');
      lines.push(`${p.highlight ? '⭐' : '▸'} ${shortDate(p.date)} ${p.title}${extra ? ` (${extra})` : ''}`);
    });
    if (items.length > perType) lines.push(`   …และอีก ${items.length - perType} ชิ้น`);
  });
  lines.push('━━━━━━━━━━━━', '💪 ทุกผลงานคือก้าวที่พาเรามาถึงวันนี้');
  return lines.join('\n');
}

/** ข้อความของผลงานชิ้นเดียว (แชร์) */
export function itemText(p) {
  const t = pfType(p.type);
  const lines = [`${t.emoji} ${p.title}`, `🗓️ ${formatDate(p.date)}${p.endDate && p.endDate !== p.date ? ` – ${formatDate(p.endDate)}` : ''}`];
  if (p.role) lines.push(`👤 บทบาท: ${p.role}`);
  if (p.org) lines.push(`🏢 ${p.org}`);
  (p.figures || []).filter((f) => f.label).forEach((f) => lines.push(`🔢 ${figureText(f)}`));
  if (p.result) lines.push('', p.result);
  if (p.lesson) lines.push('', `💡 บทเรียน: ${p.lesson}`);
  return lines.join('\n');
}

/** ร่างผลงานจากข้อมูลอื่นในแอป (ปุ่ม ⭐ เข้าแฟ้มผลงาน) */
export function draftFrom(kind, obj, extra = {}) {
  if (kind === 'goal') {
    const done = (obj.milestones || []).filter((m) => m.done).map((m) => `• ${m.title}`);
    return {
      type: obj.category === 'study' ? 'training' : 'project',
      title: obj.title,
      date: toKey(new Date()),
      result: [obj.description, done.length ? `ขั้นตอนที่ทำสำเร็จ\n${done.join('\n')}` : ''].filter(Boolean).join('\n\n'),
      source: { col: 'goals', id: obj.id },
    };
  }
  if (kind === 'meeting') {
    return {
      type: /อบรม|สัมมนา|หลักสูตร|workshop/i.test(obj.title) ? 'training' : /ปฏิบัติการ|ภารกิจ|ตรวจค้น|จับกุม/.test(obj.title) ? 'mission' : 'project',
      title: obj.title,
      date: extra.date || obj.date,
      org: obj.location || '',
      result: (extra.notes || '').trim(),
      source: { col: 'events', id: obj.id, date: extra.date || obj.date },
    };
  }
  if (kind === 'learning') {
    return { type: 'other', title: obj.text.length > 60 ? obj.text.slice(0, 60) + '…' : obj.text, date: obj.date, lesson: obj.text, source: { col: 'learnings', id: obj.id } };
  }
  return {};
}
