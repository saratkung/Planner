// ==========================================================
// constants.js — categories, colors, priorities, repeat rules
// ==========================================================

export const CATEGORIES = [
  { id: 'work', label: 'งาน', emoji: '💼', color: '#6366f1' },
  { id: 'study', label: 'การเรียนรู้', emoji: '📚', color: '#0ea5e9' },
  { id: 'health', label: 'สุขภาพ', emoji: '💪', color: '#10b981' },
  { id: 'finance', label: 'การเงิน', emoji: '💰', color: '#f59e0b' },
  { id: 'personal', label: 'ส่วนตัว', emoji: '🌱', color: '#ec4899' },
];

export const category = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];

export const COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f59e0b', // amber
  '#10b981', // emerald
  '#0ea5e9', // sky
  '#64748b', // slate
];

export const PRIORITIES = [
  { id: 'low', label: 'ต่ำ', color: '#10b981', rank: 1 },
  { id: 'medium', label: 'กลาง', color: '#f59e0b', rank: 2 },
  { id: 'high', label: 'สูง', color: '#ef4444', rank: 3 },
];
export const priority = (id) => PRIORITIES.find((p) => p.id === id) || PRIORITIES[1];

export const REPEATS = [
  { id: 'none', label: 'ไม่ทำซ้ำ' },
  { id: 'daily', label: 'ทุกวัน' },
  { id: 'weekdays', label: 'วันจันทร์–ศุกร์' },
  { id: 'weekly', label: 'ทุกสัปดาห์' },
  { id: 'monthly', label: 'ทุกเดือน' },
];

export const QUOTES = [
  'เป้าหมายที่ไม่มีแผน เป็นเพียงความปรารถนา',
  'ก้าวเล็ก ๆ ทุกวัน พาไปสู่ความสำเร็จที่ยิ่งใหญ่',
  'ทำวันนี้ให้ดีที่สุด แล้วพรุ่งนี้จะดีขึ้นเอง',
  'วินัยคือสะพานเชื่อมระหว่างเป้าหมายกับความสำเร็จ',
  'อย่ารอให้พร้อม เริ่มจากตรงที่คุณอยู่',
  'โฟกัสทีละอย่าง แล้วทำให้เสร็จ',
  'ความสม่ำเสมอ ชนะความสมบูรณ์แบบ',
  'วางแผนเหมือนจะอยู่ตลอดไป ลงมือเหมือนมีแค่วันนี้',
  'งานใหญ่ที่สุด เริ่มต้นด้วยงานที่เล็กที่สุด',
  'พักได้ แต่อย่าหยุด',
];
