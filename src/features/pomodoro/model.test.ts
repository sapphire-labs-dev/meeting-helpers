import { describe, expect, it } from 'vitest';
import {
  applySettings, checkEnd, createStore, dayKey, finishPhase, nextPhase, parseStore, pause, remaining, start, switchPhase, todayLog,
} from './model';

const M = 60_000;
const NOON = new Date(2026, 10, 13, 12, 0, 0).getTime();

describe('pomodoro timer', () => {
  it('counts down only while running and resumes after a pause', () => {
    const s = createStore();
    expect(remaining(s.timer, NOON)).toBe(25 * M);
    start(s.timer, NOON);
    pause(s.timer, NOON + 10 * M);
    expect(remaining(s.timer, NOON + 60 * M)).toBe(15 * M); // paused: no time passes
    start(s.timer, NOON + 60 * M);
    expect(remaining(s.timer, NOON + 65 * M)).toBe(10 * M);
  });

  it('logs a finished focus phase for today and the current task, then offers a short break', () => {
    const s = createStore();
    s.tasks.push({ id: 'a', text: 'Write report', done: false, pomodoros: 0 });
    s.currentTaskId = 'a';
    start(s.timer, NOON);
    expect(checkEnd(s, NOON + 24 * M)).toBeNull();
    expect(checkEnd(s, NOON + 30 * M)).toBe('focus');
    expect(s.tasks[0].pomodoros).toBe(1);
    expect(todayLog(s, NOON)).toEqual({ date: dayKey(NOON), focusCount: 1, focusMs: 25 * M });
    expect(s.timer.phase).toBe('short');
    expect(s.timer.runningSince).toBeNull(); // autoStart is off
  });

  it('starts the next phase at the exact end time when auto-start is on', () => {
    const s = createStore();
    s.settings.autoStart = true;
    start(s.timer, NOON);
    checkEnd(s, NOON + 27 * M); // tab woke up 2 minutes late
    expect(s.timer.phase).toBe('short');
    expect(remaining(s.timer, NOON + 27 * M)).toBe(3 * M);
  });

  it('gives a long break after every N focus phases and restarts the cycle', () => {
    const s = createStore();
    s.settings.longEvery = 2;
    const phases: string[] = [];
    for (let i = 0; i < 4; i++) phases.push(finishPhase(s, NOON, { counted: true }));
    expect(phases).toEqual(['short', 'focus', 'long', 'focus']);
    expect(s.cycleCount).toBe(0);
  });

  it('does not count skipped focus phases', () => {
    const s = createStore();
    finishPhase(s, NOON, { counted: false });
    expect(todayLog(s, NOON).focusCount).toBe(0);
    expect(nextPhase(s)).toBe('focus');
  });

  it('switches phase by hand and applies new lengths only to a phase not started yet', () => {
    const s = createStore();
    switchPhase(s, 'long');
    applySettings(s, { ...s.settings, longMin: 20 });
    expect(remaining(s.timer, NOON)).toBe(20 * M);
    start(s.timer, NOON);
    applySettings(s, { ...s.settings, longMin: 30 });
    expect(remaining(s.timer, NOON)).toBe(20 * M);
  });
});

describe('reading a saved pomodoro store', () => {
  it('starts fresh from garbage', () => {
    for (const raw of [null, 'x', [], { settings: 5, tasks: 'no', timer: [] }]) {
      const s = parseStore(raw);
      expect(s.tasks).toEqual([]);
      expect(s.timer.phase).toBe('focus');
      expect(s.settings.focusMin).toBe(25);
    }
  });

  it('repairs out-of-range values and drops broken items', () => {
    const s = parseStore({
      settings: { focusMin: 999, shortMin: 0, longEvery: 1, autoStart: 'yes' },
      tasks: [{ id: 't', text: 'Ok', pomodoros: -2 }, { text: '' }, null],
      currentTaskId: 'missing',
      timer: { phase: 'nap', durationMs: -5, usedMs: 0, runningSince: null },
      history: [{ date: 'yesterday', focusCount: 1 }, { date: '2026-11-12', focusCount: 3, focusMs: 75 * M }],
    });
    expect(s.settings).toMatchObject({ focusMin: 180, shortMin: 1, longEvery: 2, autoStart: false });
    expect(s.tasks).toEqual([{ id: 't', text: 'Ok', done: false, pomodoros: 0 }]);
    expect(s.currentTaskId).toBeNull();
    expect(s.timer).toMatchObject({ phase: 'focus', usedMs: 0, runningSince: null });
    expect(s.history).toEqual([{ date: '2026-11-12', focusCount: 3, focusMs: 75 * M }]);
  });

  it('round-trips a store it created', () => {
    const s = createStore();
    s.tasks.push({ id: 'a', text: 'Plan', done: true, pomodoros: 2 });
    s.currentTaskId = 'a';
    start(s.timer, NOON);
    finishPhase(s, NOON + 25 * M, { counted: true });
    expect(parseStore(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
