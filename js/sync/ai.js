// ==========================================================
// ai.js — ส่งข้อความให้ Claude ช่วยอ่าน (ผ่าน /api/parse บน Vercel)
// เปิดใช้ได้ต่อเครื่อง; ข้อความจะถูกส่งออกไปประมวลผลนอกเครื่อง
// ==========================================================
import { store } from '../core/store.js';
import { todayKey, timeToMin, minToTime } from '../core/utils.js';

const cfg = () => store.state.settings.ai || {};
export const aiReady = () => !!(cfg().enabled && cfg().code);
export const setAI = (patch) => store.setSettings({ ai: { ...cfg(), ...patch } });

/** ส่งข้อความไปให้ AI อ่าน แล้วแปลงเป็นรูปแบบเดียวกับตัวอ่านในเครื่อง */
export async function aiParse(text, { code = cfg().code } = {}) {
  let res;
  try {
    res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-planner-code': code || '' },
      body: JSON.stringify({ text, today: todayKey() }),
    });
  } catch (_) {
    throw new Error('ติดต่อ AI ไม่ได้ (ตรวจสอบอินเทอร์เน็ต)');
  }
  const j = await res.json().catch(() => ({}));
  if (res.status === 404) throw new Error('เว็บนี้ยังไม่มีบริการ AI (ใช้ได้บน plannercsd.vercel.app)');
  if (!res.ok) throw new Error(j.message || `AI ขัดข้อง (${res.status})`);
  return (j.items || []).map((it) => toItem(it, text));
}

function toItem(it, original) {
  const warnings = [];
  const isTask = it.type === 'task';
  let date = /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : '';
  if (!date) {
    date = todayKey();
    warnings.push('ไม่พบวันที่ ใช้วันนี้แทน');
  }
  let start = /^\d{2}:\d{2}$/.test(it.start) ? it.start : '';
  let end = /^\d{2}:\d{2}$/.test(it.end) ? it.end : '';
  if (!isTask && !start) {
    start = '09:00';
    warnings.push('ไม่พบเวลา ตั้งเป็น 09:00');
  }
  if (!isTask && (!end || timeToMin(end) <= timeToMin(start))) end = minToTime(Math.min(timeToMin(start) + 60, 23 * 60 + 59));
  if (date < todayKey()) warnings.push('วันที่ผ่านไปแล้ว');
  return {
    type: it.type,
    title: it.title || (it.type === 'meeting' ? 'ประชุม' : it.type === 'task' ? 'งานใหม่' : 'นัดหมาย'),
    date,
    start: isTask ? start : start,
    end: isTask ? '' : end,
    location: it.location || '',
    link: it.link || '',
    attendees: it.attendees || [],
    agenda: it.agenda || [],
    priority: it.priority || 'medium',
    repeat: it.repeat || 'none',
    notes: [it.notes, original].filter(Boolean).join('\n\n').slice(0, 2000),
    found: { date: it.date || '', time: it.start ? `${it.start}${it.end ? ' – ' + it.end : ''}` : '', location: it.location || '', link: !!it.link },
    warnings,
    ai: true,
  };
}
