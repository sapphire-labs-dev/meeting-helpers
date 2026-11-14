// Presenter view: current and next slide, topic countdown, pace, notes, and
// the link to the audience window.

import { $, acquireWakeLock, h, isTyping, releaseWakeLock, toggleFullscreen } from '@sapphirelabs/ui/dom';
import { applyTitle, getLang, t } from '../../../i18n';
import { formatClock, formatCountdown, formatShort } from '@sapphirelabs/ui/time';
import { navDelta, openChannel, type PresentMessage } from '../channel';
import {
  createRun, finishRun, goTo, paceDelta, plan, setTopic, stepTopic, togglePause, topicIndex, topicUsed, totalMs, totalUsed,
  type Deck, type Run,
} from '../model';
import { loadStoredPdf, renderPage, type Pdf } from '../pdf';
import { deckById, go, isShown, onShow, persistRun, show, state } from './state';
import { showSummary } from './summary';

let pdf: Pdf | null = null;
let renderedPage = 0;
let audienceSeen = 0;
let send: (m: PresentMessage) => void = () => {};

const runDeck = () => (state.run ? deckById(state.run.deckId) : null);

export function startPresenting(deckId: string): void {
  const deck = deckById(deckId);
  if (!deck) return;
  state.run = createRun(deck, Date.now());
  persistRun();
  enterPresenter();
}

export function enterPresenter(): void {
  const deck = runDeck();
  if (!state.run || !deck) return;
  show('presenter');
  renderedPage = 0;
  $('pr-blocked').hidden = true;
  loadStoredPdf(deck.fileId)
    .then((p) => { pdf = p; renderPresenter(); })
    .catch(() => { state.run = null; persistRun(); go.editor(deck.id); });
  renderPresenter();
}

// ───────────── Audience window ─────────────

function broadcast(): void {
  const run = state.run;
  if (run) send({ type: 'state', deckId: run.deckId, page: run.page, ended: run.endedAt !== null });
}

function onMessage(m: PresentMessage): void {
  if (m.type === 'hello') { audienceSeen = Date.now(); broadcast(); updateAudienceStatus(); }
  else if (m.type === 'bye') { audienceSeen = 0; updateAudienceStatus(); }
  else if (m.type === 'nav' && state.run && !state.run.endedAt && isShown('presenter')) navigate(m.delta);
}

function updateAudienceStatus(): void {
  const on = Date.now() - audienceSeen < 5000;
  $('aud-status').classList.toggle('on', on);
  $('aud-status-label').textContent = on ? t('pr.audienceOn') : t('pr.audienceOff');
}

function openAudience(): void {
  const url = new URL('/present/screen', location.href).href;
  const w = window.open(url, 'sapphire-audience', 'popup=yes,width=1280,height=760');
  const blocked = $('pr-blocked');
  blocked.hidden = !!w;
  if (!w) {
    const a = $<HTMLAnchorElement>('pr-blocked-link');
    a.href = url;
    a.textContent = url;
  }
}

// ───────────── Actions ─────────────

function navigate(delta: number): void {
  const deck = runDeck();
  if (!state.run || !deck) return;
  goTo(deck, state.run, state.run.page + delta);
  persistRun();
  renderPresenter();
}

function topicAction(fn: (deck: Deck, r: Run, now: number) => void): void {
  const deck = runDeck();
  if (!state.run || !deck) return;
  fn(deck, state.run, Date.now());
  persistRun();
  renderPresenter();
}

function endPresentation(): void {
  const deck = runDeck();
  const run = state.run;
  if (!run || !deck || !confirm(t('pr.endConfirm'))) return;
  finishRun(deck, run, Date.now());
  broadcast();
  showSummary(deck, run);
  state.run = null;
  persistRun();
}

// ───────────── Rendering ─────────────

function stageSize(el: HTMLElement): [number, number] {
  const r = el.getBoundingClientRect();
  return [Math.max(50, r.width - 2), Math.max(50, r.height - 2)];
}

function renderSlides(force = false): void {
  const deck = runDeck();
  const run = state.run;
  if (!run || !deck || !pdf) return;
  if (!force && renderedPage === run.page) return;
  renderedPage = run.page;
  const [w, hh] = stageSize($('pr-stage'));
  void renderPage(pdf, run.page, $<HTMLCanvasElement>('pr-canvas'), w, hh).catch(() => {});
  const nextCanvas = $<HTMLCanvasElement>('pr-next-canvas');
  nextCanvas.hidden = run.page >= deck.pages;
  if (run.page < deck.pages) {
    const [nw, nh] = stageSize(nextCanvas.parentElement!);
    void renderPage(pdf, run.page + 1, nextCanvas, nw, nh).catch(() => {});
  }
}

export function renderPresenter(): void {
  const deck = runDeck();
  const run = state.run;
  if (!run || !deck) return;
  const ti = topicIndex(deck, run);
  const n = deck.topics.length;
  const allDone = n > 0 && ti === -1;

  $('pr-deck-name').textContent = deck.name;
  $('pr-topic-pos').textContent = ti >= 0 ? t('pr.topic', { i: ti + 1, n }) : allDone ? t('pr.topicsDone') : '';
  $('pr-slide-pos').textContent = t('pr.slide', { i: run.page, n: deck.pages });
  $<HTMLButtonElement>('pr-prev').disabled = run.page <= 1;
  $<HTMLButtonElement>('pr-next').disabled = run.page >= deck.pages;
  $('pr-next-label').textContent = run.page < deck.pages ? t('pr.nextSlide') : t('pr.lastSlide');
  $('pr-pause').textContent = run.paused ? t('common.resume') : t('common.pause');

  const rows = deck.topics.map((tp, j) => {
    const done = allDone || j < ti;
    return h('li', { class: j === ti ? 'cur' : done ? 'done' : '' },
      h('button', { type: 'button', 'data-topic-idx': j },
        h('span', { class: 'mark', text: done ? '✓' : String(j + 1) }),
        h('span', { class: 'txt', text: tp.text }),
        h('span', { class: 'tt', 'data-tt': j }),
      ),
    );
  });
  if (!n) rows.push(h('li', { class: 'empty', text: t('pr.noTopics') }));
  else if (allDone) rows.push(h('li', { class: 'empty', text: t('pr.topicsDone') }));
  $('pr-topics').replaceChildren(...rows);
  $<HTMLButtonElement>('pr-topic-prev').disabled = !n || run.topicIdx <= 0;
  $<HTMLButtonElement>('pr-topic-next').disabled = !n || allDone;

  const notes = deck.slideNotes[run.page]?.trim() ?? '';
  const notesEl = $('pr-slide-notes');
  notesEl.textContent = notes || t('pr.noNotes');
  notesEl.classList.toggle('empty', !notes);

  renderSlides();
  broadcast();
  updateAudienceStatus();
  tick();
}

/** Update the clocks; runs several times a second while presenting. */
function tick(): void {
  const deck = runDeck();
  const run = state.run;
  if (!run || !deck) return;
  const now = Date.now();
  const { topicMs } = plan(deck);
  const elapsed = totalUsed(run, now);
  const left = totalMs(deck) - elapsed;

  // The big clock follows the current topic; without topics (or once all are covered) it follows the total.
  const ti = topicIndex(deck, run);
  const topic = ti >= 0 ? deck.topics[ti] : null;
  const planned = topic ? topicMs[ti] : totalMs(deck);
  const used = topic ? topicUsed(deck, run, ti, now) : elapsed;
  const remaining = planned - used;
  const warnAt = Math.min(topic ? 30000 : 60000, planned * 0.2);
  const clockState = run.paused ? 'paused' : remaining <= 0 ? 'over' : remaining <= warnAt ? 'warn' : 'ok';
  $('presenter').dataset.state = clockState;
  const clock = remaining > 0 ? formatCountdown(remaining) : `+${formatClock(-remaining)}`;
  $('pr-clock').textContent = clock;
  $('pr-clock-label').textContent = topic ? topic.text : deck.name;
  $('pr-clock-sub').textContent = run.paused
    ? t('common.paused')
    : topic ? (remaining > 0 ? t('pr.topicLeft') : t('pr.topicOver')) : (remaining > 0 ? t('pr.totalLeft') : t('pr.totalOver'));
  $('pr-bar').style.width = `${planned > 0 ? Math.min(100, (used / planned) * 100) : 100}%`;

  document.querySelectorAll<HTMLElement>('#pr-topics [data-tt]').forEach((el) => {
    const j = Number(el.dataset.tt);
    const li = el.closest('li')!;
    el.className = 'tt';
    if (li.classList.contains('cur') || li.classList.contains('done')) {
      const u = topicUsed(deck, run, j, now);
      el.textContent = `${formatClock(u)} / ${formatClock(topicMs[j])}`;
      if (li.classList.contains('done')) el.classList.add(u > topicMs[j] + 999 ? 'over' : 'ok');
    } else {
      el.textContent = formatClock(topicMs[j]);
    }
  });

  $('pr-elapsed').textContent = formatClock(elapsed);
  $('pr-remaining-label').textContent = left >= 0 ? t('pr.remaining') : t('pr.overall');
  const rem = $('pr-remaining');
  rem.textContent = formatClock(left);
  rem.classList.toggle('over', left < 0);

  const delta = paceDelta(deck, run, now);
  const pace = $('pr-pace');
  pace.className = `pace${delta > 5000 ? ' behind' : delta < -5000 ? ' ahead' : ''}`;
  pace.textContent = delta > 5000 ? t('pr.behind', { time: formatShort(delta, getLang()) })
    : delta < -5000 ? t('pr.ahead', { time: formatShort(-delta, getLang()) }) : t('pr.onTrack');

  if (Date.now() - audienceSeen > 5000 && $('aud-status').classList.contains('on')) updateAudienceStatus();
  applyTitle(`${clock} · ${topic ? topic.text : deck.name}`);
}

let timer: number | undefined;
function startTicking(): void { stopTicking(); timer = window.setInterval(tick, 250); }
function stopTicking(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  applyTitle();
}

// ───────────── Events ─────────────

export function bindPresenter(): void {
  send = openChannel(onMessage);
  // Tell an open audience window when the presenter goes away.
  window.addEventListener('pagehide', () => send({ type: 'bye' }));

  onShow((view) => {
    if (view === 'presenter') { void acquireWakeLock(); startTicking(); }
    else { releaseWakeLock(); stopTicking(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isShown('presenter')) { void acquireWakeLock(); tick(); }
  });

  $('pr-prev').addEventListener('click', () => navigate(-1));
  $('pr-next').addEventListener('click', () => navigate(1));
  $('pr-pause').addEventListener('click', () => topicAction(togglePause));
  $('pr-fs').addEventListener('click', toggleFullscreen);
  $('pr-open').addEventListener('click', openAudience);
  $('pr-end').addEventListener('click', endPresentation);
  $('pr-topic-next').addEventListener('click', () => topicAction((d, r, n) => stepTopic(d, r, 1, n)));
  $('pr-topic-prev').addEventListener('click', () => topicAction((d, r, n) => stepTopic(d, r, -1, n)));
  $('pr-topics').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-topic-idx]');
    if (btn) topicAction((d, r, n) => setTopic(d, r, Number(btn.dataset.topicIdx), n));
  });

  document.addEventListener('keydown', (e) => {
    if (!isShown('presenter') || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    const target = e.target as HTMLElement;
    const delta = navDelta(e);
    if (delta) {
      // Space/Enter on a focused button should still press that button.
      if ((e.key === ' ' || e.key === 'Enter') && target.closest('button, label')) return;
      e.preventDefault();
      navigate(delta);
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'p') $('pr-pause').click();
    else if (k === 't') $(e.shiftKey ? 'pr-topic-prev' : 'pr-topic-next').click();
    else if (k === 'f') toggleFullscreen();
    else if (e.key === 'Home') { e.preventDefault(); navigate(-Infinity); }
    else if (e.key === 'End') { e.preventDefault(); navigate(Infinity); }
  });

  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { if (isShown('presenter')) renderSlides(true); }, 150);
  });
}
