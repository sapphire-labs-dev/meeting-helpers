import { describe, expect, it } from 'vitest';
import { addCards, cardLines, findCard, moveCard, newRetro, orderedCards, parseRetro, parseRetros, toMarkdown, vote } from './model';

const labels = {
  title: (c: { kind: string }) => c.kind,
  actions: 'Action items',
  owner: 'owner',
  date: '13 Nov 2026',
  votes: (n: number) => `${n} votes`,
};

describe('retro board', () => {
  it('creates the columns of a template', () => {
    expect(newRetro('Sprint 12', 'ssc', 0).columns.map((c) => c.kind)).toEqual(['start', 'stop', 'continue']);
    expect(newRetro('x', '4l', 0).columns).toHaveLength(4);
  });

  it('turns a pasted chat list into cards', () => {
    expect(cardLines('- Faster deploys\n\n* Fewer meetings\n• Pairing\n1. Docs\n2) Tests\n  plain line ')).toEqual([
      'Faster deploys', 'Fewer meetings', 'Pairing', 'Docs', 'Tests', 'plain line',
    ]);
    const r = newRetro('x', 'wwi', 0);
    expect(addCards(r.columns[0], 'A\nB')).toBe(2);
    expect(r.columns[0].cards.map((c) => c.text)).toEqual(['A', 'B']);
  });

  it('keeps votes between 0 and 99 and sorts by votes when asked', () => {
    const r = newRetro('x', 'wwi', 0);
    addCards(r.columns[0], 'A\nB\nC');
    const [a, b, c] = r.columns[0].cards;
    vote(a, -1);
    vote(b, 2);
    vote(c, 1);
    vote(c, 500);
    expect([a.votes, b.votes, c.votes]).toEqual([0, 2, 99]);
    expect(orderedCards(r.columns[0], true).map((x) => x.text)).toEqual(['C', 'B', 'A']);
    expect(orderedCards(r.columns[0], false).map((x) => x.text)).toEqual(['A', 'B', 'C']);
  });

  it('moves cards between neighbouring columns', () => {
    const r = newRetro('x', 'ssc', 0);
    addCards(r.columns[0], 'Card');
    const id = r.columns[0].cards[0].id;
    expect(moveCard(r, id, -1)).toBe(false);
    expect(moveCard(r, id, 1)).toBe(true);
    expect(findCard(r, id)?.col.kind).toBe('stop');
  });

  it('exports Markdown with escaped text, votes and actions', () => {
    const r = newRetro('Sprint *12*', 'wwi', 0);
    addCards(r.columns[0], 'Shipped #42\nGood pairing');
    vote(r.columns[0].cards[1], 3);
    r.actions.push({ id: 'a', text: 'Fix CI', owner: 'Ana', done: false }, { id: 'b', text: 'Docs', owner: '', done: true });
    expect(toMarkdown(r, labels)).toBe(
      '# Sprint \\*12\\*\n\n_13 Nov 2026_\n\n'
      + '## wentWell\n\n- Good pairing (3 votes)\n- Shipped \\#42\n\n'
      + '## toImprove\n\n- —\n\n'
      + '## Action items\n\n- [ ] Fix CI — owner: Ana\n- [x] Docs\n',
    );
  });
});

describe('reading saved retros', () => {
  it('drops broken boards and repairs fields', () => {
    const list = parseRetros([
      { id: 'r1', name: 'Ok', template: 'nope', columns: [{ kind: 'mad', cards: [{ text: 'x', votes: 500 }, { text: '' }] }], actions: [{ text: 'Do', owner: 7 }, 'junk'] },
      { id: 'r2', columns: [] },
      null,
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].template).toBe('wwi');
    expect(list[0].columns[0].cards).toEqual([{ id: expect.any(String), text: 'x', votes: 99 }]);
    expect(list[0].actions).toEqual([{ id: expect.any(String), text: 'Do', owner: '', done: false }]);
    expect(parseRetros('nope')).toEqual([]);
  });

  it('round-trips a board it created', () => {
    const r = newRetro('Sprint', 'msg', 5);
    addCards(r.columns[2], 'Yay');
    r.actions.push({ id: 'a', text: 'Act', owner: 'Bia', done: false });
    expect(parseRetro(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
});
