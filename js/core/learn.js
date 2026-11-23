// ==========================================================
// learn.js — บันทึก "วันนี้เรียนรู้อะไร": แยกเป็นข้อ ๆ จัดหมวดอัตโนมัติ และทำรายงานส่ง LINE
// ==========================================================
import { store } from './store.js';
import { uid, todayKey, toKey, fromKey, addDays, formatDate, THAI_MONTHS_SHORT, thaiYear } from './utils.js';
import { normalize } from './parse.js';
import { weekDays } from './selectors.js';

/** หมวดการเรียนรู้ (คำสำคัญใช้จัดหมวดอัตโนมัติ — ข้อไหนเจอคำของหมวดไหนมากสุด ได้หมวดนั้น) */
export const LEARN_CATS = [
  {
    id: 'law', label: 'กฎหมาย & ระเบียบ', short: 'กฎหมาย', emoji: '⚖️', color: '#5b4bc4', icon: 'scales',
    words: ['กฎหมาย', 'มาตรา', 'ระเบียบ', 'พ.ร.บ', 'พรบ', 'ป.อ', 'ป.วิ', 'ประมวล', 'ฎีกา', 'คำพิพากษา', 'ศาล', 'หมายจับ', 'หมายค้น', 'อำนาจ', 'ข้อบังคับ', 'คำสั่ง', 'ประกาศ', 'กฎกระทรวง', 'รัฐธรรมนูญ', 'ฐานความผิด', 'โทษ', 'อัยการ', 'ฟ้อง', 'ประกันตัว', 'ฝากขัง', 'อายุความ', 'สิทธิ', 'ระเบียบการตำรวจ', 'law', 'legal'],
  },
  {
    id: 'work', label: 'งานสืบสวน & ปฏิบัติงาน', short: 'งาน', emoji: '🕵️', color: '#2563eb', icon: 'shieldSearch',
    words: ['คดี', 'สืบสวน', 'สอบสวน', 'จับกุม', 'ผู้ต้องหา', 'ผู้ต้องสงสัย', 'หลักฐาน', 'พยาน', 'ตรวจค้น', 'ปฏิบัติการ', 'ภารกิจ', 'เคส', 'แผนประทุษกรรม', 'ข่าวสาร', 'ข่าวกรอง', 'สายลับ', 'ล่อซื้อ', 'ยาเสพติด', 'แก๊ง', 'เครือข่าย', 'ของกลาง', 'สำนวน', 'บันทึกจับกุม', 'ตรวจที่เกิดเหตุ', 'ที่เกิดเหตุ', 'งาน', 'รายงาน', 'ประชุม', 'โครงการ', 'วางแผน', 'ขั้นตอน', 'ประสานงาน', 'ราชการ', 'หนังสือราชการ'],
  },
  {
    id: 'people', label: 'คน & การสื่อสาร', short: 'คน', emoji: '🤝', color: '#ec4899', icon: 'users',
    words: ['คุย', 'พูด', 'ฟัง', 'สื่อสาร', 'เจรจา', 'ต่อรอง', 'ผู้นำ', 'ภาวะผู้นำ', 'ลูกน้อง', 'หัวหน้า', 'ผู้บังคับบัญชา', 'ทีม', 'เพื่อนร่วมงาน', 'ความสัมพันธ์', 'ครอบครัว', 'ลูก', 'ภรรยา', 'สามี', 'แฟน', 'พ่อ', 'แม่', 'เพื่อน', 'คน', 'ชม', 'ขอบคุณ', 'ขอโทษ', 'อารมณ์', 'เข้าใจ', 'มอบหมาย', 'สอนงาน', 'feedback', 'โค้ช', 'ประชาชน', 'ผู้เสียหาย'],
  },
  {
    id: 'tech', label: 'เทคโนโลยี & ทักษะ', short: 'ทักษะ', emoji: '💻', color: '#0ea5e9', icon: 'laptop',
    words: ['แอป', 'โปรแกรม', 'คอม', 'คอมพิวเตอร์', 'มือถือ', 'โทรศัพท์', 'ระบบ', 'ออนไลน์', 'อินเทอร์เน็ต', 'excel', 'word', 'google', 'email', 'อีเมล', 'ai', 'chatgpt', 'claude', 'line', 'facebook', 'ข้อมูล', 'ฐานข้อมูล', 'cctv', 'กล้อง', 'gps', 'ไซเบอร์', 'แฮก', 'รหัสผ่าน', 'บัญชีม้า', 'คริปโต', 'โค้ด', 'เขียนโปรแกรม', 'ทักษะ', 'เทคนิค', 'วิธีใช้', 'shortcut', 'ทางลัด', 'เครื่องมือ', 'ภาษาอังกฤษ', 'คำศัพท์', 'english', 'ยิงปืน', 'ขับรถ'],
  },
  {
    id: 'health', label: 'สุขภาพ & ร่างกาย', short: 'สุขภาพ', emoji: '💪', color: '#10b981', icon: 'heartPulse',
    words: ['สุขภาพ', 'ออกกำลัง', 'วิ่ง', 'ฟิตเนส', 'ยิม', 'เดิน', 'นอน', 'หลับ', 'พักผ่อน', 'กิน', 'อาหาร', 'น้ำหนัก', 'ลดน้ำหนัก', 'ร่างกาย', 'ปวด', 'หมอ', 'โรงพยาบาล', 'ยา', 'ความดัน', 'น้ำตาล', 'ไขมัน', 'กาแฟ', 'ดื่มน้ำ', 'ความเครียด', 'เครียด', 'สมาธิ', 'ยืดเส้น', 'โยคะ', 'ว่ายน้ำ', 'ปั่น'],
  },
  {
    id: 'finance', label: 'การเงิน', short: 'การเงิน', emoji: '💰', color: '#d9a21b', icon: 'coins',
    words: ['เงิน', 'การเงิน', 'ออม', 'ลงทุน', 'หุ้น', 'กองทุน', 'ดอกเบี้ย', 'ภาษี', 'ลดหย่อน', 'หนี้', 'ผ่อน', 'บัตรเครดิต', 'ค่าใช้จ่าย', 'รายจ่าย', 'รายรับ', 'เงินเดือน', 'ประกัน', 'บำนาญ', 'กบข', 'สหกรณ์', 'ทอง', 'บาท', 'งบ', 'ประหยัด', 'ซื้อ', 'ขาย'],
  },
  {
    id: 'life', label: 'ข้อคิด & ชีวิต', short: 'ข้อคิด', emoji: '🌱', color: '#8b5cf6', icon: 'sprout',
    words: ['ข้อคิด', 'ชีวิต', 'ใจ', 'จิตใจ', 'อดทน', 'ความสุข', 'สุข', 'ทุกข์', 'ทัศนคติ', 'มุมมอง', 'ผิดพลาด', 'บทเรียน', 'ไม่ควร', 'ควร', 'อย่า', 'ปล่อยวาง', 'ใจเย็น', 'โกรธ', 'ขอบคุณ', 'ความรับผิดชอบ', 'วินัย', 'เวลา', 'ตรงเวลา', 'เป้าหมาย', 'ตัวเอง', 'นิสัย', 'ธรรมะ', 'สติ', 'ความพยายาม', 'กำลังใจ', 'คุณค่า'],
  },
  {
    id: 'general', label: 'ความรู้ทั่วไป', short: 'ทั่วไป', emoji: '📚', color: '#64748b', icon: 'book',
    words: ['หนังสือ', 'อ่าน', 'บทความ', 'ข่าว', 'ประวัติ', 'ประวัติศาสตร์', 'วิทยาศาสตร์', 'รู้ว่า', 'เพิ่งรู้', 'ความรู้', 'สารคดี', 'podcast', 'พอดแคสต์', 'youtube', 'คอร์ส', 'อบรม', 'สัมมนา', 'เรียน'],
  },
];
export const DEFAULT_CAT = 'general';
export const learnCat = (id) => LEARN_CATS.find((c) => c.id === id) || LEARN_CATS.find((c) => c.id === DEFAULT_CAT);

const QUOTES = [
  'ความรู้เพิ่มขึ้นทีละนิด ทุกวันคือการลงทุนที่คุ้มที่สุด',
  'ทุกบทเรียนวันนี้ คือเครื่องมือของวันพรุ่งนี้',
  'คนเก่งไม่ใช่คนที่รู้ทุกอย่าง แต่คือคนที่เรียนรู้ทุกวัน',
  'จดไว้ก่อน แล้วความรู้จะไม่หายไปกับเวลา',
  'ความผิดพลาดคือครูที่ดีที่สุด ถ้าเรายอมเรียนจากมัน',
  'ก้าวเล็ก ๆ ทุกวัน ไปได้ไกลกว่าที่คิด',
  'วันนี้ดีกว่าเมื่อวาน แค่นั้นก็พอ',
];

// ---------------- แยกข้อความเป็นข้อ ๆ ----------------
const BULLET = /^\s*(?:[-–•*·▪▫◦●○✓✔☑➤➜→>]+|\(?[0-9๐-๙]{1,2}[.)]|[0-9]️?⃣|[ก-ฮ][.)])\s*/u;
const LEAD = /^(?:วันนี้\s*)?(?:ได้)?(?:เรียนรู้|รู้|เรียน)(?:ว่า|เรื่อง|มา(?:ว่า)?)?\s*[:：-]?\s*/;
const HEADER = /^(?:วันนี้(?:ได้)?เรียนรู้(?:อะไร(?:บ้าง)?)?|สิ่งที่(?:ได้)?เรียนรู้(?:วันนี้)?|บทเรียน(?:วันนี้)?|today i learned|til)\s*[:：]?\s*$/i;

/** ข้อความยาว ๆ → รายการข้อเรียนรู้ (แยกตามบรรทัด / ข้อ / ตัวเลข) */
export function splitPoints(raw) {
  let text = String(raw || '').replace(/\r/g, '').trim();
  if (!text) return [];
  // "1) ... 2) ..." หรือ "1. ... 2. ..." ในบรรทัดเดียว → ขึ้นบรรทัดใหม่
  text = text.replace(/\s+(?=(?:[0-9๐-๙]{1,2}[.)]|[0-9]️?⃣)\s*\S)/gu, (m, off, s) => {
    const before = s.slice(Math.max(0, off - 1), off);
    return /[0-9.]/.test(before) ? m : '\n';
  });
  // หัวข้อ เช่น "วันนี้เรียนรู้: ..." ที่มีเนื้อหาต่อท้าย
  text = text.replace(/^(วันนี้(?:ได้)?เรียนรู้(?:อะไรบ้าง)?|สิ่งที่ได้เรียนรู้(?:วันนี้)?)\s*[:：]\s*/i, '');
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(BULLET, '').trim())
    .filter((l) => l && !HEADER.test(l));
  const out = [];
  lines.forEach((l) => {
    // ตามด้วยตัวคั่น ; หรือ " | "
    l.split(/\s*[;|]\s+|\s*;\s*/).forEach((p) => {
      let s = p.replace(LEAD, '').replace(/\s+/g, ' ').trim();
      s = s.replace(/^[,，、]\s*/, '');
      if (s.length >= 2) out.push(s.length > 500 ? s.slice(0, 500) : s);
    });
  });
  // บรรทัดสั้นมาก (ไม่กี่ตัวอักษร) ที่ต่อจากข้อก่อนหน้า ให้รวมกัน
  return out.reduce((acc, s) => {
    if (acc.length && s.length < 6 && !/^[A-Za-z]/.test(s)) acc[acc.length - 1] += ' ' + s;
    else acc.push(s);
    return acc;
  }, []);
}

/** จัดหมวดจากคำสำคัญ: คำยาว (เจาะจง) ได้คะแนนมากกว่า */
export function classify(text) {
  const t = normalize(String(text || '')).toLowerCase();
  let best = DEFAULT_CAT;
  let top = 0;
  LEARN_CATS.forEach((c, i) => {
    let score = 0;
    c.words.forEach((w) => {
      const k = w.toLowerCase();
      // คำภาษาอังกฤษต้องเป็นคำเต็ม (กัน "ai" ไปเจอใน "email")
      const hit = /^[a-z]/.test(k) ? new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t) : t.includes(k);
      if (hit) score += 1 + Math.min(w.length, 10) / 5;
    });
    // คำว่า "งาน" / "คน" / "ควร" กว้างไป ให้น้ำหนักน้อยกว่าหมวดเจาะจงเล็กน้อย
    score -= i * 0.01;
    if (score > top) {
      top = score;
      best = c.id;
    }
  });
  return best;
}

/** ข้อความ → [{ text, cat }] */
export function processLearning(raw) {
  return splitPoints(raw).map((text) => ({ text, cat: classify(text) }));
}

// ---------------- สถิติ ----------------
export const learnings = () => store.state.learnings || [];

export function learningsBetween(a, b) {
  return learnings()
    .filter((l) => l.date >= a && l.date <= b)
    .sort((x, y) => (x.date === y.date ? (x.createdAt || 0) - (y.createdAt || 0) : x.date < y.date ? -1 : 1));
}

/** จำนวนวันติดต่อกันที่มีบันทึก (ถ้าวันนี้ยังไม่บันทึก นับถึงเมื่อวาน) */
export function learnStreak() {
  const days = new Set(learnings().map((l) => l.date));
  let d = new Date();
  if (!days.has(toKey(d))) d = addDays(d, -1);
  let n = 0;
  while (days.has(toKey(d)) && n < 3650) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function byCategory(list) {
  const m = {};
  list.forEach((l) => (m[l.cat] = (m[l.cat] || 0) + 1));
  return LEARN_CATS.filter((c) => m[c.id]).map((c) => ({ cat: c, n: m[c.id], items: list.filter((l) => l.cat === c.id) }));
}

/** ช่วงเวลาของรายงาน */
export function periodRange(period) {
  const today = todayKey();
  if (period === 'week') {
    const days = weekDays(0);
    return { from: days[0], to: days[6] < today ? days[6] : today, end: days[6], days: 7 };
  }
  if (period === 'month') {
    const d = new Date();
    const from = toKey(new Date(d.getFullYear(), d.getMonth(), 1));
    return { from, to: today, end: toKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)), days: d.getDate() };
  }
  return { from: today, to: today, end: today, days: 1 };
}

// ---------------- รายงานสำหรับแชท / LINE ----------------
const KEYCAP = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const LINE = '━━━━━━━━━━━━';

function rangeLabel(a, b) {
  const x = fromKey(a);
  const y = fromKey(b);
  if (a === b) return formatDate(a, { weekday: true });
  const same = x.getMonth() === y.getMonth();
  return `${x.getDate()}${same ? '' : ' ' + THAI_MONTHS_SHORT[x.getMonth()]}–${y.getDate()} ${THAI_MONTHS_SHORT[y.getMonth()]} ${thaiYear(y)}`;
}

/** แท่งกราฟด้วยตัวอักษร (แสดงใน LINE ได้) */
const textBar = (n, max, w = 8) => {
  const f = max ? Math.max(1, Math.round((n / max) * w)) : 0;
  return '▰'.repeat(f) + '▱'.repeat(w - f);
};

export function reportData(period = 'today') {
  const r = periodRange(period);
  const list = learningsBetween(r.from, r.to);
  const groups = byCategory(list).sort((a, b) => b.n - a.n);
  const loggedDays = new Set(list.map((l) => l.date)).size;
  return { period, ...r, list, groups, loggedDays, streak: learnStreak() };
}

/** ข้อความรายงานพร้อมอิโมจิ (ส่งเข้า LINE ได้เลย) */
export function reportText(period = 'today', { perCat = period === 'today' ? 10 : 5 } = {}) {
  const d = reportData(period);
  const name = store.state.settings.name?.trim();
  const title = period === 'today' ? '💡 บันทึกการเรียนรู้ประจำวัน' : period === 'week' ? '📚 สรุปการเรียนรู้ประจำสัปดาห์' : '🗂️ สรุปการเรียนรู้ประจำเดือน';
  const lines = [title, `🗓️ ${period === 'month' ? `เดือน${formatDate(d.from).split(' ').slice(1).join(' ')}` : rangeLabel(d.from, period === 'week' ? d.end : d.to)}`];
  if (name) lines.push(`👤 ${name}`);
  lines.push(LINE);

  if (!d.list.length) {
    lines.push(period === 'today' ? '📝 วันนี้ยังไม่ได้บันทึกการเรียนรู้' : '📝 ช่วงนี้ยังไม่มีบันทึกการเรียนรู้', '', '✍️ เริ่มจดสิ่งที่ได้เรียนรู้วันละข้อก็พอ');
    return lines.join('\n');
  }

  if (period !== 'today') {
    const max = Math.max(...d.groups.map((g) => g.n));
    lines.push(`📝 ทั้งหมด ${d.list.length} เรื่อง · 📆 บันทึก ${d.loggedDays}/${d.days} วัน`);
    lines.push('');
    lines.push('📊 แยกตามหมวด');
    d.groups.forEach((g) => lines.push(`${g.cat.emoji} ${g.cat.short} ${textBar(g.n, max)} ${g.n}`));
    lines.push(LINE);
  }

  d.groups.forEach((g, gi) => {
    if (gi) lines.push('');
    lines.push(`${g.cat.emoji} ${g.cat.label} (${g.n})`);
    const items = period === 'today' ? g.items : [...g.items].reverse(); // สรุปยาว: ล่าสุดก่อน
    items.slice(0, perCat).forEach((l, i) => {
      const day = period === 'today' ? '' : ` (${fromKey(l.date).getDate()} ${THAI_MONTHS_SHORT[fromKey(l.date).getMonth()]})`;
      lines.push(`${items.length <= 10 && period === 'today' ? KEYCAP[i] : '▸'} ${l.text}${day}`);
    });
    if (items.length > perCat) lines.push(`   …และอีก ${items.length - perCat} เรื่อง`);
  });

  lines.push(LINE);
  const top = d.groups[0];
  if (period === 'today') lines.push(`✨ วันนี้ได้เรียนรู้ ${d.list.length} เรื่อง`);
  if (d.streak > 1) lines.push(`🔥 เรียนรู้ต่อเนื่อง ${d.streak} วัน`);
  if (d.groups.length > 1 || period !== 'today') lines.push(`🏆 หมวดเด่น: ${top.cat.emoji} ${top.cat.label}`);
  const q = QUOTES[(fromKey(d.to).getDate() + d.list.length) % QUOTES.length];
  lines.push(`💬 “${q}”`);
  return lines.join('\n');
}

/** ข้อความทักทายของบอทในหน้าแชท */
export function botIntro(period) {
  const d = reportData(period);
  const h = new Date().getHours();
  const hi = h < 12 ? 'อรุณสวัสดิ์ครับ ☀️' : h < 18 ? 'สวัสดีครับ 👋' : 'สวัสดีตอนค่ำครับ 🌙';
  if (!d.list.length) return [hi, period === 'today' ? 'วันนี้ยังไม่มีบันทึกการเรียนรู้เลย ลองจดสักข้อไหมครับ ✍️' : 'ช่วงนี้ยังไม่มีบันทึกการเรียนรู้ครับ'];
  const what = period === 'today' ? 'วันนี้' : period === 'week' ? 'สัปดาห์นี้' : 'เดือนนี้';
  const top = d.groups[0];
  const msgs = [hi, `${what}คุณเรียนรู้ไป ${d.list.length} เรื่อง ${d.list.length >= 3 ? 'เยี่ยมมาก! 🎉' : 'ดีมากครับ 👍'}`];
  if (d.groups.length > 1) msgs.push(`ส่วนใหญ่เป็นเรื่อง ${top.cat.emoji} ${top.cat.label}`);
  if (d.streak > 1) msgs.push(`บันทึกต่อเนื่อง ${d.streak} วันแล้ว 🔥 รักษาไว้นะครับ`);
  msgs.push('นี่คือรายงานที่เตรียมไว้ให้ แตะ “ส่งไป LINE” ได้เลย 👇');
  return msgs;
}

/** เปิดหน้าแชร์ของ LINE พร้อมข้อความ (มือถือจะเปิดแอป LINE ให้เลือกห้องแชท) */
export function lineShareURL(text) {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

/** บันทึกหลายข้อพร้อมกัน */
export function saveLearnings(points, date = todayKey(), source = '') {
  const now = Date.now();
  store.batch((state) => {
    points.forEach((p, i) => {
      const text = String(p.text || '').trim();
      if (!text) return;
      state.learnings.push({
        id: uid(),
        date, text: text.slice(0, 500), cat: learnCat(p.cat).id, source, createdAt: now + i,
      });
    });
  });
}

