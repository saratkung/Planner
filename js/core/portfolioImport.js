// ==========================================================
// portfolioImport.js — ไฟล์ Word (รายงานผลการปฏิบัติงาน / แฟ้มผลงาน) → ร่างผลงาน + รูปประกอบ
// ==========================================================
import { normalize } from './parse.js';
import { parsePortfolio } from './portfolioParse.js';

// ย่อหน้าที่ไม่ใช่ผลงาน: หัวเรื่อง แบบฟอร์ม ช่องลงชื่อ
const JUNK = [
  /ระบุ(?:ชื่อ)?/, /ความประพฤติ|ตัดคะแนน/, /ขอรับรอง/, /\(ลงชื่อ\)|^ลงชื่อ/, /\.{6,}/, /^ยศ\s*ชื่อ/, /ประกอบการพิจารณา/,
  /^ภาพประกอบ$/, /^(?:ชื่อ|ตำแหน่ง|สังกัด|หน่วยงาน)\s*[:：]/, /^\(?\s*\)?$/, /^หน้า\s*\d+/,
];
// ประโยคที่บอกการกระทำ (ถึงจะนับเป็นผลงาน)
const ACTION = /ได้รับ|เข้าร่วม|ร่วม|รวมกิจกรรม|เป็น(?:ผู้|ตัวแทน|วิทยากร|หัวหน้า|กรรมการ)|จัด(?:กิจกรรม|ทำ|โครงการ)?|ปฏิบัติหน้าที่|ทำหน้าที่|พัฒนา|ผ่านการ|สำเร็จ|ชนะ|รางวัล|คัดเลือก|แต่งตั้ง|ถ่ายทอด|บรรยาย|อบรม|ศึกษาดูงาน|จับกุม|ตรวจค้น|สืบสวน|บริจาค|ออกแบบ|ริเริ่ม/;
// ขึ้นต้นแบบประโยคใหม่ (ไม่ใช่บรรทัดต่อจากคำบรรยายก่อนหน้า)
const STARTS_NEW = /^(?:\(?(?:\d{1,2}|[๑-๙]{1,2})[.)]\s*)?(?:ได้|เข้า|เป็น|จัด|ร่วม|รวม|ปฏิบัติ|ทำหน้าที่|ผ่าน|พัฒนา|ถ่ายทอด|บรรยาย|อบรม|ศึกษา|จับกุม|ตรวจ|สืบสวน|บริจาค|ออกแบบ|คลี่คลาย|ชนะ)/;
const THAI_NUM = '๐๑๒๓๔๕๖๗๘๙';

const isJunk = (t) => JUNK.some((re) => re.test(t));
const keyOf = (t) =>
  normalize(t)
    .replace(/^\(?(?:\d{1,2})[.)]\s*/, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();

/** "1) … 2) … 3) …" ที่พิมพ์ติดกันในย่อหน้าเดียว → แยกเป็นข้อ ๆ (หาเลขข้อถัดไปทีละข้อ จึงไม่สับสนกับ "รุ่นที่ ๗๗") */
function splitNumbered(text) {
  const t = normalize(text);
  const m = t.match(/^\(?(\d{1,2})[.)]\s*/);
  if (!m) return [text];
  const out = [];
  let k = Number(m[1]);
  let rest = t;
  for (let guard = 0; guard < 40; guard++) {
    const next = new RegExp(`(?<=\\S)\\s*\\(?${k + 1}[.)]\\s*(?=\\S)`);
    const body = rest.replace(new RegExp(`^\\(?${k}[.)]\\s*`), '');
    const at = body.search(next);
    if (at < 0) {
      out.push(body.trim());
      break;
    }
    out.push(body.slice(0, at).trim());
    rest = body.slice(at).trim();
    k++;
  }
  return out.filter(Boolean);
}

/**
 * แปลงย่อหน้าในเอกสารเป็นร่างผลงาน
 * order: 'auto' | 'above' (รูปอยู่เหนือคำบรรยาย) | 'below' (รูปอยู่ใต้คำบรรยาย)
 */
export function docxToDrafts(doc, { order = 'auto', now = new Date() } = {}) {
  // 1) จัดย่อหน้าเป็นลำดับเหตุการณ์: ผลงานใหม่ / บรรทัดต่อ / รูป / หัวเรื่อง
  const events = [];
  doc.paragraphs.forEach((p) => {
    const t = (p.text || '').trim();
    if (t) {
      if (isJunk(t) || (!ACTION.test(t) && !STARTS_NEW.test(t) && t.length < 6)) events.push({ kind: 'junk', text: t, images: p.images });
      else if (ACTION.test(t) && (STARTS_NEW.test(t) || t.length > 25)) splitNumbered(t).forEach((x) => events.push({ kind: 'entry', text: x }));
      else events.push({ kind: 'cont', text: t });
      if (p.images.length && !isJunk(t)) events.push({ kind: 'img', images: p.images });
    } else if (p.images.length) events.push({ kind: 'img', images: p.images });
  });

  // 2) เดาว่ารูปอยู่เหนือหรือใต้คำบรรยาย: ดูกลุ่มรูปแรกที่ตามหลังหัวเรื่อง
  let mode = order;
  if (mode === 'auto') {
    mode = 'below';
    for (let i = 0; i < events.length; i++) {
      if (events[i].kind !== 'img') continue;
      const prev = events.slice(0, i).reverse().find((e) => e.kind !== 'cont');
      if (!prev || prev.kind === 'junk') {
        mode = 'above';
        break;
      }
      if (prev.kind === 'entry') break;
    }
  }

  // 3) สร้างผลงาน + ผูกรูป (ผลงานที่ซ้ำ เช่น ในสรุปด้านบนกับในภาพประกอบ จะรวมเป็นข้อเดียว)
  const entries = [];
  // ข้อเดียวกัน = ข้อความตรงกัน หรือข้อความหนึ่งเป็นส่วนต้นของอีกข้อความ (เช่น คำบรรยายรูปที่ไม่มีวันที่ต่อท้าย)
  const findSame = (k) => entries.find((en) => en.key === k || (Math.min(k.length, en.key.length) >= 18 && (en.key.startsWith(k) || k.startsWith(en.key))));
  let current = null;
  let pending = [];
  const addImages = (en, imgs) => imgs.forEach((im) => !en.images.includes(im) && en.images.push(im));
  const startEntry = (text) => {
    const k = keyOf(text);
    let en = findSame(k);
    if (!en) {
      en = { text, images: [], key: k };
      entries.push(en);
    } else if (text.length > en.text.length) {
      en.text = text;
      en.key = k;
    }
    if (mode === 'above' && pending.length) addImages(en, pending);
    pending = [];
    return en;
  };
  let lastWasImg = false;
  events.forEach((e) => {
    if (e.kind === 'junk') {
      current = null;
      lastWasImg = false;
      return;
    }
    if (e.kind === 'entry') {
      current = startEntry(e.text);
      lastWasImg = false;
      return;
    }
    if (e.kind === 'cont') {
      // บรรทัดต่อของคำบรรยาย (เช่น "วันที่ 29 ต.ค.68 ที่ ...")
      if (current && (mode === 'above' || !lastWasImg)) {
        if (!current.text.includes(e.text)) current.text += ' ' + e.text;
      }
      return;
    }
    if (e.kind === 'img') {
      if (mode === 'above') pending.push(...e.images);
      else if (current) addImages(current, e.images);
      else pending.push(...e.images);
      lastWasImg = true;
    }
  });
  if (pending.length && entries.length) addImages(mode === 'above' ? entries[entries.length - 1] : entries[0], pending);

  // 4) อ่านรายละเอียดแต่ละข้อด้วยตัวอ่านผลงาน
  const drafts = entries.map((en) => {
    const d = parsePortfolio(en.text.replace(/\n/g, ' '), { now })[0];
    return { ...d, result: en.text, photos: en.images };
  });
  return { drafts, mode, images: new Set(doc.paragraphs.flatMap((p) => p.images)).size };
}

export const _test = { splitNumbered, keyOf, THAI_NUM };
