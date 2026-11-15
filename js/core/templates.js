// ==========================================================
// templates.js — แม่แบบการประชุม (มีให้ในแอป + ที่ผู้ใช้บันทึกเอง)
// ==========================================================
import { store } from './store.js';
import { timeToMin } from './utils.js';

export const BUILTIN_TEMPLATES = [
  {
    id: 'tpl-brief', builtin: true, emoji: '☀️', name: 'บรีฟเช้า / Stand-up', title: 'บรีฟเช้า',
    minutes: 15, repeat: 'weekdays',
    agenda: ['เมื่อวานทำอะไรไป', 'วันนี้จะทำอะไร', 'ติดปัญหาหรือต้องการความช่วยเหลืออะไร'],
  },
  {
    id: 'tpl-weekly', builtin: true, emoji: '🗓️', name: 'ประชุมประจำสัปดาห์', title: 'ประชุมประจำสัปดาห์',
    minutes: 60, repeat: 'weekly',
    agenda: ['ติดตามงานจากสัปดาห์ที่แล้ว', 'งานและเป้าหมายสัปดาห์นี้', 'ปัญหาและอุปสรรค', 'เรื่องอื่น ๆ'],
  },
  {
    id: 'tpl-case', builtin: true, emoji: '🔎', name: 'ประชุมติดตามคดี', title: 'ประชุมติดตามคดี',
    minutes: 90, repeat: 'none',
    agenda: ['สรุปข้อเท็จจริงของคดี', 'ความคืบหน้าการสืบสวน', 'พยานหลักฐานที่ได้มา / ที่ยังขาด', 'แผนการปฏิบัติขั้นต่อไป', 'ผู้รับผิดชอบและกำหนดเวลา'],
  },
  {
    id: 'tpl-ops', builtin: true, emoji: '🧭', name: 'วางแผนปฏิบัติการ', title: 'ประชุมวางแผนปฏิบัติการ',
    minutes: 60, repeat: 'none',
    agenda: ['เป้าหมายของภารกิจ', 'กำลังพลและอุปกรณ์', 'จุดนัดพบ / เส้นทาง / เวลา', 'การติดต่อสื่อสาร', 'ความปลอดภัยและแผนสำรอง'],
  },
  {
    id: 'tpl-1on1', builtin: true, emoji: '🤝', name: '1:1 กับผู้บังคับบัญชา', title: '1:1 กับผู้บังคับบัญชา',
    minutes: 30, repeat: 'none',
    agenda: ['อัปเดตงานที่รับผิดชอบ', 'เรื่องที่ต้องการคำแนะนำ / การตัดสินใจ', 'เป้าหมายและการพัฒนาตนเอง'],
  },
  {
    id: 'tpl-aar', builtin: true, emoji: '📊', name: 'สรุปผลหลังปฏิบัติ (AAR)', title: 'ประชุมสรุปผลการปฏิบัติ',
    minutes: 45, repeat: 'none',
    agenda: ['สิ่งที่วางแผนไว้', 'สิ่งที่เกิดขึ้นจริง', 'สิ่งที่ทำได้ดี', 'สิ่งที่ต้องปรับปรุงครั้งหน้า'],
  },
];

export const allTemplates = () => [...BUILTIN_TEMPLATES, ...(store.state.templates || [])];

/** บันทึกการประชุมนี้เป็นแม่แบบ (ชื่อ วาระ ระยะเวลา สถานที่ ลิงก์ ผู้เข้าร่วม การทำซ้ำ) */
export function saveTemplateFromEvent(ev, name) {
  const minutes = Math.max(15, timeToMin(ev.end) - timeToMin(ev.start)) || 60;
  return store.add('templates', {
    emoji: '⭐', name: (name || ev.title).slice(0, 60), title: ev.title,
    minutes, repeat: ev.repeat || 'none', agenda: [...(ev.agenda || [])],
    location: ev.location || '', link: ev.link || '', attendees: [...(ev.attendees || [])],
  });
}

export function deleteTemplate(id) {
  return store.remove('templates', id);
}
