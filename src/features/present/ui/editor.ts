// Editor view: deck name, total time, topics and private slide notes.

import { $, h } from '@sapphirelabs/ui/dom';
import { getLang, t } from '../../../i18n';
import { newId } from '@sapphirelabs/ui/id';
import { formatShort } from '@sapphirelabs/ui/time';
import { DECK_NAME_MAX, MINUTES_MAX, plan, TOPIC_MAX, topicLines, type Deck, type Topic } from '../model';
import { loadStoredPdf } from '../pdf';
import { deckById, fmtMin, go, show, touch } from './state';
import { thumbnail } from './thumbnails';

let editingId: string | null = null;
let selectedSlide: number | null = null;

const editing = () => deckById(editingId)!;

export function openEditor(id: string): void {
  const deck = deckById(id);
  if (!deck) { go.library(); return; }
  editingId = id;
  selectedSlide = null;
  show('editor');
  history.replaceState(null, '', `#deck=${id}`);
  buildSlideGrid(deck);
  renderEditor();
  loadStoredPdf(deck.fileId)
    .then(() => { $('ed-missing').hidden = true; $<HTMLButtonElement>('ed-present').disabled = false; })
    .catch(() => { $('ed-missing').hidden = false; $<HTMLButtonElement>('ed-present').disabled = true; });
}

/** Re-render with the current language. */
export function refreshEditor(): void {
  if (!editingId || !deckById(editingId)) return;
  buildSlideGrid(editing());
  renderEditor();
}

function renderEditor(): void {
  const deck = editing();
  const name = $<HTMLInputElement>('ed-name');
  if (document.activeElement !== name) name.value = deck.name;
  const total = $<HTMLInputElement>('ed-total');
  if (document.activeElement !== total) total.value = String(deck.totalMin);
  renderTopics();
  renderSlidePanel();
}

// ───────────── Topics ─────────────

/** One line under the total explaining how the time is split. */
function renderSum(): void {
  const deck = editing();
  const pl = plan(deck);
  const el = $('ed-sum');
  const fixed = fmtMin(pl.fixedMin);
  const total = fmtMin(deck.totalMin);
  const over = pl.fixedMin > deck.totalMin + 0.01;
  const short = deck.topics.length > 0 && pl.autoCount === 0 && pl.fixedMin < deck.totalMin - 0.01;
  el.classList.toggle('off', over || short);
  if (!deck.topics.length) el.textContent = t('ed.planNone', { total });
  else if (over) el.textContent = t('ed.topicOver', { fixed, total });
  else if (pl.autoCount === 0) el.textContent = t('ed.topicSumFixed', { fixed, total });
  else if (pl.fixedMin === 0) el.textContent = t('ed.planAuto', { total, n: pl.autoCount, each: formatShort(pl.autoMs, getLang()) });
  else el.textContent = t('ed.topicSum', { fixed, total, auto: pl.autoCount, each: formatShort(pl.autoMs, getLang()) });
}

function topicRow(deck: Deck, tp: Topic, j: number, slot: number): HTMLLIElement {
  const last = deck.topics.length - 1;
  return h('li', { class: 'topic', 'data-topic': tp.id },
    h('span', { class: 'pos', text: String(j + 1) }),
    h('input', { type: 'text', class: 'row-input', value: tp.text, maxlength: TOPIC_MAX, 'aria-label': t('ed.topicText'), 'data-f': 't-text' }),
    h('input', {
      type: 'number', class: 't-min', value: tp.minutes === null ? '' : String(tp.minutes), min: 0, max: MINUTES_MAX, step: 0.5,
      placeholder: `~${fmtMin(slot / 60000)}`, title: t('ed.topicMin'), 'aria-label': t('ed.topicMin'), 'data-f': 't-min',
    }),
    h('span', { class: 't-unit', text: 'min' }),
    h('button', { type: 'button', class: 'row-btn', title: t('common.moveUp'), 'aria-label': t('common.moveUp'), 'data-f': 't-up', disabled: j === 0, text: '↑' }),
    h('button', { type: 'button', class: 'row-btn', title: t('common.moveDown'), 'aria-label': t('common.moveDown'), 'data-f': 't-down', disabled: j === last, text: '↓' }),
    h('button', { type: 'button', class: 'row-btn danger', title: t('common.remove'), 'aria-label': `${t('common.remove')} ${tp.text}`, 'data-f': 't-del', text: '✕' }),
  );
}

function renderTopics(): void {
  const deck = editing();
  const { topicMs } = plan(deck);
  const active = document.activeElement as HTMLElement | null;
  const focusTopic = active?.closest<HTMLElement>('[data-topic]')?.dataset.topic;
  const focusField = active?.dataset.f;
  $('topic-list').replaceChildren(...deck.topics.map((tp, j) => topicRow(deck, tp, j, topicMs[j])));
  $('topics-empty').hidden = deck.topics.length > 0;
  if (focusTopic && focusField) {
    $('topic-list').querySelector<HTMLElement>(`[data-topic="${CSS.escape(focusTopic)}"] [data-f="${focusField}"]`)?.focus();
  }
  renderSum();
}

/** Refresh the automatic shares while typing, without re-rendering the inputs. */
function refreshPlan(): void {
  const { topicMs } = plan(editing());
  $('topic-list').querySelectorAll<HTMLInputElement>('.t-min').forEach((el, j) => { el.placeholder = `~${fmtMin(topicMs[j] / 60000)}`; });
  renderSum();
}

function addTopics(raw: string): void {
  const lines = topicLines(raw);
  if (!lines.length) return;
  const deck = editing();
  deck.topics.push(...lines.map((text) => ({ id: newId(), text, minutes: null })));
  touch(deck);
  renderTopics();
}

// ───────────── Slides and notes ─────────────

function buildSlideGrid(deck: Deck): void {
  const items: HTMLLIElement[] = [];
  for (let n = 1; n <= deck.pages; n++) {
    items.push(
      h('li', { 'data-page': n },
        h('button', { type: 'button', 'aria-label': t('ed.slide', { n }) },
          h('div', { class: 'thumb' }, thumbnail(deck.fileId, n, 220, 124)),
          h('span', { class: 'cap' }, h('b', { text: String(n) }), h('span', { text: deck.titles[n - 1] ?? '' }), h('i', { class: 'note-dot', hidden: true })),
        ),
      ),
    );
  }
  $('slide-grid').replaceChildren(...items);
  markSlides();
}

function markSlides(): void {
  const deck = editing();
  $('slide-grid').querySelectorAll<HTMLLIElement>('li[data-page]').forEach((li) => {
    const n = Number(li.dataset.page);
    li.classList.toggle('sel', n === selectedSlide);
    (li.querySelector('.note-dot') as HTMLElement).hidden = !deck.slideNotes[n]?.trim();
  });
}

function renderSlidePanel(): void {
  const deck = editing();
  const panel = $('slide-panel');
  if (selectedSlide === null) { panel.hidden = true; return; }
  panel.hidden = false;
  const n = selectedSlide;
  const title = deck.titles[n - 1];
  $('sp-title').textContent = title ? `${t('ed.slide', { n })} · ${title}` : t('ed.slide', { n });
  const notes = $<HTMLTextAreaElement>('sp-notes');
  if (document.activeElement !== notes) notes.value = deck.slideNotes[n] ?? '';
}

// ───────────── Events ─────────────

export function bindEditor(): void {
  $('ed-back').addEventListener('click', () => { editingId = null; go.library(); });
  $<HTMLInputElement>('ed-name').addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value.trim();
    if (v) { editing().name = v.slice(0, DECK_NAME_MAX); touch(editing()); }
  });
  $<HTMLInputElement>('ed-total').addEventListener('input', (e) => {
    const v = Math.round(Number((e.target as HTMLInputElement).value));
    if (!Number.isFinite(v) || v < 1) return;
    editing().totalMin = Math.min(MINUTES_MAX, v);
    touch(editing());
    refreshPlan();
  });
  $('ed-total').addEventListener('blur', () => { $<HTMLInputElement>('ed-total').value = String(editing().totalMin); });
  $('ed-present').addEventListener('click', () => go.present(editing().id));

  // Adding topics: type and press Enter, or paste a list (one topic per line).
  const input = $<HTMLInputElement>('topic-input');
  $('topic-add').addEventListener('submit', (e) => {
    e.preventDefault();
    addTopics(input.value);
    input.value = '';
    input.focus();
  });
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/\r?\n/.test(text.trim())) return;
    e.preventDefault();
    addTopics(text);
    input.focus();
  });

  const list = $('topic-list');
  const topicAt = (el: Element) => {
    const deck = editing();
    const j = deck.topics.findIndex((x) => x.id === el.closest<HTMLElement>('[data-topic]')?.dataset.topic);
    return { deck, j, tp: deck.topics[j] as Topic | undefined };
  };
  list.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const { deck, tp } = topicAt(el);
    if (!tp) return;
    if (el.dataset.f === 't-text') {
      if (el.value.trim()) tp.text = el.value.trim().slice(0, TOPIC_MAX);
    } else if (el.dataset.f === 't-min') {
      const v = Number(el.value);
      tp.minutes = el.value === '' || !Number.isFinite(v) ? null : Math.min(MINUTES_MAX, Math.max(0, Math.round(v * 2) / 2));
      refreshPlan();
    } else return;
    touch(deck);
  });
  list.addEventListener('focusout', (e) => {
    const el = e.target as HTMLInputElement;
    const { tp } = topicAt(el);
    if (!tp) return;
    if (el.dataset.f === 't-text') el.value = tp.text;
    else if (el.dataset.f === 't-min') el.value = tp.minutes === null ? '' : String(tp.minutes);
  });
  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-f]');
    if (!btn) return;
    const { deck, j } = topicAt(btn);
    if (j === -1) return;
    const f = btn.dataset.f;
    const ts = deck.topics;
    if (f === 't-del') ts.splice(j, 1);
    else if (f === 't-up' && j > 0) [ts[j - 1], ts[j]] = [ts[j], ts[j - 1]];
    else if (f === 't-down' && j < ts.length - 1) [ts[j + 1], ts[j]] = [ts[j], ts[j + 1]];
    else return;
    touch(deck);
    renderTopics();
  });

  $('slide-grid').addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-page]');
    if (!li) return;
    const n = Number(li.dataset.page);
    selectedSlide = selectedSlide === n ? null : n;
    markSlides();
    renderSlidePanel();
    if (selectedSlide !== null) {
      $('slide-panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      $('sp-notes').focus({ preventScroll: true });
    }
  });
  $<HTMLTextAreaElement>('sp-notes').addEventListener('input', (e) => {
    if (selectedSlide === null) return;
    const deck = editing();
    const v = (e.target as HTMLTextAreaElement).value;
    if (v.trim()) deck.slideNotes[selectedSlide] = v; else delete deck.slideNotes[selectedSlide];
    touch(deck);
    markSlides();
  });
}
