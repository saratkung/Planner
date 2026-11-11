// ==========================================================
// selectors.js — derived data (recurring events, progress, stats)
// ==========================================================
import { store } from './store.js';
import { fromKey, toKey, todayKey, diffDays, addDays, timeToMin } from './utils.js';
import { priority } from './constants.js';

/** Does a (possibly recurring) event happen on dateKey? */
export function occursOn(ev, key) {
  if (key < ev.date) return false;
  if (ev.until && key > ev.until) return false;
  if (key === ev.date) return true;
  const d = fromKey(key);
  const s = fromKey(ev.date);
  switch (ev.repeat) {
    case 'daily':
      return true;
    case 'weekdays':
      return d.getDay() >= 1 && d.getDay() <= 5;
    case 'weekly':
      return d.getDay() === s.getDay();
    case 'monthly':
      return d.getDate() === s.getDate();
    default:
      return false;
  }
}

/** Events on a given date (with recurrence), sorted by start time. */
export function eventsOn(key) {
  return store.state.events
    .filter((e) => occursOn(e, key))
    .map((e) => ({ ...e, occurrence: key }))
    .sort((a, b) => timeToMin(a.start) - timeToMin(b.start));
}

export function tasksDue(key) {
  return store.state.tasks.filter((t) => t.due === key);
}

export function isOverdue(t) {
  return !t.done && t.due && t.due < todayKey();
}

export function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if ((a.due || '9') !== (b.due || '9')) return (a.due || '9999') < (b.due || '9999') ? -1 : 1;
    const pr = priority(b.priority).rank - priority(a.priority).rank;
    if (pr) return pr;
    return (a.time || '99') < (b.time || '99') ? -1 : 1;
  });
}

/** Goal progress = (done milestones + done linked tasks) / total */
export function goalProgress(goal) {
  const linked = store.state.tasks.filter((t) => t.goalId === goal.id);
  const total = goal.milestones.length + linked.length;
  const done = goal.milestones.filter((m) => m.done).length + linked.filter((t) => t.done).length;
  return {
    total,
    done,
    linked,
    pct: total ? Math.round((done / total) * 100) : 0,
  };
}

export function daysLeft(deadline) {
  return deadline ? diffDays(todayKey(), deadline) : null;
}

/** Tasks completed per day for the last n days (oldest first). */
export function completionHistory(n = 7) {
  const today = new Date();
  const days = Array.from({ length: n }, (_, i) => toKey(addDays(today, i - n + 1)));
  const counts = Object.fromEntries(days.map((k) => [k, 0]));
  store.state.tasks.forEach((t) => {
    if (!t.done || !t.doneAt) return;
    const k = toKey(new Date(t.doneAt));
    if (k in counts) counts[k]++;
  });
  return days.map((k) => ({ key: k, count: counts[k] }));
}

/** consecutive days (ending today or yesterday) with ≥1 completed task */
export function streak() {
  const doneDays = new Set(
    store.state.tasks.filter((t) => t.done && t.doneAt).map((t) => toKey(new Date(t.doneAt))),
  );
  let d = new Date();
  if (!doneDays.has(toKey(d))) d = addDays(d, -1);
  let n = 0;
  while (doneDays.has(toKey(d))) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function overdueCount() {
  return store.state.tasks.filter(isOverdue).length;
}

/**
 * Lay out overlapping events into side-by-side lanes.
 * returns [{ev, lane, lanes}]
 */
export function layoutDay(events) {
  const items = events
    .map((ev) => ({ ev, s: timeToMin(ev.start), e: Math.max(timeToMin(ev.end), timeToMin(ev.start) + 20) }))
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanesEnd = [];
    cluster.forEach((it) => {
      let lane = lanesEnd.findIndex((end) => end <= it.s);
      if (lane < 0) lane = lanesEnd.length;
      lanesEnd[lane] = it.e;
      it.lane = lane;
    });
    cluster.forEach((it) => out.push({ ...it, lanes: lanesEnd.length }));
    cluster = [];
  };
  items.forEach((it) => {
    if (it.s >= clusterEnd && cluster.length) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  });
  if (cluster.length) flush();
  return out;
}

// ---------------- meetings ----------------

/** All meeting occurrences from startKey to endKey (inclusive), oldest first. */
export function meetingsBetween(startKey, endKey) {
  const out = [];
  let d = fromKey(startKey);
  const end = fromKey(endKey);
  while (d <= end) {
    const k = toKey(d);
    eventsOn(k).forEach((e) => e.isMeeting && out.push(e));
    d = addDays(d, 1);
  }
  return out;
}

/** 'upcoming' | 'live' | 'past' for an occurrence. */
export function meetingStatus(m) {
  const today = todayKey();
  if (m.occurrence < today) return 'past';
  if (m.occurrence > today) return 'upcoming';
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  if (now < timeToMin(m.start)) return 'upcoming';
  if (now < timeToMin(m.end)) return 'live';
  return 'past';
}

/** Minutes until the meeting starts (negative if started). */
export function minutesUntil(m) {
  const start = fromKey(m.occurrence);
  start.setMinutes(timeToMin(m.start));
  return Math.round((start - Date.now()) / 60000);
}

export function minutesOf(ev, key) {
  return ev.minutes?.[key] || { notes: '', agendaDone: [] };
}

/** Action items (tasks) created in a meeting occurrence. */
export function actionItems(eventId, key) {
  return store.state.tasks.filter((t) => t.meetingId === eventId && (!key || t.meetingDate === key));
}
