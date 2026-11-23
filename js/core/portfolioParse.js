// ==========================================================
// portfolioParse.js — อ่านข้อความ (LINE / ข่าว / รายงานผลการปฏิบัติ / คำสั่ง) → ร่างผลงานพร้อมบันทึก
// ประมวลผลในเครื่องทั้งหมด
// ==========================================================
import { normalize, findDates, MONTH_RE, monthIndex, fixYear } from './parse.js';
import { toKey, fromKey, addDays, todayKey } from './utils.js';
import { sensitiveWarnings } from './portfolio.js';

// คำบ่งชี้ประเภท [ประเภท, น้ำหนัก, regex]
const TYPE_RULES = [
  // คำที่ชัดเจนมาก (น้ำหนักสูง)
  ['mission', 3, /ทูลเกล้า|ถวายกระบี่|พระราชพิธี|รับเสด็จ|ถวายความปลอดภัย|ถวายอารักขา/g],
  ['training', 3, /ศึกษาดูงาน|ผ่านการ(?:อบรม|ฝึก)|จบหลักสูตร|สำเร็จการศึกษา/g],
  ['volunteer', 3, /อำนวยความสะดวก|ซุ้มกระบี่|จิตอาสา|การกุศล|บริจาค|บำเพ็ญประโยชน์/g],
  ['award', 2, /ได้รับ(?:การ)?คัดเลือก/g],
  ['speaker', 3, /วิทยากร|บรรยาย(?:ให้|เรื่อง|ในหัวข้อ)|ถ่ายทอดความรู้|ให้ความรู้|เป็นอาจารย์|สอน(?:หลักสูตร|วิชา)/g],
  ['award', 3, /รางวัล|ชมเชย|เกียรติบัตร|ประกาศเกียรติคุณ|โล่(?:รางวัล|เกียรติ)?|เข็ม(?:เชิดชู|เกียรติ)|เหรียญ|ดีเด่น|ยกย่อง|ชนะเลิศ|เชิดชูเกียรติ|หนังสือขอบคุณ/g],
  ['career', 3, /เลื่อนยศ|เลื่อนตำแหน่ง|เลื่อนขั้น|แต่งตั้ง(?:ให้)?(?:ดำรง)?ตำแหน่ง|ได้รับ(?:การ)?แต่งตั้ง|โยกย้าย|ย้าย(?:ไป|มา)ดำรง|รับตำแหน่ง|พระราชทานยศ|บรรจุ(?:เข้า)?รับราชการ|รักษาราชการแทน|ปรับตำแหน่ง/g],
  ['training', 2, /อบรม|หลักสูตร|สัมมนา|ศึกษาดูงาน|ฝึกอบรม|วุฒิบัตร|ประกาศนียบัตร|workshop|course|จบการศึกษา|สำเร็จการศึกษา|สอบผ่าน/gi],
  ['case', 2, /จับกุม|ผู้ต้องหา|ตรวจค้น|หมายจับ|หมายค้น|ของกลาง|สืบสวน|ล่อซื้อ|ยาเสพติด|ยาบ้า|ไอซ์|เฮโรอีน|แก๊ง|เครือข่าย|คลี่คลาย|คดี|ยึดทรัพย์|อายัด|บัญชีม้า|คอลเซ็นเตอร์|ฉ้อโกง|ลักทรัพย์|ฆาตกรรม|อาวุธปืน/g],
  ['mission', 2, /ภารกิจ|ถวายความปลอดภัย|ถวายอารักขา|รักษาความปลอดภัย|อารักขา|ปฏิบัติการพิเศษ|ตั้งด่าน|จุดตรวจ|ระดมกวาดล้าง|ปิดล้อม|กู้ภัย|ช่วยเหลือผู้ประสบ|เหตุการณ์ชุมนุม|ควบคุมฝูงชน/g],
  ['volunteer', 2, /จิตอาสา|บริจาค|การกุศล|เดิน-?\s?วิ่ง|charity|run\b|บำเพ็ญประโยชน์|ปลูกป่า|ซุ้มกระบี่|ขบวน(?:สนาม|พาเหรด)?|พิธี|กีฬา|การแข่งขัน|ร่วมกิจกรรม|เข้าร่วมกิจกรรม|จัดกิจกรรม|อำนวยความสะดวก/gi],
  ['project', 3, /ริเริ่ม|นวัตกรรม|พัฒนาระบบ|ผู้พัฒนา|จัดทำ(?:ระบบ|คู่มือ|แผน|ฐานข้อมูล)|คู่มือ|ออกแบบ(?:โลโก้|ระบบ)?|ปรับปรุงกระบวนการ|แอปพลิเคชัน|ไลน์บอท|line\s?bot|chatbot/gi],
  ['project', 1, /โครงการ/g],
];

const ROLE_RE = /(หัวหน้าชุด(?:จับกุม|สืบสวน|ปฏิบัติการ)?|ผู้บังคับหมวด[^\s]{0,12}|ผู้ช่วยผู้บังคับหมวด|หัวหน้าตอนเรียน|ผู้อำนวยความสะดวก|ผู้จัดกิจกรรม|ผู้พัฒนา(?:ระบบ)?|ตัวแทน(?:นักเรียนนายร้อยตำรวจ)?|หัวหน้าทีม|หัวหน้าชุดจับกุม|ผู้รับผิดชอบหลัก|ผู้ร่วม(?:ปฏิบัติ|จับกุม|สืบสวน)(?:งาน)?|ผู้ประสานงาน|พนักงานสอบสวน(?:เจ้าของสำนวน)?|เจ้าของสำนวน|ผู้บังคับการเหตุการณ์|ผู้สั่งการ|ผู้ควบคุม(?:ชุด|การปฏิบัติ)|วิทยากร|ผู้เข้า(?:รับการ)?อบรม)/;
const DEFAULT_ROLE = { award: 'ผู้ได้รับรางวัล', training: 'ผู้เข้าอบรม', speaker: 'วิทยากร', volunteer: 'ผู้เข้าร่วม' };

const NUM = '(\\d[\\d,]*(?:\\.\\d+)?)';
const toN = (s, million) => {
  const n = Number(String(s).replace(/,/g, ''));
  return million ? n * 1e6 : n;
};
// [label, unit (ถ้าว่างใช้ที่จับได้), regex (กลุ่ม 1 = ตัวเลข, กลุ่ม 2 = "ล้าน" หรือหน่วย)]
const FIGURE_RULES = [
  ['จับกุมผู้ต้องหา', 'ราย', new RegExp(`(?:จับกุม|จับตัว)[^\\d\\n]{0,30}?${NUM}\\s*(ราย|คน|นาย)`)],
  ['จับกุมผู้ต้องหา', 'ราย', new RegExp(`ผู้ต้องหา\\s*(?:จำนวน|รวม|ทั้งหมด)?\\s*${NUM}\\s*(ราย|คน)`)],
  ['ยึดทรัพย์', 'บาท', new RegExp(`(?:ยึด|อายัด)(?:ทรัพย์(?:สิน)?|เงิน(?:สด)?)?[^\\d\\n]{0,24}?${NUM}\\s*(ล้าน)?\\s*บาท`)],
  ['มูลค่าความเสียหาย', 'บาท', new RegExp(`(?:ความเสียหาย|เสียหาย)(?:รวม|มูลค่า|กว่า|ประมาณ|\\s)*${NUM}\\s*(ล้าน)?\\s*บาท`)],
  ['ยาบ้า', 'เม็ด', new RegExp(`ยาบ้า\\s*(?:จำนวน|รวม|กว่า|ประมาณ)?\\s*${NUM}\\s*(ล้าน)?\\s*เม็ด`)],
  ['ไอซ์', 'กิโลกรัม', new RegExp(`(?:ไอซ์|ยาไอซ์)\\s*(?:จำนวน|น้ำหนัก|รวม)?\\s*${NUM}\\s*(กิโลกรัม|กก\\.?|กรัม)`)],
  ['ของกลาง', 'รายการ', new RegExp(`ของกลาง[^\\d\\n]{0,16}?${NUM}\\s*(รายการ|ชิ้น|คัน|เครื่อง|กระบอก|ถุง)`)],
  ['อาวุธปืน', 'กระบอก', new RegExp(`อาวุธปืน[^\\d\\n]{0,10}?${NUM}\\s*(กระบอก)`)],
  ['หมายจับ', 'หมาย', new RegExp(`หมายจับ\\s*(?:จำนวน|รวม)?\\s*${NUM}\\s*(หมาย|ฉบับ)`)],
  ['ตรวจค้น', 'จุด', new RegExp(`ตรวจค้น(?:เป้าหมาย)?\\s*(?:จำนวน|รวม|พร้อมกัน)?\\s*${NUM}\\s*(จุด|แห่ง|เป้าหมาย|หลัง)`)],
  ['ผู้เสียหาย', 'ราย', new RegExp(`ผู้เสียหาย\\s*(?:จำนวน|รวม|กว่า)?\\s*${NUM}\\s*(ราย|คน)`)],
  ['บัญชีม้า', 'บัญชี', new RegExp(`บัญชีม้า\\s*(?:จำนวน|รวม|กว่า)?\\s*${NUM}\\s*(บัญชี)`)],
  ['ผู้เข้าร่วม', 'คน', new RegExp(`(?:ผู้เข้าร่วม|ผู้เข้า(?:รับการ)?อบรม|ผู้ฟัง|ผู้เข้าฟัง|ผู้ร่วมงาน|นักเรียน|ประชาชน)(?:กว่า|ประมาณ|จำนวน|รวม|\\s)*${NUM}\\s*(คน|ราย|นาย)`)],
];
const HOURS_RE = new RegExp(`${NUM}\\s*ชั่วโมง`);

const LEAD_JUNK = /^(?:[^\p{L}\p{N}]+|(?:\d{1,2}|[๑-๙])[.)]\s+|วันนี้|เมื่อวานซืน|เมื่อวาน(?:นี้)?|ข่าวดี|แจ้งข่าว|ประชาสัมพันธ์|รายงานผล(?:การปฏิบัติ(?:งาน)?)?|ขอรายงานผล(?:การปฏิบัติ(?:งาน)?)?|ผลการปฏิบัติ(?:งาน)?|ผลงาน(?:เด่น)?|เรื่อง|หัวข้อ|สรุป)\s*[:：\-!]?\s*/u;
const GREETING = /^(?:เรียน|ถึง|สวัสดี|เรื่องแจ้ง|แจ้งเพื่อทราบ|ด่วน|fw:|fwd:)\b.*$/i;
const POLITE = /\s*(?:นะ)?(?:ครับผม|ครับ|ค่ะ|คะ|จ้า|ฮะ)+\s*[!.]*$/;
const CUT = new RegExp(
  '\\s+(?=เมื่อ(?:วัน|เวลา)|เมื่อวันที่|เมื่อ\\s*\\d|เมื่อวาน|วันที่\\s*\\d|\\d{1,2}\\s*(?:' + MONTH_RE + ')|โทร|ของกลาง|(?:ยึด|อายัด)(?:ทรัพย์|เงิน)|มูลค่า|ระหว่างวันที่|ณ\\s|' +
    'ที่\\s*(?:อ\\.|อำเภอ|จ\\.|จังหวัด|ต\\.|ตำบล|บ้านเลขที่|ห้อง|สน\\.|สภ\\.|ร\\.ร\\.|โรงเรียน|โรงแรม|สถาบัน|หอประชุม|มหาวิทยาลัย|กระทรวง|ศูนย์)|โดยมี|โดย(?=\\s|[ก-๙])|พร้อม(?:ด้วย)?ของกลาง|ตาม(?:หมาย|คำสั่ง))',
);

// ข้อมูลบุคคล (เตือน และลบให้ได้)
const PERSON_RE = /(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง)\s*([ก-๙]{2,}(?:\s+[ก-๙]{2,})?)/g;
const ID_RE = /(?<!\d)\d[\s-]?\d{4}[\s-]?\d{5}[\s-]?\d{2}[\s-]?\d(?!\d)/g;
const PHONE_RE = /(?<!\d)0[689]\d[\s-]?\d{3}[\s-]?\d{4}(?!\d)|(?<!\d)0[2-7][\s-]?\d{3}[\s-]?\d{4}(?!\d)/g;
const ACCT_RE = /(?<!\d)\d{3}[\s-]\d[\s-]\d{5}[\s-]\d(?!\d)|(?<=บัญชี(?:เลขที่)?\s*)\d{6,}/g;
const AGE_ADDR_RE = /\s*อายุ\s*\d{1,3}\s*ปี|\s*(?:บ้าน)?เลขที่\s*\d+(?:\/\d+)?(?:\s*หมู่(?:ที่)?\s*\d+)?/g;

/** พบข้อมูลบุคคลอะไรบ้าง */
export function personalInfo(text) {
  const t = normalize(text);
  const out = sensitiveWarnings(t);
  // ชื่อที่มีคำนำหน้า (ไม่นับชื่อตำแหน่ง เช่น "นายตำรวจ")
  const names = [...t.matchAll(PERSON_RE)].filter((m) => !/^(?:ตำรวจ|ทหาร|อำเภอ|กอง|ร้อย|พัน|สิบ|ดาบ|พล|แพทย์|ก)/.test(m[2]));
  if (names.length) out.push('ชื่อบุคคล');
  if (/อายุ\s*\d{1,3}\s*ปี/.test(t)) out.push('อายุ');
  if (/(?:บ้าน)?เลขที่\s*\d+/.test(t)) out.push('บ้านเลขที่');
  return [...new Set(out)];
}

/** ลบข้อมูลบุคคลออกจากข้อความ */
export function stripPersonal(text) {
  return String(text || '')
    .replace(PERSON_RE, (m, pre, name) => (/^(?:ตำรวจ|ทหาร|อำเภอ|กอง|ร้อย|พัน|สิบ|ดาบ|พล|แพทย์|ก)/.test(name) ? m : `${pre} [ลบชื่อ]`))
    .replace(ID_RE, '[ลบเลขบัตร]')
    .replace(PHONE_RE, '[ลบเบอร์]')
    .replace(ACCT_RE, '[ลบเลขบัญชี]')
    .replace(AGE_ADDR_RE, '')
    .replace(/[ \t]{2,}/g, ' ');
}

function scoreTypes(s) {
  const score = {};
  TYPE_RULES.forEach(([id, w, re]) => {
    const n = (s.match(re) || []).length;
    if (n) score[id] = (score[id] || 0) + w * Math.min(n, 3);
  });
  return score;
}
const bestType = (score) => Object.entries(score).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';

/** วันที่ของผลงาน: เป็นอดีตเป็นหลัก (ไม่ระบุปีแล้วเลยวันนี้ไป → ปีก่อน / วันในสัปดาห์ → สัปดาห์ก่อน) */
function findWhen(s, now) {
  const today = toKey(now);
  // ช่วงวันที่: 10 – 21 มี.ค. 69 / ระหว่างวันที่ 10-21 มีนาคม 2569
  const range = new RegExp(`(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s*(${MONTH_RE})\\s*(?:พ\\.?\\s?ศ\\.?\\s*)?(25\\d{2}|20\\d{2}|\\d{2}(?![\\d.:]))?`, 'i');
  const r = s.match(range);
  if (r) {
    const y = fixYear(r[4]) ?? now.getFullYear();
    const mi = monthIndex(r[3]);
    const a = new Date(y, mi, Number(r[1]));
    const b = new Date(y, mi, Number(r[2]));
    if (a.getMonth() === mi && b.getMonth() === mi && b >= a) {
      let from = toKey(a);
      let to = toKey(b);
      if (!r[4] && from > today) {
        from = toKey(new Date(y - 1, mi, Number(r[1])));
        to = toKey(new Date(y - 1, mi, Number(r[2])));
      }
      return { date: from, endDate: to, found: r[0].trim() };
    }
  }
  if (/เมื่อวานซืน/.test(s)) return { date: toKey(addDays(now, -2)), found: 'เมื่อวานซืน' };
  if (/เมื่อวาน/.test(s)) return { date: toKey(addDays(now, -1)), found: 'เมื่อวาน' };
  const ds = findDates(s, now).filter((d) => !d.weak);
  if (!ds.length) {
    const y = s.match(/(?:ประจำปี|ปี(?:พ\.?ศ\.?)?|พ\.ศ\.)\s*(25\d{2})(?!\d)/);
    if (y) return { date: `${Number(y[1]) - 543}-01-01`, found: y[0], yearOnly: true };
    return null;
  }
  const d = ds[0];
  let key = d.date;
  const hasYear = /(?:25|20)\d{2}|\s\d{2}(?!\d)/.test(d.label) || /\/\d{2,4}$/.test(d.label);
  const weekday = !/\d/.test(d.label);
  if (weekday && key > today) key = toKey(addDays(fromKey(key), -7));
  else if (key > toKey(addDays(now, 1)) && !hasYear) {
    const dt = fromKey(key);
    key = toKey(weekday ? addDays(dt, -7) : new Date(dt.getFullYear() - 1, dt.getMonth(), dt.getDate()));
    // makeDate อาจเลื่อนไปปีหน้าแล้ว ลองย้อนอีกปีถ้ายังเลยวันนี้
    if (key > today && !weekday) key = toKey(new Date(dt.getFullYear() - 2, dt.getMonth(), dt.getDate()));
  }
  return { date: key, found: d.label };
}

function findFigures(s, type) {
  const out = [];
  const seen = new Set();
  FIGURE_RULES.forEach(([label, unit, re]) => {
    if (seen.has(label)) return;
    const m = s.match(re);
    if (!m) return;
    const million = m[2] === 'ล้าน';
    const n = toN(m[1], million);
    if (!Number.isFinite(n) || n <= 0) return;
    let u = unit;
    if (!million && m[2] && !['ราย', 'คน', 'นาย'].includes(m[2]) && label !== 'ยึดทรัพย์') u = m[2].replace(/^กก\.?$/, 'กิโลกรัม');
    seen.add(label);
    out.push({ label, n, unit: u });
  });
  if ((type === 'training' || type === 'speaker') && !seen.has('ชั่วโมงอบรม')) {
    const h = s.match(HOURS_RE);
    if (h) out.push({ label: type === 'speaker' ? 'ชั่วโมงบรรยาย' : 'ชั่วโมงอบรม', n: toN(h[1]), unit: 'ชั่วโมง' });
  }
  return out.slice(0, 5);
}

function findOrg(s, type) {
  if (type === 'award') {
    const g = s.match(/(?:จาก|มอบโดย)\s*([^\n,()]{2,60})/);
    if (g && cleanOrg(g[1])) return cleanOrg(g[1]);
  }
  const at = s.match(/(?:^|\s)ณ\s*([^\n,()]{3,60})/) || s.match(/(?:^|\s)ที่\s*((?:ร\.ร\.|โรงเรียน|สถาบัน|มหาวิทยาลัย|ห้องประชุม|หอประชุม|สโมสร|ศูนย์|กองบัญชาการ|สถานีตำรวจ|สน\.|สภ\.)[^\n,()]{1,50})/);
  if (at && cleanOrg(at[1])) return cleanOrg(at[1]);
  const inst = s.match(/((?:สถาบัน|โรงเรียนนายร้อย|โรงเรียน|มหาวิทยาลัย|ศูนย์ฝึก|วิทยาลัย|สำนักงานตำรวจแห่งชาติ|บช\.[ก-๙]+|บก\.[ก-๙]+)[^\n,()]{0,36})/);
  if (inst && (type === 'training' || type === 'speaker' || type === 'award')) return cleanOrg(inst[1]);
  return '';
}

const DATE_TAIL = new RegExp(`\\s*(?:เมื่อ|ใน)?\\s*(?:วัน(?:ที่)?\\s*)?\\d{1,2}\\s*(?:${MONTH_RE})\\.?\\s*(?:(?:พ\\.?\\s?ศ\\.?\\s*)?(?:25\\d{2}|20\\d{2}|\\d{2}))?\\s*$`, 'i');
const cleanOrg = (o) =>
  o
    .split(/\s+(?=เมื่อ|วันที่|ระหว่าง|เวลา|รวม|จำนวน|โดย)/)[0]
    .replace(DATE_TAIL, '')
    .replace(/[\s,，:]+$/, '')
    .trim();

function makeTitle(seg, type) {
  const lines = seg.split('\n').map((l) => l.trim()).filter(Boolean);
  let line = lines.find((l) => !GREETING.test(l) && l.replace(LEAD_JUNK, '').length > 4) || lines[0] || '';
  for (let i = 0; i < 3; i++) line = line.replace(LEAD_JUNK, '');
  let t = line.split(CUT)[0];
  if (type === 'award') t = t.split(/\s+(?=จาก\s|มอบโดย)/)[0];
  t = t.replace(DATE_TAIL, '');
  t = t.replace(POLITE, '').replace(/[\s:：,，\-–]+$/, '').trim();
  if (t.length > 90) {
    const cut = t.slice(0, 90);
    t = (cut.lastIndexOf(' ') > 40 ? cut.slice(0, cut.lastIndexOf(' ')) : cut) + '…';
  }
  return { title: t || (type === 'award' ? 'ได้รับรางวัล' : 'ผลงาน'), line };
}

/** แบ่งข้อความเป็นผลงานหลายชิ้น (ข้อ 1. 2. 3. หรือย่อหน้า) */
function segments(text) {
  const t = text.trim();
  const numbered = t.split(/\n(?=\s*(?:\d{1,2}[.)]|[๑-๙][.)])\s+)/);
  const paras = t.split(/\n\s*\n/);
  const looks = (s) => Object.keys(scoreTypes(s)).length > 0;
  const pick = (parts) => {
    const good = parts.filter((p) => p.trim() && looks(p));
    return good.length >= 2 ? good : null;
  };
  return pick(numbered) || pick(paras) || [t];
}

/** ข้อความ → [{ type, title, date, endDate, role, org, result, figures, highlight, found, warnings, privacy }] */
export function parsePortfolio(raw, { now = new Date() } = {}) {
  const text = normalize(raw).replace(/\n{3,}/g, '\n\n');
  if (!text) return [];
  return segments(text).map((seg) => {
    const s = seg.trim();
    const score = scoreTypes(s);
    const type = bestType(score);
    const when = findWhen(s, now);
    const { title, line } = makeTitle(s, type);
    const roleM = s.match(ROLE_RE);
    const lead = s.replace(/^\(?\d{1,2}[.)]\s*/, '');
    const role = roleM
      ? roleM[1].replace(/\s+$/, '')
      : /^จัดทำ/.test(lead)
      ? 'ผู้จัดทำ'
      : /^(?:เป็นผู้)?จัด(?:กิจกรรม|งาน|โครงการ)/.test(lead)
      ? 'ผู้จัดกิจกรรม'
      : DEFAULT_ROLE[type] || '';
    const figures = findFigures(s, type);
    // รายละเอียด = ข้อความทั้งหมด ยกเว้นคำทักทาย (ถ้าบรรทัดแรกเป็นแค่หัวข้อสั้น ๆ ไม่ซ้ำ)
    const body = s
      .split('\n')
      .map((l) => l.replace(POLITE, '').trim())
      .filter((l) => l && !GREETING.test(l))
      .filter((l, i) => !(i === 0 && l === line && l.length <= title.length + 2))
      .join('\n')
      .replace(/^\s*(?:\d{1,2}[.)]|[๑-๙][.)])\s+/, '')
      .slice(0, 2000);
    const warnings = [];
    if (!when) warnings.push('ไม่พบวันที่ ใช้วันนี้แทน');
    else if (when.yearOnly) warnings.push('ระบุแค่ปี ตั้งเป็น 1 ม.ค. ไว้ก่อน');
    if (type === 'other') warnings.push('ไม่แน่ใจประเภท เลือกเองได้');
    return {
      type,
      title,
      date: when?.date || todayKey(),
      endDate: when?.endDate || '',
      role,
      org: findOrg(s, type),
      result: body,
      lesson: '',
      figures,
      links: [...new Set(s.match(/https?:\/\/[^\s<>"']+/g) || [])],
      highlight: type === 'award' || /ดีเด่น|ชนะเลิศ|รางวัลที่\s*1|ผลงานเด่น/.test(s),
      found: { date: when?.found || '', type: Object.keys(score).length ? type : '' },
      warnings,
      privacy: personalInfo(s),
    };
  });
}

/** ข้อความนี้น่าจะเป็นผลงานไหม (ใช้แนะนำในหน้าวางข้อความทั่วไป) */
export function looksLikeAchievement(raw) {
  const s = normalize(raw);
  const score = scoreTypes(s);
  const strong =
    (score.award || 0) + (score.career || 0) + (score.speaker || 0) + (score.mission || 0) +
    (/จับกุม|ยึด|ของกลาง/.test(s) ? 3 : 0) + (/ผ่านการ(?:อบรม|ฝึก)|จบหลักสูตร|สำเร็จการ|ได้รับ(?:วุฒิบัตร|ประกาศนียบัตร)/.test(s) ? 3 : 0);
  const timeOfFuture = /(?:\d{1,2}[.:]\d{2}\s*น\.?)|ขอเชิญ|เชิญประชุม|กำหนดส่ง/.test(s);
  return strong >= 3 && !timeOfFuture;
}
