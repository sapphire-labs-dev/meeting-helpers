// Audience window. Shows the current slide and nothing else; follows the
// presenter window through a BroadcastChannel (same browser, no network).

import { $, isTyping, toggleFullscreen } from '@sapphirelabs/ui/dom';
import { initI18n, t } from '../../i18n';
import { loadStoredPdf, renderPage, type Pdf } from './pdf';
import { navDelta, openChannel, type PresentMessage } from './channel';
import { readDecks, readRun } from './stored';

let pdf: Pdf | null = null;
let deckId: string | null = null;
let page = 0;
let ended = false;

function setStatus(text: string | null, big = false): void {
  const el = $('status');
  el.hidden = text === null;
  el.textContent = text ?? '';
  el.classList.toggle('big', big);
}

async function draw(): Promise<void> {
  const canvas = $<HTMLCanvasElement>('slide');
  if (ended) { canvas.hidden = true; setStatus(t('aud.ended'), true); return; }
  if (!pdf || !page) { canvas.hidden = true; setStatus(t('aud.waiting')); return; }
  canvas.hidden = false;
  setStatus(null);
  await renderPage(pdf, page, canvas, window.innerWidth, window.innerHeight).catch(() => {});
}

async function apply(nextDeckId: string, nextPage: number, isEnded: boolean): Promise<void> {
  ended = isEnded;
  page = nextPage;
  if (nextDeckId !== deckId) {
    deckId = nextDeckId;
    pdf = null;
    const deck = readDecks().find((d) => d.id === nextDeckId);
    if (deck) {
      try { pdf = await loadStoredPdf(deck.fileId); } catch { pdf = null; }
    }
  }
  if (nextDeckId === deckId) await draw();
}

function onMessage(m: PresentMessage): void {
  if (m.type === 'state') void apply(m.deckId, m.page, m.ended);
  else if (m.type === 'bye') { page = 0; void draw(); }
}

export function initScreen(): void {
  initI18n();
  const send = openChannel(onMessage);

  // Show the running presentation right away, then keep in sync with the presenter.
  const run = readRun(readDecks());
  if (run) void apply(run.deckId, run.page, false);
  else void draw();

  send({ type: 'hello' });
  window.setInterval(() => send({ type: 'hello' }), 2000);
  window.addEventListener('pagehide', () => send({ type: 'bye' }));

  // Clickers and arrow keys work in this window too: forward them to the presenter.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    const delta = navDelta(e);
    if (delta) { e.preventDefault(); send({ type: 'nav', delta }); }
    else if (e.key.toLowerCase() === 'f') toggleFullscreen();
  });
  document.addEventListener('dblclick', toggleFullscreen);

  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void draw(), 120);
  });

  // Hide the hint and the mouse cursor when idle.
  const hint = $('hint');
  let idleTimer: number | undefined;
  const wake = () => {
    document.body.classList.remove('idle');
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => { document.body.classList.add('idle'); hint.classList.add('gone'); }, 3000);
  };
  document.addEventListener('mousemove', wake);
  wake();
  window.setTimeout(() => hint.classList.add('gone'), 5000);
}
