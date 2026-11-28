// ==========================================================
// docxWriter.js — สร้างไฟล์ Word (.docx) ในเบราว์เซอร์ ไม่ใช้ไลบรารีภายนอก
// รองรับ: ย่อหน้า (ชิดซ้าย/กลาง/ขวา, ตัวหนา, เยื้อง), รูปในบรรทัด, ตารางไม่มีเส้น, ขึ้นหน้าใหม่
// ==========================================================

// ---------------- ZIP (ไม่บีบอัด) ----------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const enc = new TextEncoder();

/** files: [{ name, data: string | Uint8Array }] → Blob (.zip) */
export function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // ชื่อไฟล์ UTF-8
    local.setUint16(8, 0, true); // ไม่บีบอัด
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ---------------- เนื้อหาเอกสาร ----------------
export const x = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
export const CM = 567; // twips ต่อ 1 ซม.
export const EMU_CM = 360000;
const SYMBOL = /[☐☑☒✓✔]/;

/** run ของข้อความ: { text, bold, size (pt), font } */
function run(r, base) {
  const parts = String(r.text ?? '').split(/(\n|\t|[☐☑☒✓✔])/);
  const rPr = (sym) => {
    const font = sym ? 'Segoe UI Symbol' : r.font || base.font;
    const size = Math.round((r.size || base.size) * 2);
    return `<w:rPr><w:rFonts w:ascii="${x(font)}" w:hAnsi="${x(font)}" w:cs="${x(font)}" w:eastAsia="${x(font)}"/>${r.bold ? '<w:b/><w:bCs/>' : ''}${r.underline ? '<w:u w:val="single"/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  };
  return parts
    .filter((p) => p !== '')
    .map((p) => {
      if (p === '\n') return `<w:r>${rPr(false)}<w:br/></w:r>`;
      if (p === '\t') return `<w:r>${rPr(false)}<w:tab/></w:r>`;
      const sym = SYMBOL.test(p);
      return `<w:r>${rPr(sym)}<w:t xml:space="preserve">${x(p)}</w:t></w:r>`;
    })
    .join('');
}

/**
 * ย่อหน้า: { runs | text, align, bold, indent: { left, hanging, firstLine } (ซม.), before, after (pt), keepNext, pageBreakBefore, images: [ref] }
 */
export function paragraph(p, base) {
  const runs = p.runs || [{ text: p.text || '', bold: p.bold, size: p.size }];
  const ind = p.indent
    ? `<w:ind${p.indent.left != null ? ` w:left="${Math.round(p.indent.left * CM)}"` : ''}${p.indent.hanging != null ? ` w:hanging="${Math.round(p.indent.hanging * CM)}"` : ''}${p.indent.firstLine != null ? ` w:firstLine="${Math.round(p.indent.firstLine * CM)}"` : ''}/>`
    : '';
  const pPr = `<w:pPr>${p.keepNext ? '<w:keepNext/>' : ''}${p.pageBreakBefore ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="${Math.round((p.before || 0) * 20)}" w:after="${Math.round((p.after || 0) * 20)}" w:line="240" w:lineRule="auto"/>${ind}${p.align ? `<w:jc w:val="${p.align === 'justify' ? 'both' : p.align}"/>` : ''}</w:pPr>`;
  const imgs = (p.images || []).map((im, i) => (i ? run({ text: '  ' }, base) : '') + inlineImage(im)).join('');
  return `<w:p>${pPr}${runs.map((r) => run({ ...r, bold: r.bold ?? p.bold, size: r.size || p.size }, base)).join('')}${imgs}</w:p>`;
}

function inlineImage(im) {
  const cx = Math.round(im.wCm * EMU_CM);
  const cy = Math.round(im.hCm * EMU_CM);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${im.n}" name="รูป ${im.n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${im.n}" name="${x(im.file)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${im.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/** ตารางไม่มีเส้น: { widths: [ซม.], rows: [[cell: { paragraphs: [p], vAlign }]] } */
export function table(t, base) {
  const grid = t.widths.map((w) => `<w:gridCol w:w="${Math.round(w * CM)}"/>`).join('');
  const rows = t.rows
    .map(
      (r) =>
        `<w:tr>${r
          .map(
            (c, i) =>
              `<w:tc><w:tcPr><w:tcW w:w="${Math.round(t.widths[i] * CM)}" w:type="dxa"/>${c.vAlign ? `<w:vAlign w:val="${c.vAlign}"/>` : ''}</w:tcPr>${(c.paragraphs.length ? c.paragraphs : [{ text: '' }]).map((p) => paragraph(p, base)).join('')}</w:tc>`,
          )
          .join('')}</w:tr>`,
    )
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${Math.round(t.widths.reduce((a, b) => a + b, 0) * CM)}" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
}

/**
 * สร้างเอกสาร
 * opts: { blocks: [{ type: 'p' | 'table', ... }], images: [{ data: Uint8Array, ext }],
 *         font, size (pt), margins: { top, right, bottom, left } (ซม.), title, author }
 */
export function buildDocx({ blocks, images = [], font = 'TH SarabunIT๙', size = 16, margins = { top: 1.25, right: 1.75, bottom: 1.5, left: 3 }, title = '', author = '' }) {
  const base = { font, size };
  const body = blocks.map((b) => (b.type === 'table' ? table(b, base) : paragraph(b, base))).join('');
  const sect = `<w:sectPr><w:pgSz w:w="11906" w:h="16838" w:code="9"/><w:pgMar w:top="${Math.round(margins.top * CM)}" w:right="${Math.round(margins.right * CM)}" w:bottom="${Math.round(margins.bottom * CM)}" w:left="${Math.round(margins.left * CM)}" w:header="709" w:footer="709" w:gutter="0"/><w:cols w:space="708"/></w:sectPr>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}${sect}</w:body></w:document>`;
  const fontAttrs = `w:ascii="${x(font)}" w:hAnsi="${x(font)}" w:cs="${x(font)}" w:eastAsia="${x(font)}"`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts ${fontAttrs}/><w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/><w:lang w:val="th-TH" w:eastAsia="en-US" w:bidi="th-TH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts ${fontAttrs}/><w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/></w:rPr></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
  const rels = images.map((im, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.${im.ext}"/>`).join('');
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels}</Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>${x(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const pkgRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  return zip([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: pkgRels },
    { name: 'docProps/core.xml', data: core },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    ...images.map((im, i) => ({ name: `word/media/image${i + 1}.${im.ext}`, data: im.data })),
  ]);
}

/** เตรียมรูปสำหรับใส่ในเอกสาร: ย่อให้ด้านยาวไม่เกิน max px → { data, ext, w, h } */
export async function prepareImage(blob, max = 1400) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  return { data: new Uint8Array(await out.arrayBuffer()), ext: 'jpeg', w: c.width, h: c.height };
}
