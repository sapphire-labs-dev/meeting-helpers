import { describe, expect, it } from 'vitest';
import {
  addPerson, addTime, createSession, elapsedOf, endNow, isValidSession, meetingLeft, next, prev, skipCurrent, slotFor,
  toggleSkip, togglePause, usedTotal,
} from './session';

const M = 60_000;
const names = (s: ReturnType<typeof createSession>) => s.speakers.map((sp) => sp.name);

describe('daily session, adaptive time', () => {
  it('splits the speaking time (total minus general topics) across people', () => {
    const s = createSession(['A', 'B', 'C'], { totalMs: 15 * M, bufferMs: 3 * M, adaptive: true }, 0);
    expect(s.speakers[0].slotMs).toBe(4 * M);
    expect(slotFor(s, 1, 0)).toBe(4 * M);
  });

  it('gives unused time to the next people and takes overtime from them', () => {
    let now = 0;
    const s = createSession(['A', 'B', 'C'], { totalMs: 15 * M, bufferMs: 3 * M, adaptive: true }, now);
    now += 2 * M; next(s, now); // A used 2 of 4
    expect(s.speakers[1].slotMs).toBe(5 * M);
    now += 7 * M; // B overruns by 2
    expect(slotFor(s, 2, now)).toBe(3 * M); // 12 - 2 - 7
    next(s, now);
    expect(s.speakers[2].slotMs).toBe(3 * M);
  });

  it('gives general topics whatever is left of the meeting', () => {
    let now = 0;
    const s = createSession(['A'], { totalMs: 10 * M, bufferMs: 2 * M, adaptive: true }, now);
    now += 6 * M; next(s, now);
    expect(s.speakers[s.current].kind).toBe('buffer');
    expect(s.speakers[s.current].slotMs).toBe(4 * M);
  });

  it('freezes time while paused', () => {
    let now = 0;
    const s = createSession(['A'], { totalMs: 5 * M, bufferMs: 0, adaptive: true }, now);
    now += M; togglePause(s, now);
    now += 10 * M;
    expect(elapsedOf(s, 0, now)).toBe(M);
    togglePause(s, now); now += M;
    expect(elapsedOf(s, 0, now)).toBe(2 * M);
  });

  it('goes back to the previous speaker and keeps their time', () => {
    let now = 0;
    const s = createSession(['A', 'B'], { totalMs: 10 * M, bufferMs: 0, adaptive: true }, now);
    now += M; next(s, now);
    expect(prev(s, now)).toBe(true);
    expect(s.speakers[0].status).toBe('active');
    expect(s.speakers[1].status).toBe('pending');
    now += M;
    expect(elapsedOf(s, 0, now)).toBe(2 * M);
  });

  it('ends after the last speaker, counting every speaker', () => {
    let now = 0;
    const s = createSession(['A', 'B'], { totalMs: 10 * M, bufferMs: 0, adaptive: true }, now);
    now += 3 * M; next(s, now);
    now += 4 * M; next(s, now);
    expect(s.current).toBe(-1);
    expect(s.endedAt).toBe(now);
    expect(usedTotal(s, now + 99 * M)).toBe(7 * M);
    expect(meetingLeft(s, now)).toBe(3 * M);
  });
});

describe('daily session, queue changes', () => {
  it('keeps fixed slots when adaptive time is off', () => {
    let now = 0;
    const s = createSession(['A', 'B', 'C'], { totalMs: 9 * M, bufferMs: 0, adaptive: false }, now);
    now += 5 * M; next(s, now);
    expect(s.speakers[1].slotMs).toBe(3 * M);
  });

  it('marks someone absent and puts them back right after the current speaker', () => {
    const now = 0;
    const s = createSession(['A', 'B', 'C', 'D'], { totalMs: 8 * M, bufferMs: 0, adaptive: true }, now);
    toggleSkip(s, 3);
    expect(s.speakers[3].status).toBe('skipped');
    toggleSkip(s, 3);
    expect(names(s)).toEqual(['A', 'D', 'B', 'C']);
    next(s, now);
    expect(s.speakers[s.current].name).toBe('D');
  });

  it('adds a late arrival before general topics', () => {
    const s = createSession(['A'], { totalMs: 10 * M, bufferMs: 2 * M, adaptive: true }, 0);
    addPerson(s, 'Late');
    expect(names(s)).toEqual(['A', 'Late', '']);
    expect(s.speakers[2].kind).toBe('buffer');
  });

  it('skips the current speaker and adds a minute to a slot', () => {
    const s = createSession(['A', 'B'], { totalMs: 10 * M, bufferMs: 0, adaptive: true }, 0);
    addTime(s, M, 0);
    expect(s.speakers[0].slotMs).toBe(6 * M);
    skipCurrent(s, 0);
    expect(s.speakers[0].status).toBe('skipped');
    expect(s.speakers[s.current].name).toBe('B');
    endNow(s, 0);
    expect(s.current).toBe(-1);
  });

  it('recognises a saved session', () => {
    expect(isValidSession(createSession(['A'], { totalMs: M, bufferMs: 0, adaptive: true }, 0))).toBe(true);
    expect(isValidSession({ version: 9 })).toBe(false);
    expect(isValidSession(null)).toBe(false);
  });

  it('rejects sessions with broken speakers or an impossible current speaker', () => {
    const saved = () => JSON.parse(JSON.stringify(createSession(['A', 'B'], { totalMs: M, bufferMs: 0, adaptive: true }, 0)));
    expect(isValidSession(saved())).toBe(true);
    for (const patch of [
      { current: 5 }, { current: 1 }, { current: 'x' }, { totalMs: -1 }, { paused: 'yes' }, { runningSince: 'now' },
      { speakers: [{ id: 'a', name: 'A', kind: 'ghost', status: 'active', usedMs: 0, slotMs: null }] },
      { speakers: [{ id: 'a', name: 'A', kind: 'person', status: 'active', usedMs: -5, slotMs: null }] },
    ]) {
      expect(isValidSession({ ...saved(), ...patch }), JSON.stringify(patch)).toBe(false);
    }
  });
});
