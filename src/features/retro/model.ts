// Pure logic for the retrospective board (no DOM). One person runs the board
// and shares the screen; the team sends their points in the call chat and the
// facilitator pastes them in. Boards are stored in this browser only.

import { clampNumber, cleanString, isNonEmptyString, isObject, isTime, oneOf } from '@sapphirelabs/ui/check';
import { newId } from '@sapphirelabs/ui/id';

/** Column sets; each column is shown with its translated title. */
export const TEMPLATES = {
  wwi: ['wentWell', 'toImprove'],
  ssc: ['start', 'stop', 'continue'],
  msg: ['mad', 'sad', 'glad'],
  '4l': ['liked', 'learned', 'lacked', 'longedFor'],
} as const;
export type TemplateId = keyof typeof TEMPLATES;
export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

export interface Card { id: string; text: string; votes: number }
export interface Column {
  id: string;
  /** Template column this came from; its title is translated from it. */
  kind: string;
  cards: Card[];
}
export interface Action { id: string; text: string; owner: string; done: boolean }
export interface Retro {
  id: string;
  name: string;
  template: TemplateId;
  columns: Column[];
  actions: Action[];
  createdAt: number;
  updatedAt: number;
}

export const NAME_MAX = 80;
export const CARD_MAX = 300;
export const OWNER_MAX = 40;
export const VOTES_MAX = 99;

export function newRetro(name: string, template: TemplateId, now: number): Retro {
  return {
    id: newId(),
    name: name.trim().slice(0, NAME_MAX),
    template,
    columns: TEMPLATES[template].map((kind) => ({ id: newId(), kind, cards: [] })),
    actions: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Split pasted chat text into cards: one per line, bullets and chat prefixes removed. */
export function cardLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
    .map((l) => l.slice(0, CARD_MAX));
}

export function addCards(col: Column, raw: string): number {
  const lines = cardLines(raw);
  col.cards.push(...lines.map((text) => ({ id: newId(), text, votes: 0 })));
  return lines.length;
}

export function vote(card: Card, delta: number): void {
  card.votes = Math.min(VOTES_MAX, Math.max(0, card.votes + delta));
}

/** Move a card to the column `delta` steps left (-1) or right (+1). */
export function moveCard(retro: Retro, cardId: string, delta: number): boolean {
  const from = retro.columns.findIndex((c) => c.cards.some((cd) => cd.id === cardId));
  const to = from + delta;
  if (from === -1 || to < 0 || to >= retro.columns.length) return false;
  const i = retro.columns[from].cards.findIndex((cd) => cd.id === cardId);
  const [card] = retro.columns[from].cards.splice(i, 1);
  retro.columns[to].cards.push(card);
  return true;
}

export function findCard(retro: Retro, cardId: string): { col: Column; card: Card; index: number } | null {
  for (const col of retro.columns) {
    const index = col.cards.findIndex((cd) => cd.id === cardId);
    if (index !== -1) return { col, card: col.cards[index], index };
  }
  return null;
}

/** Cards in display order: as added, or most voted first (stable). */
export function orderedCards(col: Column, byVotes: boolean): Card[] {
  return byVotes ? [...col.cards].sort((a, b) => b.votes - a.votes) : col.cards;
}

export const cardCount = (retro: Retro) => retro.columns.reduce((n, c) => n + c.cards.length, 0);

/**
 * The board as Markdown, to paste in a wiki, ticket or chat. `title(col)`
 * gives the column heading in the current language.
 */
export function toMarkdown(
  retro: Retro,
  labels: { title: (col: Column) => string; actions: string; owner: string; date: string; votes: (n: number) => string },
): string {
  const esc = (s: string) => s.replace(/([\\`*_[\]#|])/g, '\\$1');
  const lines = [`# ${esc(retro.name)}`, '', `_${labels.date}_`, ''];
  for (const col of retro.columns) {
    lines.push(`## ${esc(labels.title(col))}`, '');
    const cards = orderedCards(col, true);
    if (!cards.length) lines.push('- —');
    for (const cd of cards) lines.push(`- ${esc(cd.text)}${cd.votes ? ` (${labels.votes(cd.votes)})` : ''}`);
    lines.push('');
  }
  lines.push(`## ${esc(labels.actions)}`, '');
  if (!retro.actions.length) lines.push('- —');
  for (const a of retro.actions) {
    lines.push(`- [${a.done ? 'x' : ' '}] ${esc(a.text)}${a.owner ? ` — ${labels.owner}: ${esc(a.owner)}` : ''}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

// ───────────── Reading saved data ─────────────

function parseCard(x: unknown): Card | null {
  if (!isObject(x) || !isNonEmptyString(x.text)) return null;
  return { id: isNonEmptyString(x.id) ? x.id : newId(), text: cleanString(x.text, CARD_MAX), votes: Math.round(clampNumber(x.votes, 0, VOTES_MAX, 0)) };
}

function parseColumn(x: unknown): Column | null {
  if (!isObject(x)) return null;
  return {
    id: isNonEmptyString(x.id) ? x.id : newId(),
    kind: cleanString(x.kind, 40),
    cards: Array.isArray(x.cards) ? x.cards.map(parseCard).filter((c): c is Card => c !== null) : [],
  };
}

function parseAction(x: unknown): Action | null {
  if (!isObject(x) || !isNonEmptyString(x.text)) return null;
  return {
    id: isNonEmptyString(x.id) ? x.id : newId(),
    text: cleanString(x.text, CARD_MAX),
    owner: cleanString(x.owner, OWNER_MAX),
    done: x.done === true,
  };
}

export function parseRetro(x: unknown, now = Date.now()): Retro | null {
  if (!isObject(x) || !isNonEmptyString(x.id)) return null;
  const columns = Array.isArray(x.columns) ? x.columns.map(parseColumn).filter((c): c is Column => c !== null) : [];
  if (!columns.length) return null;
  return {
    id: x.id,
    name: cleanString(x.name, NAME_MAX),
    template: oneOf(x.template, TEMPLATE_IDS, 'wwi'),
    columns,
    actions: Array.isArray(x.actions) ? x.actions.map(parseAction).filter((a): a is Action => a !== null) : [],
    createdAt: isTime(x.createdAt) ? x.createdAt : now,
    updatedAt: isTime(x.updatedAt) ? x.updatedAt : now,
  };
}

export const parseRetros = (raw: unknown): Retro[] =>
  Array.isArray(raw) ? raw.map((r) => parseRetro(r)).filter((r): r is Retro => r !== null) : [];
