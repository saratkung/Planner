// ==========================================================
// docx.js — อ่านไฟล์ Word (.docx) ในเครื่อง: ข้อความทีละย่อหน้า + รูปที่อยู่ในย่อหน้านั้น
// ไม่ใช้ไลบรารีภายนอก (แตก ZIP เอง + DecompressionStream ของเบราว์เซอร์)
// ==========================================================
import { fixThaiPUA } from './parse.js';

const W ='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const IMG_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

/** อ่านรายการไฟล์ใน ZIP → Map(ชื่อไฟล์ → () => Promise<Uint8Array>) */
function unzipIndex(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์ Word (.docx)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    files.set(name, async () => {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = u8.subarray(start, start + csize);
      if (method === 0) return raw;
      if (method !== 8) throw new Error('รูปแบบการบีบอัดไฟล์ไม่รองรับ');
      if (typeof DecompressionStream === 'undefined') throw new Error('เบราว์เซอร์นี้เปิดไฟล์ Word ไม่ได้ ลองอัปเดตเบราว์เซอร์');
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/**
 * อ่าน .docx → { paragraphs: [{ text, images: [{ name, file: File }] }], title }
 * ย่อหน้าในตาราง / กล่องข้อความ ถูกอ่านตามลำดับในเอกสาร (ข้ามส่วน Fallback ที่ซ้ำ)
 */
export async function readDocx(file) {
  const files = unzipIndex(await file.arrayBuffer());
  const get = async (name) => {
    const f = files.get(name);
    if (!f) return null;
    return f();
  };
  const text = async (name) => {
    const b = await get(name);
    return b ? new TextDecoder().decode(b) : '';
  };
  const xml = await text('word/document.xml');
  if (!xml) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์ Word (.docx)');
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const rels = parser.parseFromString((await text('word/_rels/document.xml.rels')) || '<Relationships/>', 'application/xml');
  const relMap = new Map([...rels.getElementsByTagName('Relationship')].map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));

  const imageCache = new Map();
  const loadImage = async (rid) => {
    const target = relMap.get(rid);
    if (!target) return null;
    const path = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`;
    if (imageCache.has(path)) return imageCache.get(path);
    const ext = path.split('.').pop().toLowerCase();
    const mime = IMG_MIME[ext];
    if (!mime) return null; // emf / wmf: แสดงในเบราว์เซอร์ไม่ได้
    const bytes = await get(path);
    if (!bytes) return null;
    const img = { name: path.split('/').pop(), file: new File([bytes], path.split('/').pop(), { type: mime }) };
    imageCache.set(path, img);
    return img;
  };

  // เดินทั้งเอกสารตามลำดับ: ย่อหน้าซ้อน (ในกล่องข้อความ) แยกเป็นย่อหน้าของตัวเอง
  const paragraphs = [];
  const walkPara = (p, out) => {
    const parts = [];
    const rids = [];
    const visit = (node) => {
      for (const ch of node.children) {
        if (ch.namespaceURI === MC && ch.localName === 'Fallback') continue;
        if (ch.namespaceURI === W && ch.localName === 'p') {
          walkPara(ch, out); // ย่อหน้าในกล่องข้อความ
          continue;
        }
        if (ch.namespaceURI === W && ch.localName === 't') parts.push(ch.textContent);
        else if (ch.namespaceURI === W && (ch.localName === 'tab')) parts.push(' ');
        else if (ch.namespaceURI === W && (ch.localName === 'br' || ch.localName === 'cr')) parts.push('\n');
        else if (ch.namespaceURI === A && ch.localName === 'blip') {
          const id = ch.getAttributeNS(R, 'embed') || ch.getAttribute('r:embed');
          if (id) rids.push(id);
        }
        visit(ch);
      }
    };
    const idx = out.length;
    out.push(null); // จองตำแหน่ง (ย่อหน้านี้มาก่อนย่อหน้าในกล่องข้อความของมัน)
    visit(p);
    out[idx] = { text: fixThaiPUA(parts.join('')).replace(/[ \t ]+/g, ' ').trim(), rids: [...new Set(rids)] };
  };
  const walk = (node) => {
    for (const ch of node.children) {
      if (ch.namespaceURI === MC && ch.localName === 'Fallback') continue;
      if (ch.namespaceURI === W && ch.localName === 'p') walkPara(ch, paragraphs);
      else walk(ch);
    }
  };
  walk(doc.getElementsByTagNameNS(W, 'body')[0] || doc.documentElement);

  const out = [];
  for (const p of paragraphs) {
    if (!p) continue;
    const images = (await Promise.all(p.rids.map(loadImage))).filter(Boolean);
    if (p.text || images.length) out.push({ text: p.text, images });
  }
  const titleMatch = ((await text('docProps/core.xml')) || '').match(/<dc:title>([^<]*)<\/dc:title>/);
  return { paragraphs: out, title: titleMatch?.[1] || '', name: file.name };
}
