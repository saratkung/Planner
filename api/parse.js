// ==========================================================
// api/parse.js — Vercel serverless function: ให้ Claude อ่านข้อความแล้วแยกเป็น ประชุม / นัดหมาย / งาน
//   (mode: 'learn' = แยกบันทึกการเรียนรู้เป็นข้อ ๆ พร้อมหมวด)
//
// ตั้งค่าใน Vercel → Project → Settings → Environment Variables
//   ANTHROPIC_API_KEY  คีย์จาก console.anthropic.com (อยู่บนเซิร์ฟเวอร์เท่านั้น ไม่ส่งไปที่แอป)
//   AI_ACCESS_CODE     รหัสที่ตั้งเอง ใส่ในแอปให้ตรงกัน (กันคนอื่นใช้คีย์ของคุณ)
// ==========================================================
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const MAX_CHARS = 8000;

const Item = z.object({
  type: z.enum(['meeting', 'event', 'task']),
  title: z.string(),
  date: z.string(), // YYYY-MM-DD หรือ "" ถ้าไม่ระบุ
  start: z.string(), // HH:MM หรือ ""
  end: z.string(), // HH:MM หรือ ""
  location: z.string(),
  link: z.string(),
  attendees: z.array(z.string()),
  agenda: z.array(z.string()),
  priority: z.enum(['low', 'medium', 'high']),
  repeat: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly']),
  notes: z.string(),
});
const Result = z.object({ items: z.array(Item) });

// โหมด "วันนี้เรียนรู้อะไร": แยกเป็นข้อ ๆ แล้วจัดหมวด
const LEARN_CATS = ['law', 'work', 'people', 'tech', 'health', 'finance', 'life', 'general'];
const LearnResult = z.object({
  points: z.array(z.object({ text: z.string(), category: z.enum(LEARN_CATS) })),
});
const LEARN_SYSTEM = `You help a Thai police officer (investigation bureau) keep a daily journal of what they learned today.

Split the user's note into separate learning points, in the order they appear. Each point is one lesson, fact, skill or insight. Do not invent points that are not in the note, and drop chit-chat that teaches nothing.

For each point:
- text: one clear Thai sentence (at most about 120 characters) that keeps the original meaning, names, numbers and law sections. Write it as a note to self, without "วันนี้ได้เรียนรู้ว่า" in front. Keep the user's wording where it is already clear.
- category, one of:
  - "law": laws, regulations, legal procedure, court rulings, legal powers, orders
  - "work": investigation, police operations, cases, evidence, office work, meetings and procedures at work
  - "people": communication, leadership, teamwork, managing subordinates or bosses, family and friends
  - "tech": technology, apps, computers, cyber crime techniques, data tools, practical skills, languages
  - "health": exercise, sleep, food, stress, the body
  - "finance": money, saving, investing, tax, debt
  - "life": personal reflections, attitude, values, life lessons
  - "general": general knowledge that fits nothing above (books, history, science)`;

const SYSTEM = `You turn messages pasted by a Thai police officer (official meeting invitations, LINE chats, emails) into calendar items for a personal planner app.

Return every distinct appointment, meeting or task in the text, in the order they appear. Do not invent items or details that are not in the text.

Field rules:
- type: "meeting" for meetings, briefings, seminars, trainings, online calls; "event" for other appointments with a time; "task" for things to do or submit by a date (deadlines, reports, reminders).
- title: short Thai title as the user would write it, without dates, times, places, polite particles or words like "ขอเชิญ".
- date: YYYY-MM-DD in the Gregorian calendar. Convert Buddhist Era years (e.g. 2569 = 2026, "69" = 2026). Resolve relative dates ("พรุ่งนี้", "ศุกร์นี้", "วันจันทร์หน้า", "วันที่ 20 นี้") from the current date given by the user. Empty string if no date is given.
- start / end: 24-hour HH:MM. "บ่ายสอง" = 14:00, "4 โมงเย็น" = 16:00, "2 ทุ่ม" = 20:00, "9 โมง" = 09:00, "13.30 น." = 13:30. Empty string if no time. If only a start time is given, leave end empty.
- A reply-by or RSVP date ("กรุณาตอบรับภายใน...") is not the meeting date.
- location, link (a meeting URL such as Zoom/Meet/Teams), attendees (names or positions), agenda (agenda items): copy from the text, empty if absent.
- priority: "high" for urgent wording (ด่วน, ด่วนที่สุด), otherwise "medium".
- repeat: "daily", "weekdays" (Mon-Fri / ทุกวันทำงาน), "weekly" (ทุกสัปดาห์ / ทุกวันศุกร์), "monthly" (ทุกเดือน), otherwise "none".
- notes: other useful details from the text (dress code, documents to bring, contact), short; empty if none.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const code = process.env.AI_ACCESS_CODE;
  if (!process.env.ANTHROPIC_API_KEY || !code) {
    return res.status(501).json({ error: 'not_configured', message: 'ยังไม่ได้ตั้งค่า AI บนเซิร์ฟเวอร์ (ANTHROPIC_API_KEY / AI_ACCESS_CODE)' });
  }
  if (req.headers['x-planner-code'] !== code) {
    return res.status(401).json({ error: 'bad_code', message: 'รหัสใช้งาน AI ไม่ถูกต้อง' });
  }
  const body = typeof req.body === 'string' ? safeJSON(req.body) : req.body || {};
  const text = String(body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty', message: 'ไม่มีข้อความ' });
  if (text.length > MAX_CHARS) {
    return res.status(413).json({ error: 'too_long', message: `ข้อความยาวเกิน ${MAX_CHARS} ตัวอักษร ลองแบ่งวางทีละส่วน` });
  }
  const mode = body.mode === 'learn' ? 'learn' : 'items';
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || '') ? body.today : new Date().toISOString().slice(0, 10);
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${today}T12:00:00Z`).getUTCDay()];

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(mode === 'learn' ? LearnResult : Result) },
      system: mode === 'learn' ? LEARN_SYSTEM : SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            mode === 'learn'
              ? `<note>\n${text}\n</note>`
              : `Current date: ${today} (${weekday}), time zone Asia/Bangkok.\n\n<message>\n${text}\n</message>`,
        },
      ],
    });
    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'refusal', message: 'AI ไม่สามารถอ่านข้อความนี้ได้ ลองใช้การอ่านแบบปกติ' });
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      return res.status(502).json({ error: 'incomplete', message: 'AI ตอบไม่ครบ ลองแบ่งข้อความให้สั้นลง' });
    }
    if (mode === 'learn') return res.status(200).json({ points: response.parsed_output.points, model: response.model });
    return res.status(200).json({ items: response.parsed_output.items, model: response.model });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: 'bad_api_key', message: 'ANTHROPIC_API_KEY บนเซิร์ฟเวอร์ไม่ถูกต้อง' });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'rate_limited', message: 'ใช้ AI ถี่เกินไป รอสักครู่แล้วลองใหม่' });
    }
    if (error instanceof Anthropic.APIError) {
      return res.status(502).json({ error: 'api_error', message: `AI ขัดข้อง (${error.status ?? 'network'})` });
    }
    return res.status(500).json({ error: 'server_error', message: 'เกิดข้อผิดพลาดบนเซิร์ฟเวอร์' });
  }
}

function safeJSON(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return {};
  }
}
