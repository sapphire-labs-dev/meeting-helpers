import { describe, expect, it } from 'vitest';
import {
  createRun, finishRun, goTo, isValidRun, newDeck, parseDeck, parseDecks, paceDelta, plan, setTopic, stepTopic, togglePause,
  topicIndex, topicUsed, totalUsed, type Deck,
} from './model';

const M = 60_000;

function deck(totalMin: number, topics: [string, number | null][] = []): Deck {
  const d = newDeck('file', 'Quarterly review.pdf', 1000, 6, []);
  d.totalMin = totalMin;
  d.topics = topics.map(([text, minutes], i) => ({ id: `t${i}`, text, minutes }));
  return d;
}

describe('presentation plan', () => {
  it('names the deck after the file', () => {
    expect(deck(10).name).toBe('Quarterly review');
  });

  it('gives fixed topics their minutes and splits the rest of the total', () => {
    const p = plan(deck(10, [['A', 4], ['B', null], ['C', null]]));
    expect(p.topicMs).toEqual([4 * M, 3 * M, 3 * M]);
    expect(p.fixedMin).toBe(4);
    expect(p.autoCount).toBe(2);
  });

  it('never gives a negative share when fixed topics exceed the total', () => {
    expect(plan(deck(4, [['A', 5], ['B', null]])).topicMs).toEqual([5 * M, 0]);
  });
});

describe('presentation run', () => {
  it('moves between slides without touching topic time', () => {
    const d = deck(10, [['A', null]]);
    const r = createRun(d, 0);
    goTo(d, r, 99);
    expect(r.page).toBe(6);
    goTo(d, r, -3);
    expect(r.page).toBe(1);
  });

  it('counts time per topic and in total', () => {
    let now = 0;
    const d = deck(10, [['A', 4], ['B', null], ['C', null]]);
    const r = createRun(d, now);
    now += 5 * M; stepTopic(d, r, 1, now);
    expect(topicUsed(d, r, 0, now)).toBe(5 * M);
    now += 2 * M;
    expect(topicUsed(d, r, 1, now)).toBe(2 * M);
    expect(totalUsed(r, now)).toBe(7 * M);
    expect(paceDelta(d, r, now)).toBe(M); // A took 1 min too long, B is within its slot
  });

  it('freezes time while paused and after finishing', () => {
    let now = 0;
    const d = deck(10, [['A', null]]);
    const r = createRun(d, now);
    now += M; togglePause(d, r, now);
    now += 10 * M;
    expect(totalUsed(r, now)).toBe(M);
    togglePause(d, r, now); now += M;
    finishRun(d, r, now);
    expect(totalUsed(r, now + 9 * M)).toBe(2 * M);
  });

  it('can jump to any topic and go past the last one', () => {
    let now = 0;
    const d = deck(10, [['A', null], ['B', null]]);
    const r = createRun(d, now);
    setTopic(d, r, 1, now);
    now += M; setTopic(d, r, 0, now);
    now += M;
    expect(topicUsed(d, r, 1, now)).toBe(M);
    expect(topicUsed(d, r, 0, now)).toBe(M);
    stepTopic(d, r, 5, now);
    expect(topicIndex(d, r)).toBe(-1);
    stepTopic(d, r, -1, now);
    expect(topicIndex(d, r)).toBe(1);
  });

  it('without topics, only overrunning the total counts as behind', () => {
    const d = deck(1);
    const r = createRun(d, 0);
    expect(paceDelta(d, r, 30_000)).toBe(0);
    expect(paceDelta(d, r, 90_000)).toBe(30_000);
  });

  it('accepts only current saved runs', () => {
    expect(isValidRun(createRun(deck(1), 0))).toBe(true);
    expect(isValidRun({ version: 1, deckId: 'x', page: 1, used: {} })).toBe(false);
  });
});

describe('reading saved decks', () => {
  const base = { id: 'd1', fileId: 'f1', name: 'Deck', pages: 3, totalMin: 10 };

  it('turns plain-text talking points from old versions into topics', () => {
    const d = parseDeck({ ...base, phases: [{ name: '', bullets: '- A\n\n* B\n C ' }] })!;
    expect(d.topics.map((t) => t.text)).toEqual(['A', 'B', 'C']);
  });

  it('flattens old phases into one list, keeping minutes and named empty phases', () => {
    const d = parseDeck({
      ...base,
      phases: [
        { name: 'Intro', minutes: 5, topics: [{ id: 'x', text: 'Agenda', minutes: 2 }] },
        { name: 'Fase 2', topics: [] },
        { name: 'Live demo', topics: [] },
      ],
    })!;
    expect(d.topics.map((t) => [t.text, t.minutes])).toEqual([['Agenda', 2], ['Live demo', null]]);
    expect('phases' in d).toBe(false);
  });

  it('drops decks without an id or file and anything that is not a deck', () => {
    expect(parseDecks([base, { id: 'x' }, null, 'deck', 42]).map((d) => d.id)).toEqual(['d1']);
    expect(parseDecks({ not: 'a list' })).toEqual([]);
  });

  it('repairs wrong field types and out-of-range values', () => {
    const d = parseDeck({
      ...base, name: 42, pages: -5, totalMin: 99999, titles: 'nope',
      topics: [{ text: 'Ok', minutes: -3 }, { text: '' }, { text: 'Big', minutes: 1e9 }, 'junk'],
    }, 1000)!;
    expect(d.name).toBe('Deck');
    expect(d.pages).toBe(1);
    expect(d.totalMin).toBe(600);
    expect(d.titles).toEqual([]);
    expect(d.topics.map((t) => [t.text, t.minutes])).toEqual([['Ok', 0], ['Big', 600]]);
    expect(d.topics.every((t) => typeof t.id === 'string' && t.id.length > 0)).toBe(true);
    expect(d.createdAt).toBe(1000);
  });

  it('keeps only notes for real slides and ignores odd keys', () => {
    const notes = JSON.parse('{"1":"hello","3":"last","4":"too far","x":"bad","__proto__":"evil","2":7}');
    const d = parseDeck({ ...base, slideNotes: notes })!;
    expect(d.slideNotes).toEqual({ 1: 'hello', 3: 'last' });
    expect(Object.getPrototypeOf(d.slideNotes)).toBe(Object.prototype);
  });

  it('round-trips a deck it created', () => {
    const d = deck(15, [['A', 5], ['B', null]]);
    d.slideNotes = { 2: 'note' };
    expect(parseDeck(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
});

describe('validating a saved run', () => {
  const run = () => JSON.parse(JSON.stringify(createRun(deck(10, [['A', null]]), 1000)));

  it('accepts a run it created and rejects broken ones', () => {
    expect(isValidRun(run())).toBe(true);
    for (const patch of [
      { page: 0 }, { page: 1.5 }, { topicIdx: -1 }, { usedMs: -1 }, { usedMs: 'x' }, { paused: 'no' },
      { runningSince: 'now' }, { topicUsed: null }, { topicUsed: { a: 'x' } }, { deckId: '' },
    ]) {
      expect(isValidRun({ ...run(), ...patch }), JSON.stringify(patch)).toBe(false);
    }
  });
});
