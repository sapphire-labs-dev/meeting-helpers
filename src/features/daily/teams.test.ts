import { describe, expect, it } from 'vitest';
import { defaultSettings, parseTeams } from './teams';

describe('reading saved teams', () => {
  it('starts with one empty team when nothing usable was saved', () => {
    for (const raw of [null, 'x', 42, [], {}, { teams: 'nope' }, { teams: [null, 3] }]) {
      const store = parseTeams(raw);
      expect(store.teams).toHaveLength(1);
      expect(store.teams[0]).toMatchObject({ name: '', people: [], settings: defaultSettings() });
      expect(store.activeId).toBe(store.teams[0].id);
    }
  });

  it('keeps valid people and drops broken ones', () => {
    const store = parseTeams({
      teams: [{ id: 't1', name: 'Core', people: [
        { id: 'p1', name: 'Ana', present: false },
        { name: '  Bia  ' },
        { id: 'p3', name: '' },
        { id: 'p4' },
        'Carla',
      ] }],
      activeId: 't1',
    });
    const people = store.teams[0].people;
    expect(people.map((p) => [p.name, p.present])).toEqual([['Ana', false], ['Bia', true]]);
    expect(people[1].id).toBeTruthy();
  });

  it('repairs settings out of range or of the wrong type', () => {
    const store = parseTeams({
      teams: [{ id: 't1', name: 'Core', people: [], settings: { order: 'random', durationMin: 9999, bufferMin: 9999, adaptive: 'yes', sound: false } }],
      activeId: 't1',
    });
    expect(store.teams[0].settings).toEqual({ order: 'shuffle', durationMin: 240, bufferMin: 239, adaptive: true, sound: false });
  });

  it('falls back to the first team when the active one is gone', () => {
    const store = parseTeams({ teams: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], activeId: 'zzz' });
    expect(store.activeId).toBe('a');
  });

  it('stores old translated default names as empty, so they follow the language', () => {
    const store = parseTeams({ teams: [{ id: 'a', name: 'Meu time' }], activeId: 'a' });
    expect(store.teams[0].name).toBe('');
  });
});
