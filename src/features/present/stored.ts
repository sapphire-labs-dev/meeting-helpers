// Where the presentation timer keeps its data in localStorage. Shared by the
// presenter page and the audience window; both read through the validators.

import { load, remove, save } from '@sapphirelabs/ui/storage';
import { isValidRun, parseDecks, type Deck, type Run } from './model';

const DECKS_KEY = 'present:decks';
const RUN_KEY = 'present:run';

export const readDecks = (): Deck[] => parseDecks(load<unknown>(DECKS_KEY, null));
export const writeDecks = (decks: Deck[]) => save(DECKS_KEY, decks);

/** The presentation still running in this browser, if it is valid and its deck exists. */
export function readRun(decks: Deck[]): Run | null {
  const saved = load<unknown>(RUN_KEY, null);
  return isValidRun(saved) && saved.endedAt === null && decks.some((d) => d.id === saved.deckId) ? saved : null;
}

export const writeRun = (run: Run | null) => (run ? save(RUN_KEY, run) : remove(RUN_KEY));
