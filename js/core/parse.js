// ==========================================================
// parse.js — แปลงข้อความ (หนังสือเชิญ / แชท LINE) เป็น ประชุม / นัดหมาย / งาน
//
// ทำงานในเครื่องทั้งหมด ไม่ส่งข้อความไปที่ไหน
// parseText(text, { now }) -> [{ type, title, date, start, end, location, link,
//                                attendees, agenda, priority, notes, found, warnings }]
// ==========================================================
import { toKey, addDays, pad } from './utils.js';

const TH_MONTHS = [
  ['มกราคม', 'ม.ค.', 'มค'], ['กุมภาพันธ์', 'ก.พ.', 'กพ'], ['มีนาคม', 'มี.ค.', 'มีค'],
  ['เมษายน', 'เม.ย.', 'เมย'], ['พฤษภาคม', 'พ.ค.', 'พค'], ['มิถุนายน', 'มิ.ย.', 'มิย'],
  ['กรกฎาคม', 'ก.ค.', 'กค'], ['สิงหาคม', 'ส.ค.', 'สค'], ['กันยายน', 'ก.ย.', 'กย'],
  ['ตุลาคม', 'ต.ค.', 'ตค'], ['พฤศจิกายน', 'พ.ย.', 'พย'], ['ธันวาคม', 'ธ.ค.', 'ธค'],
];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MONTH_ALTS = TH_MONTHS.flatMap((names, i) => names.map((n) => [n, i]))
  .concat(EN_MONTHS.map((n, i) => [n + '[a-z]*\\.?', i]))
  .sort((a, b) => b[0].length - a[0].length);
const MONTH_RE = MONTH_ALTS.map(([n]) => (n.includes('[a-z]') ? n : esc(n).replace(/\\\./g, '\\.?'))).join('|');
const monthIndex = (s) => {
  const t = s.toLowerCase().replace(/\s/g, '');
  for (const [n, i] of MONTH_ALTS) {
    if (n.includes('[a-z]')) {
      if (t.startsWith(n.slice(0, 3))) return i;
    } else if (t.replace(/\./g, '') === n.replace(/\./g, '')) return i;
  }
  return -1;
};

const WEEKDAYS = [
  ['อาทิตย์', 0], ['จันทร์', 1], ['อังคาร', 2], ['พุธ', 3], ['พฤหัสบดี', 4], ['พฤหัส', 4], ['ศุกร์', 5], ['เสาร์', 6],
];
const WD_RE = WEEKDAYS.map(([n]) => n).join('|');
const EN_WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const NUM_WORDS = { หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10, สิบเอ็ด: 11, สิบสอง: 12 };
const NW_RE = Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join('|');
const num = (s) => (s == null ? null : /^\d+$/.test(s) ? Number(s) : NUM_WORDS[s] ?? null);

const MEETING_RE = /ประชุม|หารือ|สัมมนา|ชี้แจง|บรีฟ|brief|meeting|conference|zoom|meet\.google|teams\.|webex|นัดคุย|คุยงาน|วางแผน|ประสานงาน|อบรม/i;
const TASK_RE = /ส่ง(?!ผล)|จัดทำ|รายงาน|ภายใน(?:วัน)?|ก่อนวัน|กำหนดส่ง|deadline|due|ฝาก|เตรียม(?:เอกสาร|ข้อมูล)|ทำ(?:เอกสาร|สรุป)|อย่าลืม|เตือน|ตรวจสอบ|ติดตาม|ดำเนินการ|todo|to-do/i;
const URGENT_RE = /ด่วนที่สุด|ด่วนมาก|ด่วน|urgent|asap/i;
const LINK_RE = /https?:\/\/[^\s<>"'”）)]+/gi;

/** แปลงเลขไทยเป็นอารบิก และจัดช่องว่าง */
export function normalize(text) {
  return String(text || '')
    .replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ​]+/g, ' ')
    .replace(/：/g, ':')
    .trim();
}

function fixYear(y) {
  if (y == null) return null;
  let n = Number(y);
  if (y.length === 2) n = n >= 40 ? 2500 + n : 2000 + n; // 67 -> 2567 (พ.ศ.), 26 -> 2026
  if (n > 2400) n -= 543;
  return n;
}

function makeDate(y, m, d, now) {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  let year = y ?? now.getFullYear();
  let dt = new Date(year, m, d);
  if (dt.getMonth() !== m) return null;
  // ไม่ระบุปี และวันที่ผ่านไปนานแล้ว -> ปีหน้า
  if (y == null && dt < addDays(now, -45)) dt = new Date(year + 1, m, d);
  return dt;
}

// ---------------- dates ----------------
function findDates(s, now) {
  const out = [];
  const add = (m, date, label, weak = false) => {
    if (!date) return;
    out.push({ index: m.index, end: m.index + m[0].length, date: toKey(date), label: label || m[0].trim(), weak });
  };
  let m;
  // 14 พฤศจิกายน 2569 / วันพฤหัสบดีที่ 14 พ.ย. 69 / Nov 14
  const thDate = new RegExp(
    `(?:วัน(?:${WD_RE})\\s*(?:ที่)?\\s*)?(?:ที่\\s*)?(\\d{1,2})\\s*(${MONTH_RE})\\s*(?:(?:พ\\.?\\s?ศ\\.?|ค\\.?\\s?ศ\\.?)\\s*)?(25\\d{2}|20\\d{2}|\\d{2}(?![\\d.:]))?`,
    'gi',
  );
  while ((m = thDate.exec(s))) add(m, makeDate(fixYear(m[3]), monthIndex(m[2]), Number(m[1]), now));
  const enDate = new RegExp(`\\b(${EN_MONTHS.join('|')})[a-z]*\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?`, 'gi');
  while ((m = enDate.exec(s))) add(m, makeDate(m[3] ? Number(m[3]) : null, monthIndex(m[1]), Number(m[2]), now));
  // 14/11/2569 · 14-11-69 · 14.11.69
  const numDate = /(?<![\d:.])(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?![\d:])/g;
  while ((m = numDate.exec(s))) add(m, makeDate(fixYear(m[3]), Number(m[2]) - 1, Number(m[1]), now));
  // 14/11 (ไม่มีปี ต้องใช้ /)
  const shortDate = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g;
  while ((m = shortDate.exec(s))) add(m, makeDate(null, Number(m[2]) - 1, Number(m[1]), now));
  // วันที่ 20 (นี้/เดือนนี้/เดือนหน้า)
  const dayOnly = new RegExp(`วันที่\\s*(\\d{1,2})(?!\\s*(?:${MONTH_RE}|[/\\-.]\\d|\\d))\\s*(เดือนหน้า|เดือนนี้|นี้)?`, 'gi');
  while ((m = dayOnly.exec(s))) {
    const d = Number(m[1]);
    let dt = new Date(now.getFullYear(), now.getMonth() + (m[2] === 'เดือนหน้า' ? 1 : 0), d);
    if (!m[2] && dt < addDays(now, -1)) dt = new Date(now.getFullYear(), now.getMonth() + 1, d);
    if (d >= 1 && d <= 31) add(m, dt);
  }
  // คำสัมพัทธ์
  const rel = [
    [/มะรืน(?:นี้)?/g, 2], [/พรุ่งนี้|tomorrow/gi, 1],
    [/วันนี้|คืนนี้|เช้านี้|บ่ายนี้|เย็นนี้|today|tonight/gi, 0],
  ];
  rel.forEach(([re, n]) => {
    while ((m = re.exec(s))) add(m, addDays(now, n));
  });
  // วันศุกร์ / ศุกร์นี้ / วันจันทร์หน้า
  const wd = new RegExp(`(วัน)?(${WD_RE})\\s*(หน้า|นี้|ถัดไป)?`, 'g');
  while ((m = wd.exec(s))) {
    if (!m[1] && !m[3]) continue; // "อาทิตย์" เฉย ๆ อาจแปลว่าสัปดาห์
    if (!m[1] && m[2] === 'อาทิตย์' && m[3] === 'หน้า') continue; // "อาทิตย์หน้า" = สัปดาห์หน้า
    const target = WEEKDAYS.find(([n]) => n === m[2])[1];
    let diff = (target - now.getDay() + 7) % 7;
    if (m[3] === 'หน้า') diff += diff === 0 ? 7 : 7;
    add(m, addDays(now, diff));
  }
  const enWd = /\b(?:next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/gi;
  while ((m = enWd.exec(s))) {
    const target = EN_WD.indexOf(m[1].toLowerCase());
    let diff = (target - now.getDay() + 7) % 7;
    if (/^next/i.test(m[0])) diff += 7;
    add(m, addDays(now, diff));
  }
  const nextWeek = /(?<!วัน)(?:อาทิตย์หน้า|สัปดาห์หน้า|next week)/gi;
  while ((m = nextWeek.exec(s))) add(m, addDays(now, 7), m[0], true);

  // ตัดที่ซ้อนกัน (เก็บอันที่ยาวกว่า)
  out.sort((a, b) => a.index - b.index || b.end - a.end);
  return out.filter((d, i) => !out.some((o, j) => j !== i && o.index <= d.index && o.end >= d.end && (o.end - o.index > d.end - d.index || j < i)));
}

// ---------------- times ----------------
function findTimes(s) {
  const out = [];
  const add = (m, h, min, label) => {
    if (h == null || h > 23 || min > 59) return;
    out.push({ index: m.index, end: m.index + m[0].length, mins: h * 60 + (min || 0), label: label || m[0].trim() });
  };
  let m;
  const hm = /(?<![\d/.:])([01]?\d|2[0-3])\s?[:.]\s?([0-5]\d)(?![\d/])\s*(?:น\.?|นาฬิกา|hrs?\.?)?/g;
  while ((m = hm.exec(s))) add(m, Number(m[1]), Number(m[2]));
  const hOnly = /(?<![\d:.])([01]?\d|2[0-3])\s*(?:น\.|นาฬิกา)/g;
  while ((m = hOnly.exec(s))) add(m, Number(m[1]), 0);
  const ampm = /(?<![\d:.])(1[0-2]|0?\d)(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)/gi;
  while ((m = ampm.exec(s))) {
    let h = Number(m[1]) % 12;
    if (/p/i.test(m[3])) h += 12;
    add(m, h, Number(m[2] || 0));
  }
  const noon = /เที่ยง(?:วัน|ตรง)?(?:\s*ครึ่ง)?/g;
  while ((m = noon.exec(s))) add(m, 12, /ครึ่ง/.test(m[0]) ? 30 : 0);
  const afternoon = new RegExp(`บ่าย\\s*(\\d{1,2}|${NW_RE})?\\s*(โมง)?\\s*(ครึ่ง)?`, 'g');
  while ((m = afternoon.exec(s))) {
    if (!m[1] && !m[2]) continue;
    const n = m[1] ? num(m[1]) : 1;
    if (n == null || n > 6) continue;
    add(m, 12 + n, m[3] ? 30 : 0);
  }
  const mong = new RegExp(`(?<!บ่าย\\s*)(?<![\\d.:])(\\d{1,2}|${NW_RE})\\s*โมง\\s*(เช้า|เย็น|ตรง)?\\s*(ครึ่ง)?`, 'g');
  while ((m = mong.exec(s))) {
    let h = num(m[1]);
    if (h == null) continue;
    if (m[2] === 'เย็น' && h < 12) h += 12;
    else if (m[2] !== 'เช้า' && h >= 1 && h <= 6) h += 12; // "4 โมง" = 16:00
    add(m, h, m[3] ? 30 : 0);
  }
  const toom = new RegExp(`(\\d|${NW_RE})\\s*ทุ่ม\\s*(ครึ่ง)?`, 'g');
  while ((m = toom.exec(s))) {
    const n = num(m[1]);
    if (n != null && n <= 5) add(m, 18 + n, m[2] ? 30 : 0);
  }
  const tee = new RegExp(`ตี\\s*(\\d|${NW_RE})\\s*(ครึ่ง)?`, 'g');
  while ((m = tee.exec(s))) {
    const n = num(m[1]);
    if (n != null && n <= 5) add(m, n, m[2] ? 30 : 0);
  }
  out.sort((a, b) => a.index - b.index || b.end - a.end);
  return out.filter((t, i) => !out.some((o, j) => j !== i && o.index <= t.index && o.end >= t.end && (o.end - o.index > t.end - t.index || j < i)));
}

/** หาเวลาเริ่ม-สิ้นสุด: เวลาสองค่าที่คั่นด้วย - ถึง to */
function pickTimes(s, times) {
  if (!times.length) return { start: null, end: null };
  for (let i = 0; i < times.length - 1; i++) {
    const gap = s.slice(times[i].end, times[i + 1].index);
    if (/^\s*(?:-|–|—|~|ถึง(?:เวลา)?|to|จนถึง)\s*$/i.test(gap) && times[i + 1].mins > times[i].mins) {
      return { start: times[i], end: times[i + 1] };
    }
  }
  return { start: times[0], end: null };
}

// ---------------- other fields ----------------
const STOP = '(?=\\s*(?:เวลา|วันที่|ในวัน|โดย|แต่งกาย|ผู้เข้าร่วม|ลิงก์|link|zoom|https?:|\\n|,|，|$))';

function findLocation(s) {
  const pats = [
    new RegExp(`(?:สถานที่|location|place)\\s*:?\\s*([^\\n]{2,80}?)${STOP}`, 'i'),
    new RegExp(`(?:^|\\s)ณ\\s*([^\\n]{2,80}?)${STOP}`),
    new RegExp(`(?:ที่|@)\\s*((?:ห้อง|อาคาร|ตึก|ชั้น|สน\\.|สภ\\.|บก\\.|บช\\.|กองบังคับการ|กองบัญชาการ|ร้าน|โรงแรม|ศาล|สำนักงาน)[^\\n]{0,70}?)${STOP}`),
    new RegExp(`((?:ห้องประชุม|ห้อง)\\s*[^\\s,\\n]+(?:\\s*ชั้น\\s*\\d+)?(?:\\s*(?:อาคาร|ตึก)\\s*[^\\s,\\n]+)?)`),
    /((?:สนาม|ศาล|โรงแรม|ร้าน|สถานี|โรงพยาบาล|รพ\.|สน\.|สภ\.)[^\s,\n]+)/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) {
      const loc = m[1].replace(/\s*(?:ครับ|ค่ะ|คะ|นะ.*)$/, '').trim();
      if (loc && !/^https?:/i.test(loc)) return { value: loc, index: s.indexOf(m[1]), end: s.indexOf(m[1]) + m[1].length };
    }
  }
  return null;
}

function findAttendees(s) {
  const names = [];
  const m = s.match(/(?:ผู้เข้าร่วม(?:ประชุม)?|ผู้เข้าประชุม|ผู้ร่วมประชุม|attendees?|participants?)\s*:?\s*([^\n]+)/i);
  if (m) {
    m[1]
      .split(/,|，|、|\s+และ\s*|\s{2,}|\/(?!\/)/)
      .map((x) => x.replace(/^[-•*\d.)\s]+/, '').trim())
      .filter((x) => x && x.length <= 40)
      .forEach((x) => names.push(x));
  }
  for (const at of s.matchAll(/@([^\s@,]{2,30})/g)) if (!names.includes(at[1])) names.push(at[1]);
  return names.slice(0, 20);
}

function findAgenda(lines) {
  const items = [];
  let inAgenda = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^(?:ระเบียบ)?วาระ(?:การประชุม)?\s*:?\s*$|^หัวข้อ(?:การประชุม)?\s*:?\s*$|^agenda\s*:?\s*$/i.test(line)) {
      inAgenda = true;
      continue;
    }
    const vara = line.match(/^วาระที่\s*\d+\s*[:.)-]?\s*(.+)$/);
    if (vara) {
      items.push(vara[1].trim());
      inAgenda = true;
      continue;
    }
    if (inAgenda) {
      const it = line.match(/^(?:[-•*▪︎●]|\d+[.)])\s*(.+)$/);
      if (it) items.push(it[1].trim());
      else if (!line) continue;
      else inAgenda = false;
    }
  }
  return items.slice(0, 15);
}

const GREETING_RE = /^(?:เรียน|ถึง|สวัสดี|เรื่องแจ้ง|แจ้งเพื่อทราบ|dear|hi|hello|fw:|fwd:)\b.*$/i;
const POLITE_END_RE = /\s*(?:นะ)?(?:ครับผม|ครับ|ค่ะ|คะ|จ้า|จ้ะ|ฮะ|นะ)+\s*[!.]*$/;
const LEAD_RE = /^(?:ขอเชิญ(?:เข้าร่วม)?|เรียนเชิญ|ขอเรียนเชิญ|เชิญ(?:เข้าร่วม)?|ขอแจ้ง|แจ้ง(?:ว่า)?|ขอนัด|นัด(?!คุย)|ขอ)\s*/;

// คำที่ค้างท้ายชื่อ: คำยาวตัดได้แม้ติดกับคำก่อน, คำสั้น (ใน ที่ ณ ...) ตัดเฉพาะเมื่อเว้นวรรค
const DANGLING_END = /(?:\s*(?:ในวันที่|ในวัน|วันที่|เวลา|ภายใน|ด่วนที่สุด|ด่วนมาก|ด่วน)|\s+(?:ใน|วัน|ที่|ณ|ก่อน|โดย|และ|กับ|ช่วง))\s*$/;
const NOISE = /\s*(?:zoom|teams|google meet|meet|ลิงก์|link)\b\s*/gi;

function cleanTitle(t) {
  let s = t
    .replace(/^(?:ฝาก|รบกวน|ช่วย|please)\s*/i, '')
    .replace(LEAD_RE, '')
    .replace(/(?:นะ)?(?:ครับผม|ครับ|ค่ะ|คะ|จ้า|จ้ะ)(?=\s|$)/g, ' ')
    .replace(/(?<=\S)นะ(?=\s|$)/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  for (let i = 0; i < 4; i++) s = s.replace(DANGLING_END, '').replace(POLITE_END_RE, '').trim();
  return s.replace(/^[-•*:\s]+|[-•*:,\s]+$/g, '').trim().slice(0, 80);
}

function findTitle(seg, type, removeSpans) {
  // เรื่อง: ...
  const sub = seg.match(/(?:^|\n)\s*(?:เรื่อง|subject|หัวข้อ)\s*:?\s*([^\n]{3,})/i);
  if (sub && !/^\s*$/.test(sub[1])) return cleanTitle(sub[1]);
  // ลบส่วนที่เป็นวันที่ เวลา สถานที่ ลิงก์ ออกก่อน
  let s = seg;
  removeSpans
    .sort((a, b) => b.index - a.index)
    .forEach((r) => (s = s.slice(0, r.index) + ' ' + s.slice(r.end)));
  s = s.replace(LINK_RE, ' ');
  const lines = s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !GREETING_RE.test(l) && !/^(?:meeting id|passcode|รหัส|id\s*:|แต่งกาย|หมายเหตุ|ผู้เข้าร่วม|วาระ)/i.test(l));
  if (type === 'meeting') {
    const all = lines.join(' ');
    const m = all.match(/((?:ประชุม|หารือ|สัมมนา|ชี้แจง|บรีฟ|นัดคุย|คุยงาน|อบรม|meeting)[^\n]*?)(?=\s+ณ\s|\s*(?:ในวัน|วันที่|วัน(?:จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์)|เวลา|โดย|$))/i);
    if (m) {
      const t = cleanTitle(m[1].replace(/^นัดคุย/, 'คุย'));
      if (t.length >= 4) return t;
    }
  }
  const first = lines.find((l) => cleanTitle(l).length >= 2);
  return first ? cleanTitle(first.replace(/^(?:[-•*]|\d+[.)])\s*/, '')) : '';
}

/** มีวันหรือเวลาที่ชัดเจนไหม */
function hasWhen(t, now) {
  return findDates(t, now).some((d) => !d.weak) || findTimes(t).length > 0;
}

/**
 * แบ่งข้อความเป็นหลายรายการ:
 * 1) หลายย่อหน้า (คั่นด้วยบรรทัดว่าง) ที่แต่ละย่อหน้ามีวัน/เวลา
 * 2) รายการแบบตาราง (บรรทัดขึ้นต้นด้วยวันที่)
 * 3) หลายบรรทัดที่แต่ละบรรทัดมีวันที่ของตัวเอง (เช่น ส่งต่อหลายข้อความ)
 * บรรทัดที่ไม่มีวันที่ (สถานที่ แต่งกาย วาระ) จะติดไปกับรายการก่อนหน้า
 */
function segments(text, now) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length >= 2 && paras.filter((p) => hasWhen(p, now)).length >= 2) {
    const out = [];
    paras.forEach((p) => {
      if (hasWhen(p, now) || !out.length) out.push(p);
      else out[out.length - 1] += '\n' + p;
    });
    if (!hasWhen(out[0], now) && out.length > 1) out.splice(0, 2, out[0] + '\n' + out[1]);
    return out;
  }
  const lines = text.split('\n');
  const strong = (l) => findDates(l, now).filter((d) => !d.weak);
  // ตาราง: บรรทัดขึ้นต้นด้วยวันที่ (หัวตารางไม่นับเป็นรายการ)
  const starts = [];
  lines.forEach((l, i) => {
    const body = l.replace(/^\s*(?:[-•*▪︎●]|\d+[.)]|(?:จ|อ|พ|พฤ|ศ|ส|อา)\.)\s*/, '');
    const ds = strong(body);
    if (ds.length && ds[0].index <= 12 && body.length > ds[0].end - ds[0].index + 2) starts.push(i);
  });
  if (starts.length >= 2) return starts.map((st, k) => lines.slice(st, starts[k + 1] ?? lines.length).join('\n'));
  // หลายบรรทัด แต่ละบรรทัดมีวันที่ของตัวเอง
  const dated = lines.map((l, i) => (strong(l).length ? i : -1)).filter((i) => i >= 0);
  if (dated.length >= 2) {
    return dated.map((st, k) => lines.slice(k === 0 ? 0 : st, dated[k + 1] ?? lines.length).join('\n'));
  }
  return [text];
}

function classify(seg, { hasTime, hasDate, link, attendees }) {
  if (MEETING_RE.test(seg) || link || attendees.length) return 'meeting';
  if (TASK_RE.test(seg) && !hasTime) return 'task';
  if (hasDate || hasTime) return 'event';
  return 'task';
}

export function parseText(raw, { now = new Date() } = {}) {
  const text = normalize(raw);
  if (!text) return [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return segments(text, today).map((seg) => parseSegment(seg, today, text));
}

function parseSegment(seg, now, whole) {
  const warnings = [];
  const dates = findDates(seg, now);
  // ตัดช่วงวันที่ออกก่อนหาเวลา (กัน 14.11.69 กลายเป็นเวลา)
  let masked = seg;
  dates.forEach((d) => (masked = masked.slice(0, d.index) + ' '.repeat(d.end - d.index) + masked.slice(d.end)));
  const times = findTimes(masked);
  const { start, end } = pickTimes(masked, times);
  const links = seg.match(LINK_RE) || [];
  const link = links.find((l) => /zoom|meet\.google|teams|webex|meet\./i.test(l)) || links[0] || '';
  const attendees = findAttendees(seg);
  const loc = findLocation(masked);
  const lines = seg.split('\n');
  const agenda = findAgenda(lines);

  // วันที่หลัก: ไม่ใช่อันที่อยู่หลังคำว่า "ภายใน / ตอบรับ / ก่อน" (มักเป็นกำหนดตอบกลับ)
  const deadlineIdx = (d) => /(?:ภายใน|ก่อน|ตอบรับ|แจ้งกลับ|ยืนยัน)[^\n]{0,20}$/.test(seg.slice(Math.max(0, d.index - 30), d.index));
  const main = dates.find((d) => !d.weak && !deadlineIdx(d)) || dates.find((d) => !d.weak) || dates[0] || null;
  const hasDate = !!main;
  const hasTime = !!start;
  let type = classify(seg, { hasTime, hasDate, link, attendees });
  if (type === 'task' && main && deadlineIdx(main) === false && hasTime) type = 'event';

  const date = main?.date || toKey(now);
  if (!hasDate) warnings.push('ไม่พบวันที่ ใช้วันนี้แทน');
  if (main?.weak) warnings.push('วันที่ไม่ชัดเจน กรุณาตรวจสอบ');
  let startMins = start?.mins ?? null;
  let endMins = end?.mins ?? null;
  if (type !== 'task') {
    if (startMins == null) {
      startMins = 9 * 60;
      warnings.push('ไม่พบเวลา ตั้งเป็น 09:00');
    }
    if (endMins == null) endMins = Math.min(startMins + 60, 23 * 60 + 59);
  }
  if (main && main.date < toKey(now)) warnings.push('วันที่ผ่านไปแล้ว');

  const spans = [...dates, ...times, ...(loc ? [loc] : [])];
  let title = findTitle(seg, type, spans);
  if (!title) title = type === 'meeting' ? 'ประชุม' : type === 'task' ? 'งานใหม่' : 'นัดหมาย';

  return {
    type,
    title,
    date,
    start: startMins != null ? `${pad(Math.floor(startMins / 60))}:${pad(startMins % 60)}` : '',
    end: endMins != null ? `${pad(Math.floor(endMins / 60))}:${pad(endMins % 60)}` : '',
    location: loc?.value || '',
    link,
    attendees,
    agenda,
    priority: URGENT_RE.test(seg) ? 'high' : 'medium',
    notes: (seg === whole ? seg : seg).slice(0, 2000),
    found: {
      date: main?.label || '',
      time: start ? (end ? `${start.label} – ${end.label}` : start.label) : '',
      location: loc?.value || '',
      link: !!link,
    },
    warnings,
  };
}
