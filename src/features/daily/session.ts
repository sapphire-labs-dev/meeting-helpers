import { isObject, isTime, isTimeOrNull } from '@sapphirelabs/ui/check';
import { newId } from '@sapphirelabs/ui/id';

// Pure timer logic for a daily meeting. No DOM here: every function takes the
// current time explicitly so the session can be persisted and resumed from
// timestamps (a page reload never loses or invents time).

export type SpeakerStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface Speaker {
  id: string;
  name: string;
  kind: 'person' | 'buffer';
  status: SpeakerStatus;
  /** Time spoken so far, not counting the currently running stretch. */
  usedMs: number;
  /** Time slot for this speaker, fixed once they first take the floor. */
  slotMs: number | null;
}

export interface Session {
  version: 1;
  totalMs: number;
  bufferMs: number;
  adaptive: boolean;
  /** Slot used when adaptive time is off. */
  fixedSlotMs: number;
  speakers: Speaker[];
  /** Index of the speaker holding the floor, or -1 once the daily is over. */
  current: number;
  paused: boolean;
  /** When the current running stretch started; null while paused or finished. */
  runningSince: number | null;
  startedAt: number;
  endedAt: number | null;
}

export interface SessionOptions {
  totalMs: number;
  bufferMs: number;
  adaptive: boolean;
}


export function createSession(names: string[], opts: SessionOptions, now: number): Session {
  const bufferMs = Math.min(opts.bufferMs, opts.totalMs);
  const speakers: Speaker[] = names.map((name) => ({
    id: newId(), name, kind: 'person', status: 'pending', usedMs: 0, slotMs: null,
  }));
  if (bufferMs > 0) {
    speakers.push({ id: newId(), name: '', kind: 'buffer', status: 'pending', usedMs: 0, slotMs: null });
  }
  const s: Session = {
    version: 1,
    totalMs: opts.totalMs,
    bufferMs,
    adaptive: opts.adaptive,
    fixedSlotMs: names.length ? Math.floor((opts.totalMs - bufferMs) / names.length) : 0,
    speakers,
    current: -1,
    paused: false,
    runningSince: null,
    startedAt: now,
    endedAt: null,
  };
  const first = firstPending(s);
  if (first === -1) finish(s, now);
  else activate(s, first, now);
  return s;
}

export function elapsedOf(s: Session, i: number, now: number): number {
  const sp = s.speakers[i];
  const running = i === s.current && s.runningSince !== null ? now - s.runningSince : 0;
  return sp.usedMs + Math.max(0, running);
}

export function usedTotal(s: Session, now: number): number {
  return s.speakers.reduce((sum, _, i) => sum + elapsedOf(s, i, now), 0);
}

export function meetingLeft(s: Session, now: number): number {
  return s.totalMs - usedTotal(s, now);
}

const isOpen = (sp: Speaker) => sp.status === 'pending' || sp.status === 'active';

/** Slot a speaker gets (or would get if they started now). */
export function slotFor(s: Session, i: number, now: number): number {
  const sp = s.speakers[i];
  if (sp.slotMs !== null) return sp.slotMs;
  // Time already spoken by people who are done (or skipped after speaking).
  const closedUsed = s.speakers.reduce((sum, o, j) => (isOpen(o) ? sum : sum + elapsedOf(s, j, now)), 0);
  const waitingPeople = s.speakers.filter((o) => o.kind === 'person' && o.status === 'pending').length;
  if (sp.kind === 'buffer') {
    // While people are still waiting, show the reserved time; once it is the
    // buffer's turn it gets whatever is left of the meeting.
    return waitingPeople > 0 || s.speakers.some((o) => o.status === 'active' && o.kind === 'person')
      ? s.bufferMs
      : Math.max(0, s.totalMs - closedUsed);
  }
  if (!s.adaptive) return s.fixedSlotMs;
  // Whoever holds the floor keeps their slot (or what they used, if more).
  const activeIdx = s.speakers.findIndex((o, j) => o.status === 'active' && j !== i);
  const reserve = activeIdx === -1 ? 0 : Math.max(s.speakers[activeIdx].slotMs ?? 0, elapsedOf(s, activeIdx, now));
  const pool = s.totalMs - s.bufferMs - closedUsed - reserve;
  return Math.max(0, Math.floor(pool / Math.max(1, waitingPeople)));
}

function firstPending(s: Session): number {
  return s.speakers.findIndex((sp) => sp.status === 'pending');
}

/** Fold the running stretch into the current speaker's used time. */
function commit(s: Session, now: number): void {
  if (s.current >= 0 && s.runningSince !== null) {
    s.speakers[s.current].usedMs += Math.max(0, now - s.runningSince);
    s.runningSince = now;
  }
}

function activate(s: Session, i: number, now: number): void {
  const sp = s.speakers[i];
  if (sp.slotMs === null) sp.slotMs = slotFor(s, i, now);
  sp.status = 'active';
  s.current = i;
  s.runningSince = s.paused ? null : now;
}

function finish(s: Session, now: number): void {
  s.current = -1;
  s.runningSince = null;
  s.paused = false;
  s.endedAt = now;
}

function advance(s: Session, now: number): void {
  const nextIdx = firstPending(s);
  if (nextIdx === -1) finish(s, now);
  else activate(s, nextIdx, now);
}

export function next(s: Session, now: number): void {
  if (s.current < 0) return;
  commit(s, now);
  s.speakers[s.current].status = 'done';
  advance(s, now);
}

export function skipCurrent(s: Session, now: number): void {
  if (s.current < 0) return;
  commit(s, now);
  s.speakers[s.current].status = 'skipped';
  advance(s, now);
}

export function prev(s: Session, now: number): boolean {
  if (s.current < 0) return false;
  let target = -1;
  for (let i = s.current - 1; i >= 0; i--) {
    if (s.speakers[i].status === 'done') { target = i; break; }
  }
  if (target === -1) return false;
  commit(s, now);
  s.speakers[s.current].status = 'pending';
  activate(s, target, now);
  return true;
}

export function togglePause(s: Session, now: number): void {
  if (s.current < 0) return;
  commit(s, now);
  s.paused = !s.paused;
  s.runningSince = s.paused ? null : now;
}

export function addTime(s: Session, ms: number, now: number): void {
  if (s.current < 0) return;
  const sp = s.speakers[s.current];
  sp.slotMs = (sp.slotMs ?? slotFor(s, s.current, now)) + ms;
}

/** Mark a waiting person as absent, or put a skipped person back in the queue. */
export function toggleSkip(s: Session, i: number): void {
  const sp = s.speakers[i];
  if (!sp || i === s.current) return;
  if (sp.status === 'pending') sp.status = 'skipped';
  else if (sp.status === 'skipped') {
    sp.status = 'pending';
    // Move them right after whoever is speaking so they go next.
    s.speakers.splice(i, 1);
    const at = s.current >= 0 ? (i < s.current ? s.current : s.current + 1) : s.speakers.length;
    s.speakers.splice(at, 0, sp);
    if (i < s.current) s.current -= 1;
  }
}

export function addPerson(s: Session, name: string): void {
  const sp: Speaker = { id: newId(), name, kind: 'person', status: 'pending', usedMs: 0, slotMs: null };
  const bufferIdx = s.speakers.findIndex((o) => o.kind === 'buffer');
  if (bufferIdx === -1 || bufferIdx === s.current || s.speakers[bufferIdx].status !== 'pending') {
    s.speakers.push(sp);
  } else {
    s.speakers.splice(bufferIdx, 0, sp);
  }
}

export function endNow(s: Session, now: number): void {
  if (s.current < 0) return;
  commit(s, now);
  s.speakers[s.current].status = 'done';
  finish(s, now);
}

const STATUSES: readonly SpeakerStatus[] = ['pending', 'active', 'done', 'skipped'];

function isValidSpeaker(x: unknown): x is Speaker {
  return isObject(x) && typeof x.id === 'string' && typeof x.name === 'string'
    && (x.kind === 'person' || x.kind === 'buffer') && STATUSES.includes(x.status as SpeakerStatus)
    && isTime(x.usedMs) && isTimeOrNull(x.slotMs);
}

/** Checks a session read back from storage before resuming it. */
export function isValidSession(x: unknown): x is Session {
  if (!isObject(x) || x.version !== 1 || !Array.isArray(x.speakers) || !x.speakers.every(isValidSpeaker)) return false;
  const speakers = x.speakers as Speaker[];
  const current = x.current;
  const currentOk = current === -1
    || (Number.isInteger(current) && (current as number) >= 0 && (current as number) < speakers.length
      && speakers[current as number].status === 'active');
  return currentOk && isTime(x.totalMs) && isTime(x.bufferMs) && isTime(x.fixedSlotMs)
    && typeof x.adaptive === 'boolean' && typeof x.paused === 'boolean'
    && isTimeOrNull(x.runningSince) && isTime(x.startedAt) && isTimeOrNull(x.endedAt);
}
