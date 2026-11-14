// Pure logic for the Pomodoro tracker (no DOM). Focus and break phases are
// timed from timestamps, so a reload resumes exactly where it was; finished
// focus phases are counted per task and per day.

import {
  clampNumber, cleanString, isNonEmptyString, isObject, isTime, isTimeOrNull, oneOf,
} from '@sapphirelabs/ui/check';
import { newId } from '@sapphirelabs/ui/id';

export const PHASES = ['focus', 'short', 'long'] as const;
export type Phase = (typeof PHASES)[number];

export interface Settings {
  focusMin: number;
  shortMin: number;
  longMin: number;
  /** A long break after this many focus phases. */
  longEvery: number;
  /** Start the next phase by itself when one ends. */
  autoStart: boolean;
  sound: boolean;
  notify: boolean;
}

export interface Task { id: string; text: string; done: boolean; pomodoros: number }

export interface Timer {
  phase: Phase;
  durationMs: number;
  /** Time run so far, not counting the running stretch. */
  usedMs: number;
  /** When the current running stretch started; null while paused or not started. */
  runningSince: number | null;
}

export interface DayLog { date: string; focusCount: number; focusMs: number }

export interface Store {
  version: 1;
  settings: Settings;
  tasks: Task[];
  currentTaskId: string | null;
  timer: Timer;
  /** Focus phases finished since the last long break. */
  cycleCount: number;
  /** Most recent day first, at most HISTORY_DAYS days. */
  history: DayLog[];
}

export const TASK_MAX = 200;
export const HISTORY_DAYS = 14;
const MIN = 60_000;

export const defaultSettings = (): Settings => ({
  focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoStart: false, sound: true, notify: false,
});

export function phaseMs(settings: Settings, phase: Phase): number {
  return (phase === 'focus' ? settings.focusMin : phase === 'short' ? settings.shortMin : settings.longMin) * MIN;
}

export const newTimer = (settings: Settings, phase: Phase): Timer =>
  ({ phase, durationMs: phaseMs(settings, phase), usedMs: 0, runningSince: null });

export function createStore(): Store {
  const settings = defaultSettings();
  return { version: 1, settings, tasks: [], currentTaskId: null, timer: newTimer(settings, 'focus'), cycleCount: 0, history: [] };
}

// ───────────── Timer ─────────────

export const isRunning = (t: Timer) => t.runningSince !== null;
export const elapsed = (t: Timer, now: number) => t.usedMs + (t.runningSince === null ? 0 : Math.max(0, now - t.runningSince));
export const remaining = (t: Timer, now: number) => Math.max(0, t.durationMs - elapsed(t, now));
export const isFresh = (t: Timer) => t.usedMs === 0 && t.runningSince === null;

export function start(t: Timer, now: number): void {
  if (t.runningSince === null) t.runningSince = now;
}

export function pause(t: Timer, now: number): void {
  if (t.runningSince === null) return;
  t.usedMs = elapsed(t, now);
  t.runningSince = null;
}

/** Local calendar day of a timestamp, e.g. "2026-11-13". */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function logFocus(store: Store, ms: number, now: number): void {
  const date = dayKey(now);
  let day = store.history.find((d) => d.date === date);
  if (!day) {
    day = { date, focusCount: 0, focusMs: 0 };
    store.history.unshift(day);
  }
  day.focusCount += 1;
  day.focusMs += ms;
  store.history.sort((a, b) => b.date.localeCompare(a.date));
  store.history.length = Math.min(store.history.length, HISTORY_DAYS);
}

/** Which phase comes after the current one. */
export function nextPhase(store: Store): Phase {
  if (store.timer.phase !== 'focus') return 'focus';
  return (store.cycleCount + 1) % store.settings.longEvery === 0 ? 'long' : 'short';
}

/**
 * Finish the current phase (time ran out, or skipped). A focus phase that
 * ran to the end counts for today and for the current task. The next phase
 * starts running when autoStart is on (or `run` is passed).
 */
export function finishPhase(store: Store, now: number, opts: { counted: boolean; run?: boolean }): Phase {
  const { timer } = store;
  const following = nextPhase(store);
  if (timer.phase === 'focus') {
    if (opts.counted) {
      logFocus(store, timer.durationMs, now);
      const task = store.tasks.find((tk) => tk.id === store.currentTaskId);
      if (task) task.pomodoros += 1;
    }
    store.cycleCount += 1;
  } else if (timer.phase === 'long') {
    store.cycleCount = 0;
  }
  store.timer = newTimer(store.settings, following);
  if (opts.run ?? store.settings.autoStart) start(store.timer, now);
  return following;
}

/**
 * If the running phase has reached its end, finish it (counted). Returns the
 * phase that ended, or null. Uses the exact end time, so a phase that ended
 * while the tab slept is logged at the right moment.
 */
export function checkEnd(store: Store, now: number): Phase | null {
  const { timer } = store;
  if (!isRunning(timer) || remaining(timer, now) > 0) return null;
  const endedAt = timer.runningSince! + (timer.durationMs - timer.usedMs);
  const ended = timer.phase;
  finishPhase(store, endedAt, { counted: true });
  if (isRunning(store.timer)) store.timer.runningSince = endedAt;
  return ended;
}

/** Switch to a phase by hand (not counted), keeping it paused. */
export function switchPhase(store: Store, phase: Phase): void {
  store.timer = newTimer(store.settings, phase);
}

/** Apply new settings: a phase that has not started yet takes the new length. */
export function applySettings(store: Store, settings: Settings): void {
  store.settings = settings;
  if (isFresh(store.timer)) store.timer.durationMs = phaseMs(settings, store.timer.phase);
}

export function todayLog(store: Store, now: number): DayLog {
  return store.history.find((d) => d.date === dayKey(now)) ?? { date: dayKey(now), focusCount: 0, focusMs: 0 };
}

// ───────────── Reading saved data ─────────────

function parseSettings(x: unknown): Settings {
  const d = defaultSettings();
  if (!isObject(x)) return d;
  const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb);
  return {
    focusMin: Math.round(clampNumber(x.focusMin, 1, 180, d.focusMin)),
    shortMin: Math.round(clampNumber(x.shortMin, 1, 60, d.shortMin)),
    longMin: Math.round(clampNumber(x.longMin, 1, 120, d.longMin)),
    longEvery: Math.round(clampNumber(x.longEvery, 2, 12, d.longEvery)),
    autoStart: bool(x.autoStart, d.autoStart),
    sound: bool(x.sound, d.sound),
    notify: bool(x.notify, d.notify),
  };
}

function parseTask(x: unknown): Task | null {
  if (!isObject(x) || !isNonEmptyString(x.text)) return null;
  return {
    id: isNonEmptyString(x.id) ? x.id : newId(),
    text: cleanString(x.text, TASK_MAX),
    done: x.done === true,
    pomodoros: Math.round(clampNumber(x.pomodoros, 0, 10_000, 0)),
  };
}

function parseTimer(x: unknown, settings: Settings): Timer {
  if (!isObject(x)) return newTimer(settings, 'focus');
  const phase = oneOf(x.phase, PHASES, 'focus');
  if (!isTime(x.durationMs) || x.durationMs <= 0 || !isTime(x.usedMs) || !isTimeOrNull(x.runningSince)) return newTimer(settings, phase);
  return { phase, durationMs: x.durationMs, usedMs: Math.min(x.usedMs, x.durationMs), runningSince: x.runningSince };
}

function parseDay(x: unknown): DayLog | null {
  if (!isObject(x) || typeof x.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) return null;
  return { date: x.date, focusCount: Math.round(clampNumber(x.focusCount, 0, 1000, 0)), focusMs: clampNumber(x.focusMs, 0, 86_400_000, 0) };
}

/** Rebuild the store from whatever was saved; never throws. */
export function parseStore(raw: unknown): Store {
  if (!isObject(raw)) return createStore();
  const settings = parseSettings(raw.settings);
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(parseTask).filter((tk): tk is Task => tk !== null) : [];
  const history = Array.isArray(raw.history)
    ? raw.history.map(parseDay).filter((d): d is DayLog => d !== null).sort((a, b) => b.date.localeCompare(a.date)).slice(0, HISTORY_DAYS)
    : [];
  return {
    version: 1,
    settings,
    tasks,
    currentTaskId: tasks.some((tk) => tk.id === raw.currentTaskId) ? (raw.currentTaskId as string) : null,
    timer: parseTimer(raw.timer, settings),
    cycleCount: Math.round(clampNumber(raw.cycleCount, 0, 100, 0)),
    history,
  };
}
