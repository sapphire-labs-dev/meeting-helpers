// Pure data + timing logic for the presentation timer (no DOM).
//
// A presentation has a total time and a list of topics. A topic can have its
// own minutes; topics without minutes share whatever is left of the total
// equally. Slides are independent of topics: they only carry private notes.

import {
  clampNumber, cleanString, isFiniteNumber, isNonEmptyString, isObject, isTime, isTimeOrNull,
} from '@sapphirelabs/ui/check';
import { newId } from '@sapphirelabs/ui/id';

export interface Topic {
  id: string;
  text: string;
  /** Planned minutes; null = share the time left in the total. */
  minutes: number | null;
}

export interface Deck {
  id: string;
  name: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  pages: number;
  totalMin: number;
  topics: Topic[];
  /** Private notes per slide, keyed by 1-based page number. */
  slideNotes: Record<number, string>;
  /** First text line of each slide, as a hint. Index 0 = slide 1. */
  titles: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Run {
  version: 2;
  deckId: string;
  page: number;
  paused: boolean;
  /** When the current running stretch started; null while paused or finished. */
  runningSince: number | null;
  startedAt: number;
  endedAt: number | null;
  /** Total time presented, not counting the running stretch. */
  usedMs: number;
  /** Current topic index (= topics.length once all are covered). */
  topicIdx: number;
  /** Time spent per topic id, not counting the running stretch. */
  topicUsed: Record<string, number>;
}

export function newDeck(fileId: string, fileName: string, fileSize: number, pages: number, titles: string[]): Deck {
  const now = Date.now();
  return {
    id: newId(),
    name: fileName.replace(/\.pdf$/i, '').slice(0, 80) || 'Deck',
    fileId, fileName, fileSize, pages,
    totalMin: 20,
    topics: [],
    slideNotes: {},
    titles,
    createdAt: now,
    updatedAt: now,
  };
}

// ───────────── Reading saved decks ─────────────

export const DECK_NAME_MAX = 80;
export const TOPIC_MAX = 200;
export const MINUTES_MAX = 600;

/** Split pasted or typed text into topic lines ("- ", "* " and "• " bullets removed). */
export const topicLines = (raw: string) =>
  raw.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).map((l) => l.slice(0, TOPIC_MAX));

function parseTopic(x: unknown): Topic | null {
  if (!isObject(x) || !isNonEmptyString(x.text)) return null;
  return {
    id: isNonEmptyString(x.id) ? x.id : newId(),
    text: cleanString(x.text, TOPIC_MAX),
    minutes: isFiniteNumber(x.minutes) ? clampNumber(x.minutes, 0, MINUTES_MAX, 0) : null,
  };
}

const parseTopics = (x: unknown): Topic[] =>
  Array.isArray(x) ? x.map(parseTopic).filter((tp): tp is Topic => tp !== null) : [];

const DEFAULT_PHASE_NAME = /^(Presentation|Apresentação|(Phase|Fase) \d+)?$/;

/**
 * Earlier versions grouped talking points into phases (first as plain text,
 * then as topics); now there is a single topic list, so phases are flattened
 * in order. A phase that had no topics but a custom name becomes a topic.
 */
function topicsFromPhases(phases: unknown): Topic[] {
  if (!Array.isArray(phases)) return [];
  const topics: Topic[] = [];
  for (const p of phases) {
    if (!isObject(p)) continue;
    let list = Array.isArray(p.topics)
      ? parseTopics(p.topics)
      : topicLines(typeof p.bullets === 'string' ? p.bullets : '').map((text) => ({ id: newId(), text, minutes: null }));
    const name = cleanString(p.name, TOPIC_MAX);
    if (!list.length && !DEFAULT_PHASE_NAME.test(name)) list = [{ id: newId(), text: name, minutes: null }];
    topics.push(...list);
  }
  return topics;
}

/** Rebuild a deck read from storage; null when it cannot be used (no id or file). */
export function parseDeck(x: unknown, now = Date.now()): Deck | null {
  if (!isObject(x) || !isNonEmptyString(x.id) || !isNonEmptyString(x.fileId)) return null;
  const pages = Math.round(clampNumber(x.pages, 1, 10_000, 1));
  const slideNotes: Record<number, string> = {};
  if (isObject(x.slideNotes)) {
    for (const [k, v] of Object.entries(x.slideNotes)) {
      const n = Number(k);
      if (/^\d+$/.test(k) && n >= 1 && n <= pages && isNonEmptyString(v)) slideNotes[n] = v;
    }
  }
  return {
    id: x.id,
    name: cleanString(x.name, DECK_NAME_MAX) || 'Deck',
    fileId: x.fileId,
    fileName: cleanString(x.fileName, 255),
    fileSize: clampNumber(x.fileSize, 0, Number.MAX_SAFE_INTEGER, 0),
    pages,
    totalMin: Math.round(clampNumber(x.totalMin, 1, MINUTES_MAX, 20)),
    topics: Array.isArray(x.topics) ? parseTopics(x.topics) : topicsFromPhases(x.phases),
    slideNotes,
    titles: Array.isArray(x.titles) ? x.titles.slice(0, pages).map((tt) => cleanString(tt, 80)) : [],
    createdAt: isTime(x.createdAt) ? x.createdAt : now,
    updatedAt: isTime(x.updatedAt) ? x.updatedAt : now,
  };
}

export const parseDecks = (raw: unknown): Deck[] =>
  Array.isArray(raw) ? raw.map((d) => parseDeck(d)).filter((d): d is Deck => d !== null) : [];

// ───────────── Plan ─────────────

export interface Plan {
  /** Planned time of each topic, in order. */
  topicMs: number[];
  /** Minutes explicitly set on topics. */
  fixedMin: number;
  /** Topics sharing the rest of the time. */
  autoCount: number;
  autoMs: number;
}

export function plan(deck: Deck): Plan {
  const fixedMin = deck.topics.reduce((s, tp) => s + (tp.minutes === null ? 0 : Math.max(0, tp.minutes)), 0);
  const autoCount = deck.topics.filter((tp) => tp.minutes === null).length;
  const autoMs = autoCount ? (Math.max(0, deck.totalMin - fixedMin) * 60000) / autoCount : 0;
  const topicMs = deck.topics.map((tp) => (tp.minutes === null ? autoMs : Math.max(0, tp.minutes) * 60000));
  return { topicMs, fixedMin, autoCount, autoMs };
}

export const totalMs = (deck: Deck) => deck.totalMin * 60000;

// ───────────── Run ─────────────

export function createRun(deck: Deck, now: number): Run {
  return {
    version: 2, deckId: deck.id, page: 1, paused: false, runningSince: now, startedAt: now, endedAt: null,
    usedMs: 0, topicIdx: 0, topicUsed: {},
  };
}

/** Checks a run read back from storage before resuming it. */
export function isValidRun(x: unknown): x is Run {
  return isObject(x) && x.version === 2 && isNonEmptyString(x.deckId)
    && Number.isInteger(x.page) && (x.page as number) >= 1
    && Number.isInteger(x.topicIdx) && (x.topicIdx as number) >= 0
    && typeof x.paused === 'boolean' && isTimeOrNull(x.runningSince)
    && isTime(x.startedAt) && isTimeOrNull(x.endedAt) && isTime(x.usedMs)
    && isObject(x.topicUsed) && Object.values(x.topicUsed).every(isTime);
}

const live = (run: Run, now: number) => (run.runningSince === null ? 0 : Math.max(0, now - run.runningSince));

export const totalUsed = (run: Run, now: number) => run.usedMs + live(run, now);

/** Index of the topic being covered; -1 when there are none left. */
export function topicIndex(deck: Deck, run: Run): number {
  const i = Math.max(0, run.topicIdx);
  return i < deck.topics.length ? i : -1;
}

export function topicUsed(deck: Deck, run: Run, i: number, now: number): number {
  const tp = deck.topics[i];
  if (!tp) return 0;
  return (run.topicUsed[tp.id] ?? 0) + (i === topicIndex(deck, run) ? live(run, now) : 0);
}

function commit(deck: Deck, run: Run, now: number): void {
  if (run.runningSince === null) return;
  const elapsed = live(run, now);
  run.usedMs += elapsed;
  const tp = deck.topics[topicIndex(deck, run)];
  if (tp) run.topicUsed[tp.id] = (run.topicUsed[tp.id] ?? 0) + elapsed;
  run.runningSince = now;
}

/** Slides do not affect timing; they only move. */
export function goTo(deck: Deck, run: Run, page: number): void {
  run.page = Math.min(Math.max(1, page), deck.pages);
}

/** Move to topic i (topics.length = all covered). */
export function setTopic(deck: Deck, run: Run, i: number, now: number): void {
  const target = Math.min(Math.max(0, i), deck.topics.length);
  if (target === Math.min(run.topicIdx, deck.topics.length)) return;
  commit(deck, run, now);
  run.topicIdx = target;
}

export function stepTopic(deck: Deck, run: Run, delta: number, now: number): void {
  setTopic(deck, run, Math.min(run.topicIdx, deck.topics.length) + delta, now);
}

export function togglePause(deck: Deck, run: Run, now: number): void {
  commit(deck, run, now);
  run.paused = !run.paused;
  run.runningSince = run.paused ? null : now;
}

export function finishRun(deck: Deck, run: Run, now: number): void {
  commit(deck, run, now);
  run.runningSince = null;
  run.paused = false;
  run.endedAt = now;
}

/**
 * How far behind (positive) or ahead (negative) of plan we are: covered
 * topics count their real difference, the current one only once it overruns.
 * Without topics, only overrunning the total counts.
 */
export function paceDelta(deck: Deck, run: Run, now: number): number {
  if (!deck.topics.length) return Math.max(0, totalUsed(run, now) - totalMs(deck));
  const { topicMs } = plan(deck);
  const cur = topicIndex(deck, run);
  const covered = cur === -1 ? deck.topics.length : cur;
  let delta = 0;
  for (let i = 0; i < covered; i++) delta += topicUsed(deck, run, i, now) - topicMs[i];
  if (cur !== -1) delta += Math.max(0, topicUsed(deck, run, cur, now) - topicMs[cur]);
  return delta;
}
