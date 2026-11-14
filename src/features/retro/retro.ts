// Retrospective board page (/retro): list of saved boards and the board view.

import { $, bindCopyButton, downloadText, h } from '@sapphirelabs/ui/dom';
import { load, save } from '@sapphirelabs/ui/storage';
import { newId } from '@sapphirelabs/ui/id';
import { applyTitle, initI18n, locale, t, type Key } from '../../i18n';
import {
  addCards, cardCount, CARD_MAX, findCard, moveCard, NAME_MAX, newRetro, orderedCards, OWNER_MAX, parseRetros, TEMPLATE_IDS,
  toMarkdown, vote, type Column, type Retro, type TemplateId,
} from './model';

const KEY = 'retro:boards';
const PREFS_KEY = 'retro:sortByVotes';
let retros: Retro[] = [];
let openId: string | null = null;
let byVotes = false;

const persist = () => save(KEY, retros);
const current = () => retros.find((r) => r.id === openId) ?? null;
const columnTitle = (col: Column) => t(`retro.col.${col.kind}` as Key);
const retroName = (r: Retro) => r.name || t('retro.untitled');
const formatDate = (ms: number) => new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });

function touch(r: Retro): void {
  r.updatedAt = Date.now();
  persist();
}

// ───────────── List ─────────────

function showList(): void {
  openId = null;
  setFocusMode(false);
  $('list').hidden = false;
  $('board').hidden = true;
  if (location.hash) history.replaceState(null, '', location.pathname);
  applyTitle();
  renderList();
}

function renderList(): void {
  const sorted = [...retros].sort((a, b) => b.updatedAt - a.updatedAt);
  $('retros-label').hidden = !sorted.length;
  $('retros').replaceChildren(...sorted.map((r) =>
    h('li', { 'data-id': r.id },
      h('span', { class: 'r-name', text: retroName(r) }),
      h('span', { class: 'r-meta', text: `${formatDate(r.createdAt)} · ${t('retro.cards', { n: cardCount(r) })}` }),
      h('button', { type: 'button', class: 'btn small', 'data-act': 'open', text: t('retro.open') }),
      h('button', { type: 'button', class: 'row-btn danger', 'data-act': 'delete', title: t('retro.delete'), 'aria-label': `${t('retro.delete')} ${retroName(r)}`, text: '✕' }),
    ),
  ));
}

function deleteRetro(id: string): void {
  const r = retros.find((x) => x.id === id);
  if (!r || !confirm(t('retro.deleteConfirm', { name: retroName(r) }))) return;
  retros = retros.filter((x) => x.id !== id);
  persist();
  if (openId === id) showList(); else renderList();
}

// ───────────── Board ─────────────

function openBoard(id: string): void {
  if (!retros.some((r) => r.id === id)) { showList(); return; }
  openId = id;
  $('list').hidden = true;
  $('board').hidden = false;
  history.replaceState(null, '', `#retro=${id}`);
  window.scrollTo({ top: 0 });
  renderBoard();
}

function renderBoard(): void {
  const r = current();
  if (!r) return;
  const name = $<HTMLInputElement>('board-name');
  if (document.activeElement !== name) name.value = r.name;
  name.placeholder = t('retro.untitled');
  $('board-date').textContent = formatDate(r.createdAt);
  $<HTMLInputElement>('sort-votes').checked = byVotes;
  applyTitle(`${retroName(r)} · ${t('nav.retro')}`);
  renderColumns();
  renderActions();
}

function cardItem(r: Retro, colIndex: number, card: { id: string; text: string; votes: number }): HTMLLIElement {
  const last = r.columns.length - 1;
  return h('li', { class: `retro-card${card.votes ? ' voted' : ''}`, 'data-card': card.id },
    h('textarea', { class: 'card-text', rows: 1, maxlength: CARD_MAX, 'aria-label': t('retro.cardText'), 'data-act': 'text', value: card.text }),
    h('div', { class: 'card-bar' },
      h('span', { class: 'votes' },
        h('button', { type: 'button', class: 'row-btn', 'data-act': 'down', title: t('retro.voteDown'), 'aria-label': t('retro.voteDown'), disabled: card.votes === 0, text: '−' }),
        h('b', { class: card.votes ? '' : 'zero', title: t('retro.votes', { n: card.votes }), text: String(card.votes) }),
        h('button', { type: 'button', class: 'row-btn', 'data-act': 'up', title: t('retro.voteUp'), 'aria-label': t('retro.voteUp'), text: '+' }),
      ),
      h('button', { type: 'button', class: 'row-btn', 'data-act': 'left', title: t('retro.moveLeft'), 'aria-label': t('retro.moveLeft'), disabled: colIndex === 0, text: '←' }),
      h('button', { type: 'button', class: 'row-btn', 'data-act': 'right', title: t('retro.moveRight'), 'aria-label': t('retro.moveRight'), disabled: colIndex === last, text: '→' }),
      h('button', { type: 'button', class: 'row-btn danger', 'data-act': 'remove', title: t('common.remove'), 'aria-label': t('common.remove'), text: '✕' }),
    ),
  );
}

function renderColumns(): void {
  const r = current()!;
  const box = $('columns');
  // Keep focus on the same control across re-renders (keyboard voting).
  const active = document.activeElement as HTMLElement | null;
  const focusCard = active?.closest<HTMLElement>('[data-card]')?.dataset.card;
  const focusAct = active?.dataset.act;
  const focusCol = active?.closest<HTMLElement>('[data-col]')?.dataset.col;
  const addFocused = active?.classList.contains('add-card');

  box.style.setProperty('--cols', String(r.columns.length));
  box.replaceChildren(...r.columns.map((col, ci) => {
    const cards = orderedCards(col, byVotes);
    return h('section', { class: 'card column', 'data-col': col.id },
      h('div', { class: 'col-head' }, h('h2', { text: columnTitle(col) }), h('span', { class: 'col-count', text: String(col.cards.length) })),
      h('form', { class: 'add-row', 'data-act': 'add' },
        h('input', { type: 'text', class: 'add-card', maxlength: 5000, autocomplete: 'off', placeholder: t('retro.addCard'), 'aria-label': `${t('retro.addCard')} · ${columnTitle(col)}` }),
        h('button', { type: 'submit', class: 'btn small', text: t('common.add') }),
      ),
      cards.length
        ? h('ul', { class: 'cards' }, ...cards.map((cd) => cardItem(r, ci, cd)))
        : h('p', { class: 'empty', text: t('retro.empty') }),
    );
  }));

  if (focusCard && focusAct) box.querySelector<HTMLElement>(`[data-card="${CSS.escape(focusCard)}"] [data-act="${focusAct}"]:not(:disabled)`)?.focus();
  else if (addFocused && focusCol) box.querySelector<HTMLElement>(`[data-col="${CSS.escape(focusCol)}"] .add-card`)?.focus();
}

function renderActions(): void {
  const r = current()!;
  const list = $('actions');
  const active = document.activeElement as HTMLElement | null;
  const focusId = active?.closest<HTMLElement>('[data-id]')?.dataset.id;
  const focusAct = active?.dataset.act;
  list.replaceChildren(...r.actions.map((a) =>
    h('li', { class: a.done ? 'done' : '', 'data-id': a.id },
      h('input', { type: 'checkbox', checked: a.done, title: t('retro.actionDone'), 'aria-label': `${t('retro.actionDone')}: ${a.text}`, 'data-act': 'done' }),
      h('input', { type: 'text', class: 'row-input', value: a.text, maxlength: CARD_MAX, 'aria-label': a.text, 'data-act': 'text' }),
      h('input', { type: 'text', class: 'row-input owner', value: a.owner, maxlength: OWNER_MAX, placeholder: t('retro.ownerPlaceholder'), 'aria-label': t('retro.owner'), 'data-act': 'owner' }),
      h('button', { type: 'button', class: 'row-btn danger', 'data-act': 'remove', title: t('common.remove'), 'aria-label': `${t('common.remove')} ${a.text}`, text: '✕' }),
    ),
  ));
  $('actions-empty').hidden = r.actions.length > 0;
  if (focusId && focusAct) list.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"] [data-act="${focusAct}"]`)?.focus();
}

function markdown(r: Retro): string {
  return toMarkdown(r, {
    title: columnTitle,
    actions: t('retro.actions'),
    owner: t('retro.owner'),
    date: formatDate(r.createdAt),
    votes: (n) => t('retro.votes', { n }),
  });
}

function setFocusMode(on: boolean): void {
  document.body.classList.toggle('running', on);
  $('focus-btn').textContent = on ? t('retro.exitFocus') : t('retro.focus');
}

// ───────────── Events ─────────────

function bindList(): void {
  $('new-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $<HTMLInputElement>('new-name');
    const picked = document.querySelector<HTMLInputElement>('input[name="template"]:checked')?.value;
    const template = (TEMPLATE_IDS as string[]).includes(picked ?? '') ? (picked as TemplateId) : 'wwi';
    const r = newRetro(name.value.slice(0, NAME_MAX), template, Date.now());
    retros.push(r);
    persist();
    name.value = '';
    openBoard(r.id);
  });
  $('retros').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    const id = btn?.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!btn || !id) return;
    if (btn.dataset.act === 'open') openBoard(id);
    else if (btn.dataset.act === 'delete') deleteRetro(id);
  });
}

function bindBoard(): void {
  $('back-btn').addEventListener('click', showList);
  $('delete-btn').addEventListener('click', () => { if (openId) deleteRetro(openId); });
  $<HTMLInputElement>('board-name').addEventListener('input', (e) => {
    const r = current();
    if (!r) return;
    r.name = (e.target as HTMLInputElement).value.trim().slice(0, NAME_MAX);
    touch(r);
    applyTitle(`${retroName(r)} · ${t('nav.retro')}`);
  });
  $<HTMLInputElement>('sort-votes').addEventListener('change', (e) => {
    byVotes = (e.target as HTMLInputElement).checked;
    save(PREFS_KEY, byVotes);
    renderColumns();
  });
  $('focus-btn').addEventListener('click', () => setFocusMode(!document.body.classList.contains('running')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('running')) setFocusMode(false);
  });
  bindCopyButton($<HTMLButtonElement>('copy-md'), () => { const r = current(); return r ? markdown(r) : ''; }, () => t('common.copied'));
  $('download-md').addEventListener('click', () => {
    const r = current();
    if (!r) return;
    const slug = retroName(r).toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'retro';
    downloadText(`${slug}.md`, markdown(r), 'text/markdown');
  });

  const columns = $('columns');
  const colOf = (el: Element) => current()?.columns.find((c) => c.id === el.closest<HTMLElement>('[data-col]')?.dataset.col);
  columns.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.querySelector<HTMLInputElement>('.add-card')!;
    const col = colOf(form);
    if (!col || !addCards(col, input.value)) return;
    input.value = '';
    touch(current()!);
    renderColumns();
    columns.querySelector<HTMLInputElement>(`[data-col="${CSS.escape(col.id)}"] .add-card`)?.focus();
  });
  // Pasting the chat (several lines) adds one card per line at once.
  columns.addEventListener('paste', (e) => {
    const input = e.target as HTMLElement;
    if (!input.classList.contains('add-card')) return;
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/\r?\n/.test(text.trim())) return;
    e.preventDefault();
    const col = colOf(input);
    if (!col || !addCards(col, text)) return;
    touch(current()!);
    renderColumns();
    columns.querySelector<HTMLInputElement>(`[data-col="${CSS.escape(col.id)}"] .add-card`)?.focus();
  });
  columns.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    const id = btn?.closest<HTMLElement>('[data-card]')?.dataset.card;
    const r = current();
    if (!btn || !id || !r) return;
    const found = findCard(r, id);
    if (!found) return;
    const act = btn.dataset.act;
    if (act === 'up') vote(found.card, 1);
    else if (act === 'down') vote(found.card, -1);
    else if (act === 'left' || act === 'right') moveCard(r, id, act === 'left' ? -1 : 1);
    else if (act === 'remove') found.col.cards.splice(found.index, 1);
    else return;
    touch(r);
    renderColumns();
  });
  columns.addEventListener('input', (e) => {
    const el = e.target as HTMLTextAreaElement;
    const id = el.closest<HTMLElement>('[data-card]')?.dataset.card;
    const r = current();
    if (el.dataset.act !== 'text' || !id || !r) return;
    const found = findCard(r, id);
    const text = el.value.replace(/\s+/g, ' ').trim().slice(0, CARD_MAX);
    if (found && text) { found.card.text = text; touch(r); }
  });
  columns.addEventListener('focusout', (e) => {
    const el = e.target as HTMLTextAreaElement;
    const id = el.closest<HTMLElement>('[data-card]')?.dataset.card;
    const found = id && current() ? findCard(current()!, id) : null;
    if (el.dataset.act === 'text' && found) el.value = found.card.text;
  });
  columns.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (e.key === 'Enter' && !e.shiftKey && el.dataset.act === 'text') { e.preventDefault(); el.blur(); }
  });

  $('action-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('action-input');
    const r = current();
    const text = input.value.trim().slice(0, CARD_MAX);
    if (!r || !text) return;
    r.actions.push({ id: newId(), text, owner: '', done: false });
    input.value = '';
    touch(r);
    renderActions();
    $('actions').querySelector<HTMLInputElement>('li:last-child .owner')?.focus();
  });
  const actions = $('actions');
  const actionOf = (el: Element) => {
    const r = current();
    const id = el.closest<HTMLElement>('[data-id]')?.dataset.id;
    const i = r ? r.actions.findIndex((a) => a.id === id) : -1;
    return { r, i, a: r?.actions[i] };
  };
  actions.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    const { r, a } = actionOf(el);
    if (!r || !a) return;
    if (el.dataset.act === 'done') a.done = el.checked;
    else if (el.dataset.act === 'text') { const v = el.value.trim().slice(0, CARD_MAX); if (v) a.text = v; }
    else if (el.dataset.act === 'owner') a.owner = el.value.trim().slice(0, OWNER_MAX);
    touch(r);
    renderActions();
  });
  actions.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act="remove"]');
    if (!btn) return;
    const { r, i } = actionOf(btn);
    if (!r || i === -1) return;
    r.actions.splice(i, 1);
    touch(r);
    renderActions();
  });
  actions.addEventListener('keydown', (e) => {
    const el = e.target as HTMLInputElement;
    if (e.key === 'Enter' && (el.dataset.act === 'text' || el.dataset.act === 'owner')) el.blur();
  });
}

export function initRetro(): void {
  initI18n();
  retros = parseRetros(load<unknown>(KEY, null));
  persist();
  byVotes = load<unknown>(PREFS_KEY, false) === true;

  bindList();
  bindBoard();
  window.addEventListener('langchange', () => {
    if (current()) { renderBoard(); setFocusMode(document.body.classList.contains('running')); } else renderList();
  });

  const fromHash = /^#retro=(.+)$/.exec(location.hash)?.[1];
  if (fromHash && retros.some((r) => r.id === fromHash)) openBoard(fromHash);
  else showList();
}
