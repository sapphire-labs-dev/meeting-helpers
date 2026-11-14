// State shared by the views of the presentation page, which view is shown,
// and the routes between views (wired up in present.ts so views do not import
// each other).

import { $ } from '@sapphirelabs/ui/dom';
import { getLang } from '../../../i18n';
import type { Deck, Run } from '../model';
import { readDecks, readRun, writeDecks, writeRun } from '../stored';

export const state = {
  decks: [] as Deck[],
  /** The presentation being given (or paused), persisted so a reload resumes it. */
  run: null as Run | null,
};

export function loadState(): void {
  state.decks = readDecks();
  writeDecks(state.decks); // save the cleaned-up copy
  state.run = readRun(state.decks);
  writeRun(state.run);
}

export const deckById = (id: string | null) => state.decks.find((d) => d.id === id) ?? null;
export const persistDecks = () => writeDecks(state.decks);
export const persistRun = () => writeRun(state.run);

/** Save a deck after an edit. */
export function touch(deck: Deck): void {
  deck.updatedAt = Date.now();
  persistDecks();
}

/** Minutes as people write them: "1.5" / "1,5", no trailing ".0". */
export const fmtMin = (m: number) =>
  (Math.round(m * 10) / 10).toLocaleString(getLang() === 'pt' ? 'pt-BR' : 'en', { maximumFractionDigits: 1 });

// ───────────── Views ─────────────

export type View = 'library' | 'editor' | 'presenter' | 'psummary';
const VIEWS: View[] = ['library', 'editor', 'presenter', 'psummary'];
const listeners: ((view: View) => void)[] = [];

/** Run `fn` every time a view is shown (e.g. start or stop the presenter clock). */
export const onShow = (fn: (view: View) => void) => listeners.push(fn);

export const isShown = (view: View) => !$(view).hidden;

export function show(view: View): void {
  for (const v of VIEWS) $(v).hidden = v !== view;
  document.body.classList.toggle('running', view === 'presenter');
  if (view !== 'editor' && location.hash) history.replaceState(null, '', location.pathname);
  window.scrollTo({ top: 0 });
  for (const fn of listeners) fn(view);
}

// ───────────── Routes ─────────────

export interface Routes {
  library(): void;
  editor(deckId: string): void;
  /** Start a new run of this deck. */
  present(deckId: string): void;
  /** Go back to the run in progress. */
  resume(): void;
}

const notWired = () => { throw new Error('present routes are not wired yet'); };

/** Navigation between views; filled in by initPresent(). */
export const go: Routes = { library: notWired, editor: notWired, present: notWired, resume: notWired };
