// Running view: who is speaking, the big countdown, the queue and controls.

import { $, acquireWakeLock, bold, h, isTyping, releaseWakeLock, toggleFullscreen } from '@sapphirelabs/ui/dom';
import { applyTitle, getLang, t } from '../../../i18n';
import { formatClock, formatCountdown, formatShort } from '@sapphirelabs/ui/time';
import {
  addPerson, addTime, elapsedOf, endNow, meetingLeft, next, prev, skipCurrent, slotFor, toggleSkip, togglePause, type Session,
} from '../session';
import { NAME_MAX } from '../teams';
import { beep } from '@sapphirelabs/ui/sound';
import { isShown, onShow, persistSession, state, team } from './state';
import { displayName, showSummary } from './summary';

const nextPending = (s: Session) => s.speakers.findIndex((sp) => sp.status === 'pending');

/** Apply a session change, save it and re-render (or show the summary once it ends). */
function act(fn: (s: Session, now: number) => void): void {
  const s = state.session;
  if (!s) return;
  fn(s, Date.now());
  persistSession();
  if (s.current < 0) { showSummary(); return; }
  renderRun();
}

export function renderRun(): void {
  const s = state.session;
  if (!s || s.current < 0) return;
  const cur = s.speakers[s.current];

  const people = s.speakers.filter((sp) => sp.kind === 'person' && sp.status !== 'skipped');
  $('run-position').textContent = cur.kind === 'buffer'
    ? t('run.generalTopics')
    : t('run.speaker', { i: people.indexOf(cur) + 1, n: people.length });
  $('now-label').textContent = t('run.speaking');
  $('now-name').textContent = displayName(s, s.current);

  const nxt = nextPending(s);
  const upNext = $('up-next');
  if (nxt === -1) upNext.replaceChildren(t('run.last'));
  else upNext.replaceChildren(`${t('run.next')}: `, bold(displayName(s, nxt)));
  $('next-label').textContent = nxt === -1 ? t('run.finish') : t('run.nextBtn');
  $('pause-label').textContent = s.paused ? t('common.resume') : t('common.pause');
  $<HTMLButtonElement>('prev-btn').disabled = !s.speakers.slice(0, s.current).some((sp) => sp.status === 'done');

  $('queue').replaceChildren(
    ...s.speakers.map((sp, i) => {
      const title = sp.status === 'skipped' ? t('run.restore') : sp.status === 'pending' ? t('run.skip') : '';
      return h('li', { class: sp.status },
        h('button', { type: 'button', 'data-idx': i, title, disabled: sp.status === 'active' || sp.status === 'done' },
          h('span', { text: displayName(s, i) }),
          h('span', { class: 't', 'data-t': i }),
        ),
      );
    }),
  );
  prevRemaining = undefined;
  tick();
}

let prevRemaining: number | undefined;
let prevSpeakerId: string | undefined;

/** Update the clocks; runs several times a second while the daily runs. */
function tick(): void {
  const s = state.session;
  if (!s || s.current < 0) return;
  const now = Date.now();
  const cur = s.speakers[s.current];
  const slot = cur.slotMs ?? 0;
  const used = elapsedOf(s, s.current, now);
  const remaining = slot - used;
  const warnAt = Math.min(30000, slot * 0.25);

  const clockState = s.paused ? 'paused' : remaining <= 0 ? 'over' : remaining <= warnAt ? 'warn' : 'ok';
  $('run').dataset.state = clockState;
  const clock = remaining > 0 ? formatCountdown(remaining) : `+${formatClock(-remaining)}`;
  $('clock').textContent = clock;
  $('clock-sub').textContent = s.paused
    ? t('common.paused')
    : remaining <= 0 ? t('run.overtime') : `${t('sum.slot')} ${formatClock(slot)}`;
  $('bar-fill').style.width = `${slot > 0 ? Math.min(100, (used / slot) * 100) : 100}%`;

  const left = meetingLeft(s, now);
  $('meeting-label').textContent = left >= 0 ? t('run.meetingLeft') : t('run.meetingOver');
  $('meeting-clock').textContent = formatClock(left);
  $('meeting-clock').parentElement!.classList.toggle('over', left < 0);
  applyTitle(`${clock} · ${displayName(s, s.current)}`);

  document.querySelectorAll<HTMLElement>('#queue [data-t]').forEach((el) => {
    const i = Number(el.dataset.t);
    const sp = s.speakers[i];
    if (!sp) return;
    el.className = 't';
    if (sp.status === 'skipped') el.textContent = t('run.skipped');
    else if (sp.status === 'pending') el.textContent = `~${formatShort(slotFor(s, i, now), getLang())}`;
    else {
      const e = elapsedOf(s, i, now);
      el.textContent = formatClock(e);
      if (sp.status === 'done') el.classList.add(e > (sp.slotMs ?? 0) ? 'over' : 'ok');
    }
  });

  // Beep when crossing the warning line and when time runs out.
  if (prevSpeakerId === cur.id && prevRemaining !== undefined && !s.paused && team().settings.sound) {
    if (prevRemaining > warnAt && remaining <= warnAt && remaining > 0) beep(660, 0.12, 1);
    if (prevRemaining > 0 && remaining <= 0) beep(520, 0.18, 2);
  }
  prevSpeakerId = cur.id;
  prevRemaining = remaining;
}

let timer: number | undefined;
function startTicking(): void { stopTicking(); timer = window.setInterval(tick, 200); }
function stopTicking(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  applyTitle();
}

export function bindRun(): void {
  onShow((view) => {
    if (view === 'run') { void acquireWakeLock(); startTicking(); }
    else { releaseWakeLock(); stopTicking(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isShown('run')) { void acquireWakeLock(); tick(); }
  });

  $('next-btn').addEventListener('click', () => act(next));
  $('prev-btn').addEventListener('click', () => act((s, n) => { prev(s, n); }));
  $('pause-btn').addEventListener('click', () => act(togglePause));
  $('skip-btn').addEventListener('click', () => act(skipCurrent));
  $('plus-btn').addEventListener('click', () => act((s, n) => addTime(s, 60000, n)));
  $('fs-btn').addEventListener('click', toggleFullscreen);
  $('end-btn').addEventListener('click', () => { if (confirm(t('run.endConfirm'))) act(endNow); });
  $('queue').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-idx]');
    if (btn) act((s) => toggleSkip(s, Number(btn.dataset.idx)));
  });
  $('late-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('late-input');
    const name = input.value.trim().slice(0, NAME_MAX);
    if (name) act((s) => addPerson(s, name));
    input.value = '';
  });

  document.addEventListener('keydown', (e) => {
    if (!isShown('run') || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    const target = e.target as HTMLElement;
    const key = e.key.toLowerCase();
    if (key === ' ' || key === 'arrowright' || key === 'n') {
      // Let Space activate a focused button normally, except the timer controls.
      if (key === ' ' && target.closest('button') && !target.closest('.controls')) return;
      e.preventDefault();
      act(next);
    } else if (key === 'arrowleft' || key === 'b') { e.preventDefault(); act((s, n) => { prev(s, n); }); }
    else if (key === 'p' || key === 'k') act(togglePause);
    else if (key === 's') act(skipCurrent);
    else if (key === 'f') toggleFullscreen();
  });
}
