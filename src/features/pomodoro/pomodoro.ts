// Pomodoro page (/pomodoro): timer, tasks, today's stats and settings.

import { $, h, isTyping, toggleFullscreen } from '@sapphirelabs/ui/dom';
import { beep, unlockAudio } from '@sapphirelabs/ui/sound';
import { load, save } from '@sapphirelabs/ui/storage';
import { formatCountdown, formatShort } from '@sapphirelabs/ui/time';
import { newId } from '@sapphirelabs/ui/id';
import { applyTitle, getLang, initI18n, locale, t } from '../../i18n';
import {
  applySettings, checkEnd, dayKey, elapsed, finishPhase, isFresh, isRunning, parseStore, pause, PHASES, remaining,
  start, switchPhase, TASK_MAX, todayLog, type Phase, type Settings, type Store,
} from './model';

const KEY = 'pomodoro:store';
let store: Store;
const persist = () => save(KEY, store);

const phaseLabel = (p: Phase) => t(p === 'focus' ? 'pomo.phase.focus' : p === 'short' ? 'pomo.phase.short' : 'pomo.phase.long');

// ───────────── Alerts when a phase ends ─────────────

function alertEnd(ended: Phase): void {
  const body = ended === 'focus' ? t('pomo.notify.focusDone') : t('pomo.notify.breakDone');
  if (store.settings.sound) beep(ended === 'focus' ? 660 : 520, 0.2, 2);
  if (store.settings.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification(t('pomo.title'), { body, tag: 'sapphire-pomodoro' }); } catch { /* not supported here */ }
  }
}

/** Finish the phase if its time is up; returns true when something changed. */
function poll(): boolean {
  const ended = checkEnd(store, Date.now());
  if (!ended) return false;
  persist();
  alertEnd(ended);
  render();
  return true;
}

// Background tabs throttle repeating timers, so also schedule one exact
// timeout for the end of the running phase.
let endTimer: number | undefined;
function scheduleEnd(): void {
  window.clearTimeout(endTimer);
  if (isRunning(store.timer)) endTimer = window.setTimeout(() => { poll(); scheduleEnd(); }, remaining(store.timer, Date.now()) + 50);
}

// ───────────── Rendering ─────────────

function renderTimer(): void {
  const now = Date.now();
  const tm = store.timer;
  const left = remaining(tm, now);
  const running = isRunning(tm);
  const onBreak = tm.phase !== 'focus';
  // Grey only when paused mid-phase; a phase ready to start keeps its colour.
  $('timer').dataset.state = !running && !isFresh(tm) ? 'paused' : onBreak ? 'break' : 'ok';
  const clock = formatCountdown(left);
  $('clock').textContent = clock;
  $('clock-sub').textContent = !running && isFresh(tm) ? t('pomo.ready') : !running ? t('common.paused') : onBreak ? t('pomo.onBreak') : t('pomo.focusing');
  $('bar-fill').style.width = `${Math.min(100, (elapsed(tm, now) / tm.durationMs) * 100)}%`;
  applyTitle(running || !isFresh(tm) ? `${clock} · ${phaseLabel(tm.phase)}` : undefined);
}

function render(): void {
  const tm = store.timer;
  document.querySelectorAll<HTMLInputElement>('input[name="phase"]').forEach((r) => { r.checked = r.value === tm.phase; });
  $('toggle-label').textContent = isRunning(tm) ? t('common.pause') : isFresh(tm) ? t('common.start') : t('common.resume');

  const every = store.settings.longEvery;
  const done = store.cycleCount % every;
  $('dots').replaceChildren(...Array.from({ length: every }, (_, i) => h('i', { class: i < done ? 'on' : '' })));
  const left = every - done;
  $('cycle-label').textContent = left <= 1 && tm.phase === 'focus' ? t('pomo.cycleLong') : t('pomo.cycle', { n: left });

  const task = store.tasks.find((tk) => tk.id === store.currentTaskId);
  const working = $('working');
  working.classList.toggle('none', !task);
  if (task) working.replaceChildren(`${t('pomo.workingOn')}: `, h('b', { text: task.text }));
  else working.textContent = t('pomo.noTask');

  renderTasks();
  renderToday();
  renderTimer();
}

function renderTasks(): void {
  const list = $('tasks');
  const active = document.activeElement as HTMLElement | null;
  const focusId = active?.closest<HTMLElement>('[data-id]')?.dataset.id;
  const focusAct = active?.dataset.act;
  list.replaceChildren(...store.tasks.map((tk, i) =>
    h('li', { class: [tk.done ? 'done' : '', tk.id === store.currentTaskId ? 'current' : ''].join(' ').trim(), 'data-id': tk.id },
      h('input', { type: 'checkbox', checked: tk.done, title: t('pomo.taskDone'), 'aria-label': `${t('pomo.taskDone')}: ${tk.text}`, 'data-act': 'done' }),
      h('input', { type: 'text', class: 'row-input', value: tk.text, maxlength: TASK_MAX, 'aria-label': tk.text, 'data-act': 'rename' }),
      h('span', { class: 'row-meta', title: t('pomo.taskCount', { n: tk.pomodoros }), text: tk.pomodoros ? `● ${tk.pomodoros}` : '' }),
      h('button', {
        type: 'button', class: `row-btn${tk.id === store.currentTaskId ? ' on' : ''}`, 'data-act': 'pick',
        title: t('pomo.taskPick'), 'aria-label': `${t('pomo.taskPick')}: ${tk.text}`, 'aria-pressed': String(tk.id === store.currentTaskId), text: '◎',
      }),
      h('button', { type: 'button', class: 'row-btn', 'data-act': 'up', title: t('common.moveUp'), 'aria-label': t('common.moveUp'), disabled: i === 0, text: '↑' }),
      h('button', { type: 'button', class: 'row-btn danger', 'data-act': 'remove', title: t('common.remove'), 'aria-label': `${t('common.remove')} ${tk.text}`, text: '✕' }),
    ),
  ));
  $('tasks-empty').hidden = store.tasks.length > 0;
  $('clear-done').hidden = !store.tasks.some((tk) => tk.done);
  if (focusId && focusAct) list.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"] [data-act="${focusAct}"]`)?.focus();
}

function renderToday(): void {
  const now = Date.now();
  const today = todayLog(store, now);
  $('today-count').textContent = String(today.focusCount);
  $('today-time').textContent = formatShort(today.focusMs, getLang());

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    const log = store.history.find((x) => x.date === dayKey(d.getTime()));
    return { date: d, count: log?.focusCount ?? 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  const weekday = new Intl.DateTimeFormat(locale(), { weekday: 'short' });
  $('week').replaceChildren(...days.map((d, i) => {
    const col = h('span', { class: 'col' });
    col.style.height = `${Math.max(2, (d.count / max) * 80)}px`;
    return h('li', { class: [d.count ? '' : 'zero', i === 6 ? 'today' : ''].join(' ').trim(), title: `${d.date.toLocaleDateString(locale())}: ${d.count}` },
      h('span', { class: 'n', text: String(d.count) }), col, h('span', { class: 'd', text: weekday.format(d.date).replace('.', '') }));
  }));
}

function renderSettings(): void {
  const s = store.settings;
  $<HTMLInputElement>('focus-min').value = String(s.focusMin);
  $<HTMLInputElement>('short-min').value = String(s.shortMin);
  $<HTMLInputElement>('long-min').value = String(s.longMin);
  $<HTMLInputElement>('long-every').value = String(s.longEvery);
  $<HTMLInputElement>('auto-start').checked = s.autoStart;
  $<HTMLInputElement>('sound').checked = s.sound;
  $<HTMLInputElement>('notify').checked = s.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

// ───────────── Actions ─────────────

function toggleRun(): void {
  unlockAudio();
  const now = Date.now();
  if (isRunning(store.timer)) pause(store.timer, now); else start(store.timer, now);
  persist();
  scheduleEnd();
  render();
}

function skip(): void {
  finishPhase(store, Date.now(), { counted: false, run: isRunning(store.timer) });
  persist();
  scheduleEnd();
  render();
}

function restart(): void {
  switchPhase(store, store.timer.phase);
  persist();
  scheduleEnd();
  render();
}

function addTasks(raw: string): void {
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).map((l) => l.slice(0, TASK_MAX));
  if (!lines.length) return;
  const added = lines.map((text) => ({ id: newId(), text, done: false, pomodoros: 0 }));
  store.tasks.push(...added);
  store.currentTaskId ??= added[0].id;
  persist();
  render();
}

function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  applySettings(store, { ...store.settings, [key]: value });
  persist();
  render();
}

function bindSettings(): void {
  const numbers: [string, 'focusMin' | 'shortMin' | 'longMin' | 'longEvery', number, number][] = [
    ['focus-min', 'focusMin', 1, 180], ['short-min', 'shortMin', 1, 60], ['long-min', 'longMin', 1, 120], ['long-every', 'longEvery', 2, 12],
  ];
  for (const [id, key, min, max] of numbers) {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('input', () => {
      const v = Math.round(Number(el.value));
      if (el.value !== '' && Number.isFinite(v)) updateSetting(key, Math.min(max, Math.max(min, v)));
    });
    el.addEventListener('blur', renderSettings);
  }
  $<HTMLInputElement>('auto-start').addEventListener('change', (e) => updateSetting('autoStart', (e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('sound').addEventListener('change', (e) => updateSetting('sound', (e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('notify').addEventListener('change', async (e) => {
    const box = e.target as HTMLInputElement;
    const blocked = $('notify-blocked');
    if (!box.checked) { blocked.hidden = true; updateSetting('notify', false); return; }
    const permission = typeof Notification === 'undefined' ? 'denied' : await Notification.requestPermission();
    blocked.hidden = permission === 'granted';
    box.checked = permission === 'granted';
    updateSetting('notify', box.checked);
  });
}

function bindTasks(): void {
  const input = $<HTMLInputElement>('task-input');
  $('task-form').addEventListener('submit', (e) => { e.preventDefault(); addTasks(input.value); input.value = ''; input.focus(); });
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/\r?\n/.test(text.trim())) return;
    e.preventDefault();
    addTasks(text);
  });
  const list = $('tasks');
  const taskOf = (el: Element) => {
    const id = el.closest<HTMLElement>('[data-id]')?.dataset.id;
    const i = store.tasks.findIndex((tk) => tk.id === id);
    return { i, task: store.tasks[i] };
  };
  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!btn) return;
    const { i, task } = taskOf(btn);
    if (!task) return;
    const act = btn.dataset.act;
    if (act === 'pick') store.currentTaskId = store.currentTaskId === task.id ? null : task.id;
    else if (act === 'up' && i > 0) [store.tasks[i - 1], store.tasks[i]] = [store.tasks[i], store.tasks[i - 1]];
    else if (act === 'remove') {
      store.tasks.splice(i, 1);
      if (store.currentTaskId === task.id) store.currentTaskId = null;
    } else return;
    persist();
    render();
  });
  list.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    const { task } = taskOf(el);
    if (!task) return;
    if (el.dataset.act === 'done') {
      task.done = el.checked;
      if (task.done && store.currentTaskId === task.id) store.currentTaskId = store.tasks.find((tk) => !tk.done)?.id ?? null;
    } else if (el.dataset.act === 'rename') {
      const text = el.value.trim().slice(0, TASK_MAX);
      if (text) task.text = text; else el.value = task.text;
    }
    persist();
    render();
  });
  list.addEventListener('keydown', (e) => {
    const el = e.target as HTMLInputElement;
    if (e.key === 'Enter' && el.dataset.act === 'rename') el.blur();
  });
  $('clear-done').addEventListener('click', () => {
    store.tasks = store.tasks.filter((tk) => !tk.done);
    persist();
    render();
  });
}

export function initPomodoro(): void {
  initI18n();
  store = parseStore(load<unknown>(KEY, null));
  persist();

  $('toggle-btn').addEventListener('click', toggleRun);
  $('skip-btn').addEventListener('click', skip);
  $('restart-btn').addEventListener('click', restart);
  $('fs-btn').addEventListener('click', toggleFullscreen);
  document.querySelectorAll<HTMLInputElement>('input[name="phase"]').forEach((r) => r.addEventListener('change', () => {
    if (!(PHASES as readonly string[]).includes(r.value)) return;
    switchPhase(store, r.value as Phase);
    persist();
    scheduleEnd();
    render();
  }));
  bindTasks();
  bindSettings();

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    const k = e.key.toLowerCase();
    if (k === ' ' && !(e.target as HTMLElement).closest('button, summary')) { e.preventDefault(); toggleRun(); }
    else if (k === 's') skip();
    else if (k === 'r') restart();
    else if (k === 'f') toggleFullscreen();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { poll(); renderTimer(); } });
  window.addEventListener('langchange', render);
  window.setInterval(() => { if (!poll()) renderTimer(); }, 250);

  poll();
  renderSettings();
  render();
  scheduleEnd();
}
