// ==========================================================
// api/notion.js — Vercel serverless function: ส่งข้อมูลจาก Planner ไป Notion (ทางเดียว)
//
// ตั้งค่าใน Vercel → Project → Settings → Environment Variables
//   NOTION_TOKEN         Internal Integration Secret จาก notion.so/my-integrations (อยู่บนเซิร์ฟเวอร์เท่านั้น)
//   NOTION_ACCESS_CODE   รหัสที่ตั้งเอง ใส่ในแอปให้ตรงกัน (ถ้าไม่ตั้ง จะใช้ AI_ACCESS_CODE แทน)
//
// actions: ping · setup (สร้างตารางในหน้าที่เลือก) · upsert (สร้าง/อัปเดตหน้า) · archive (ย้ายหน้าที่ลบในแอปไปถังขยะ)
// ==========================================================
const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const KINDS = ['portfolio', 'learnings', 'meetings', 'tasks'];
const MAX_ITEMS = 8;

// ---------------- เรียก Notion (เว้นจังหวะ ~3 ครั้ง/วินาที และรอเมื่อโดนจำกัด) ----------------
let last = 0;
async function notion(path, { method = 'GET', body } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = Math.max(0, last + 340 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after')) || 1 + attempt;
      await new Promise((r) => setTimeout(r, Math.min(ra, 5) * 1000));
      continue;
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(j.message || `Notion ตอบกลับ ${res.status}`);
      e.status = res.status;
      e.code = j.code;
      throw e;
    }
    return j;
  }
  const e = new Error('Notion ไม่ว่าง ลองใหม่อีกครั้ง');
  e.status = 429;
  throw e;
}

// ---------------- ตัวช่วยสร้างค่า ----------------
const chunks = (s, n = 1900) => {
  const t = String(s || '');
  const out = [];
  for (let i = 0; i < t.length; i += n) out.push(t.slice(i, i + n));
  return out;
};
const rich = (s, extra = {}) => chunks(s).slice(0, 50).map((c) => ({ type: 'text', text: { content: c }, ...extra }));
const linkText = (s, url) => [{ type: 'text', text: { content: String(s).slice(0, 1900), link: /^https?:\/\//.test(url) ? { url } : null } }];
const title = (s) => ({ title: rich(String(s || 'ไม่มีชื่อ').slice(0, 1900)) });
const text = (s) => ({ rich_text: s ? rich(s) : [] });
const select = (s) => ({ select: s ? { name: String(s).replace(/,/g, ' ').slice(0, 90) } : null });
const date = (start, end) => ({ date: start ? { start, end: end && end !== start ? end : null } : null });
const check = (b) => ({ checkbox: !!b });
const num = (n) => ({ number: Number.isFinite(n) ? n : null });
const url = (u) => ({ url: /^https?:\/\//.test(u || '') ? u : null });

const para = (s) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich(s) } });
const h3 = (s) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: rich(s) } });
const todo = (s, done) => ({ object: 'block', type: 'to_do', to_do: { rich_text: rich(s), checked: !!done } });
const bullet = (rt) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt } });
const callout = (s, emoji) => ({ object: 'block', type: 'callout', callout: { rich_text: rich(s), icon: { type: 'emoji', emoji } } });
const paras = (s) => String(s || '').split(/\n+/).filter((l) => l.trim()).map(para);

const opt = (name, color) => ({ name, color });

// ---------------- โครงสร้างตารางแต่ละแบบ ----------------
const SCHEMA = {
  portfolio: {
    title: 'แฟ้มผลงาน', emoji: '🏆',
    properties: {
      'ผลงาน': { title: {} },
      'ประเภท': { select: { options: [opt('คดี / การจับกุม', 'blue'), opt('รางวัล / คำชมเชย', 'yellow'), opt('หลักสูตร / อบรม', 'green'), opt('ภารกิจพิเศษ', 'red'), opt('โครงการ / งานริเริ่ม', 'purple'), opt('วิทยากร / ถ่ายทอดความรู้', 'pink'), opt('ตำแหน่ง / เลื่อนยศ / ย้าย', 'orange'), opt('อื่น ๆ', 'gray')] } },
      'วันที่': { date: {} },
      'บทบาท': { rich_text: {} },
      'หน่วยงาน': { rich_text: {} },
      'ตัวเลขผลงาน': { rich_text: {} },
      'ผลงานเด่น': { checkbox: {} },
      'Planner ID': { rich_text: {} },
    },
    props: (d) => ({
      'ผลงาน': title(d.title), 'ประเภท': select(d.typeLabel), 'วันที่': date(d.date, d.endDate), 'บทบาท': text(d.role),
      'หน่วยงาน': text(d.org), 'ตัวเลขผลงาน': text(d.figures), 'ผลงานเด่น': check(d.highlight),
    }),
    icon: (d) => d.emoji,
    body: (d) => [
      ...(d.result ? [h3('ผลการปฏิบัติ'), ...paras(d.result)] : []),
      ...(d.lesson ? [callout(d.lesson, '💡')] : []),
      ...((d.evidence || []).length ? [h3('หลักฐาน'), ...d.evidence.map((e) => bullet(linkText(e.name, e.link)))] : []),
    ],
  },
  learnings: {
    title: 'บันทึกการเรียนรู้', emoji: '💡',
    properties: {
      'เรื่อง': { title: {} },
      'หมวด': { select: { options: [opt('กฎหมาย & ระเบียบ', 'purple'), opt('งานสืบสวน & ปฏิบัติงาน', 'blue'), opt('คน & การสื่อสาร', 'pink'), opt('เทคโนโลยี & ทักษะ', 'green'), opt('สุขภาพ & ร่างกาย', 'green'), opt('การเงิน', 'yellow'), opt('ข้อคิด & ชีวิต', 'orange'), opt('ความรู้ทั่วไป', 'gray')] } },
      'วันที่': { date: {} },
      'Planner ID': { rich_text: {} },
    },
    props: (d) => ({ 'เรื่อง': title(d.text), 'หมวด': select(d.catLabel), 'วันที่': date(d.date) }),
    icon: (d) => d.emoji,
    body: (d) => (d.text.length > 120 ? paras(d.text) : []),
  },
  meetings: {
    title: 'บันทึกประชุม', emoji: '📝',
    properties: {
      'การประชุม': { title: {} },
      'วันที่': { date: {} },
      'สถานที่': { rich_text: {} },
      'ผู้เข้าร่วม': { rich_text: {} },
      'ลิงก์ประชุม': { url: {} },
      'สิ่งที่ต้องทำต่อ': { number: {} },
      'Planner ID': { rich_text: {} },
    },
    props: (d) => ({
      'การประชุม': title(d.title), 'วันที่': date(d.start, d.end), 'สถานที่': text(d.location),
      'ผู้เข้าร่วม': text((d.attendees || []).join(', ')), 'ลิงก์ประชุม': url(d.link), 'สิ่งที่ต้องทำต่อ': num((d.actions || []).length),
    }),
    icon: () => '👥',
    body: (d) => [
      ...((d.agenda || []).length ? [h3('วาระการประชุม'), ...d.agenda.map((a) => todo(a.text, a.done))] : []),
      ...(d.notes ? [h3('บันทึกการประชุม'), ...paras(d.notes)] : []),
      ...((d.actions || []).length ? [h3('สิ่งที่ต้องทำต่อ'), ...d.actions.map((a) => todo(`${a.title}${a.due ? ` (กำหนด ${a.due})` : ''}`, a.done))] : []),
    ],
  },
  tasks: {
    title: 'งาน (To-do)', emoji: '✅',
    properties: {
      'งาน': { title: {} },
      'เสร็จ': { checkbox: {} },
      'กำหนด': { date: {} },
      'ความสำคัญ': { select: { options: [opt('สูง', 'red'), opt('กลาง', 'yellow'), opt('ต่ำ', 'green')] } },
      'หมวด': { select: {} },
      'เกี่ยวข้องกับ': { rich_text: {} },
      'Planner ID': { rich_text: {} },
    },
    props: (d) => ({
      'งาน': title(d.title), 'เสร็จ': check(d.done), 'กำหนด': date(d.due), 'ความสำคัญ': select(d.priority),
      'หมวด': select(d.category), 'เกี่ยวข้องกับ': text(d.related),
    }),
    icon: () => null,
    body: (d) => paras(d.notes),
  },
};

// ---------------- งานแต่ละ action ----------------
const pageId = (s) => {
  const m = String(s || '').replace(/-/g, '').match(/([0-9a-f]{32})(?:\?|$|#)/i) || String(s || '').replace(/-/g, '').match(/([0-9a-f]{32})/i);
  return m ? m[1] : null;
};
const plainTitle = (p) => {
  const t = Object.values(p.properties || {}).find((x) => x.type === 'title');
  return (t?.title || []).map((r) => r.plain_text).join('') || 'หน้า Notion';
};

async function setup(body) {
  const id = pageId(body.page);
  if (!id) throw Object.assign(new Error('ลิงก์หน้า Notion ไม่ถูกต้อง'), { status: 400 });
  let page;
  try {
    page = await notion(`/pages/${id}`);
  } catch (e) {
    if (e.status === 404) throw Object.assign(new Error('เข้าหน้านี้ไม่ได้: เปิดหน้านี้ใน Notion → ⋯ → Connections → เพิ่ม Integration ของคุณก่อน'), { status: 404 });
    throw e;
  }
  const dbs = {};
  for (const kind of KINDS) {
    const have = body.dbs?.[kind];
    if (have) {
      try {
        const db = await notion(`/databases/${have}`);
        if (!db.archived) {
          dbs[kind] = db.id;
          continue;
        }
      } catch (_) {}
    }
    const s = SCHEMA[kind];
    const db = await notion('/databases', {
      method: 'POST',
      body: { parent: { type: 'page_id', page_id: page.id }, title: rich(s.title), icon: { type: 'emoji', emoji: s.emoji }, properties: s.properties },
    });
    dbs[kind] = db.id;
  }
  return { pageId: page.id, title: plainTitle(page), url: page.url, dbs };
}

async function findByPid(db, pid) {
  const r = await notion(`/databases/${db}/query`, {
    method: 'POST',
    body: { filter: { property: 'Planner ID', rich_text: { equals: pid } }, page_size: 1 },
  });
  return r.results?.[0] || null;
}

async function replaceBody(id, blocks) {
  let cursor;
  do {
    const r = await notion(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    for (const b of r.results || []) await notion(`/blocks/${b.id}`, { method: 'DELETE' });
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  for (let i = 0; i < blocks.length; i += 100) {
    await notion(`/blocks/${id}/children`, { method: 'PATCH', body: { children: blocks.slice(i, i + 100) } });
  }
}

async function upsertOne(kind, db, it) {
  const s = SCHEMA[kind];
  const properties = { ...s.props(it.data), 'Planner ID': text(it.pid) };
  const emoji = s.icon(it.data);
  const icon = emoji ? { type: 'emoji', emoji } : undefined;
  let id = it.notionId || null;
  if (id) {
    try {
      const p = await notion(`/pages/${id}`, { method: 'PATCH', body: { properties, ...(icon ? { icon } : {}) } });
      if (p.archived) id = null;
    } catch (e) {
      if (e.status === 404 || /archived/i.test(e.message)) id = null;
      else throw e;
    }
    if (id) {
      if (it.bodyChanged) await replaceBody(id, s.body(it.data));
      return { id, created: false };
    }
  }
  // ยังไม่มีในแอป: หาจาก Planner ID ก่อน (กันซ้ำเมื่อส่งจากหลายเครื่อง)
  const found = await findByPid(db, it.pid);
  if (found) {
    await notion(`/pages/${found.id}`, { method: 'PATCH', body: { properties, ...(icon ? { icon } : {}) } });
    await replaceBody(found.id, s.body(it.data));
    return { id: found.id, created: false };
  }
  const blocks = s.body(it.data);
  const p = await notion('/pages', {
    method: 'POST',
    body: { parent: { database_id: db }, properties, ...(icon ? { icon } : {}), children: blocks.slice(0, 100) },
  });
  for (let i = 100; i < blocks.length; i += 100) {
    await notion(`/blocks/${p.id}/children`, { method: 'PATCH', body: { children: blocks.slice(i, i + 100) } });
  }
  return { id: p.id, created: true };
}

async function upsert(body) {
  const { kind, db } = body;
  if (!KINDS.includes(kind) || !db) throw Object.assign(new Error('ข้อมูลไม่ครบ'), { status: 400 });
  const items = (body.items || []).slice(0, MAX_ITEMS);
  const results = [];
  for (const it of items) {
    if (!it?.pid || !it.data) continue;
    try {
      const r = await upsertOne(kind, db, it);
      results.push({ pid: it.pid, ok: true, ...r });
    } catch (e) {
      if (e.status === 401) throw e;
      if (e.status === 404 && /database/i.test(e.message)) throw Object.assign(new Error('ไม่พบตารางใน Notion กด "เชื่อมต่อ" ใหม่อีกครั้ง'), { status: 410 });
      results.push({ pid: it.pid, ok: false, error: e.message });
    }
  }
  return { results };
}

async function archive(body) {
  const { db } = body;
  if (!db) throw Object.assign(new Error('ข้อมูลไม่ครบ'), { status: 400 });
  let n = 0;
  for (const pid of (body.pids || []).slice(0, 20)) {
    const filter = pid.endsWith('*')
      ? { property: 'Planner ID', rich_text: { starts_with: pid.slice(0, -1) } }
      : { property: 'Planner ID', rich_text: { equals: pid } };
    const r = await notion(`/databases/${db}/query`, { method: 'POST', body: { filter, page_size: 20 } });
    for (const p of r.results || []) {
      await notion(`/pages/${p.id}`, { method: 'PATCH', body: { archived: true } });
      n++;
    }
  }
  return { archived: n };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const code = process.env.NOTION_ACCESS_CODE || process.env.AI_ACCESS_CODE;
  if (!process.env.NOTION_TOKEN || !code) {
    return res.status(501).json({ error: 'not_configured', message: 'ยังไม่ได้ตั้งค่า Notion บนเซิร์ฟเวอร์ (NOTION_TOKEN และ NOTION_ACCESS_CODE)' });
  }
  if (req.headers['x-planner-code'] !== code) {
    return res.status(401).json({ error: 'bad_code', message: 'รหัสใช้งานไม่ถูกต้อง' });
  }
  const body = typeof req.body === 'string' ? safeJSON(req.body) : req.body || {};
  try {
    if (body.action === 'ping') {
      await notion('/users/me');
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'setup') return res.status(200).json(await setup(body));
    if (body.action === 'upsert') return res.status(200).json(await upsert(body));
    if (body.action === 'archive') return res.status(200).json(await archive(body));
    return res.status(400).json({ error: 'bad_action', message: 'ไม่รู้จักคำสั่งนี้' });
  } catch (e) {
    if (e.status === 401 && e.code === 'unauthorized') {
      return res.status(500).json({ error: 'bad_token', message: 'NOTION_TOKEN บนเซิร์ฟเวอร์ไม่ถูกต้อง' });
    }
    const status = [400, 404, 410, 429].includes(e.status) ? e.status : 502;
    return res.status(status).json({ error: 'notion_error', message: e.message || 'Notion ขัดข้อง' });
  }
}

function safeJSON(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return {};
  }
}

export const _internal = { SCHEMA, pageId };
