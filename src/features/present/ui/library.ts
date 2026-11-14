// Library view: the decks stored in this browser, PDF import and delete.

import { $, formatBytes, h } from '@sapphirelabs/ui/dom';
import { t } from '../../../i18n';
import { newId } from '@sapphirelabs/ui/id';
import { deleteFile, putFile, requestPersistence } from '../files';
import { newDeck } from '../model';
import { extractTitles, isPdfHeader, MAX_PDF_BYTES, openPdf, rememberPdf, type Pdf } from '../pdf';
import { deckById, go, persistDecks, persistRun, state } from './state';
import { thumbnail } from './thumbnails';

export function renderLibrary(): void {
  const sorted = [...state.decks].sort((a, b) => b.updatedAt - a.updatedAt);
  $('deck-list-label').hidden = sorted.length === 0;
  $('deck-list').replaceChildren(
    ...sorted.map((d) =>
      h('li', { class: 'card' },
        h('div', { class: 'cover' }, thumbnail(d.fileId, 1, 360, 203)),
        h('h3', { text: d.name }),
        h('p', { class: 'meta', text: `${t('lib.slides', { n: d.pages })} · ${d.totalMin} min · ${formatBytes(d.fileSize)}` }),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn small', 'data-act': 'present', 'data-id': d.id, text: t('lib.present') }),
          h('button', { type: 'button', class: 'btn small ghost', 'data-act': 'edit', 'data-id': d.id, text: t('lib.edit') }),
          h('button', { type: 'button', class: 'btn small ghost', 'data-act': 'delete', 'data-id': d.id, text: t('lib.delete') }),
        ),
      ),
    ),
  );
  const run = state.run;
  $('lib-resume').hidden = !(run && !run.endedAt && deckById(run.deckId));
}

function showError(msg: string | null): void {
  const el = $('lib-error');
  el.hidden = !msg;
  el.textContent = msg ?? '';
}

async function importFile(file: File): Promise<void> {
  showError(null);
  if (file.size > MAX_PDF_BYTES) { showError(t('lib.tooBig', { max: formatBytes(MAX_PDF_BYTES) })); return; }
  if (!isPdfHeader(await file.slice(0, 5).arrayBuffer())) { showError(t('lib.notPdf')); return; }

  const drop = $('drop');
  const label = $('drop-label');
  drop.classList.add('busy');
  label.textContent = t('lib.importing');
  try {
    let pdf: Pdf;
    try {
      pdf = await openPdf(await file.arrayBuffer());
    } catch {
      showError(t('lib.importError'));
      return;
    }
    const titles = await extractTitles(pdf);
    const fileId = newId();
    try {
      await putFile(fileId, file);
    } catch {
      showError(t('lib.storageError'));
      return;
    }
    requestPersistence();
    const deck = newDeck(fileId, file.name, file.size, pdf.numPages, titles);
    rememberPdf(fileId, pdf);
    state.decks.push(deck);
    persistDecks();
    go.editor(deck.id);
  } finally {
    drop.classList.remove('busy');
    label.textContent = t('lib.drop');
  }
}

async function deleteDeck(id: string): Promise<void> {
  const d = deckById(id);
  if (!d || !confirm(t('lib.deleteConfirm', { name: d.name }))) return;
  state.decks = state.decks.filter((x) => x.id !== id);
  persistDecks();
  if (state.run?.deckId === id) { state.run = null; persistRun(); }
  await deleteFile(d.fileId).catch(() => {});
  renderLibrary();
}

export function bindLibrary(): void {
  const input = $<HTMLInputElement>('file-input');
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void importFile(f);
    input.value = '';
  });
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f) void importFile(f);
  });
  $('deck-list').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id!;
    if (btn.dataset.act === 'edit') go.editor(id);
    else if (btn.dataset.act === 'present') go.present(id);
    else if (btn.dataset.act === 'delete') void deleteDeck(id);
  });
  $('lib-resume-btn').addEventListener('click', () => { if (state.run) go.resume(); });
  $('lib-discard-btn').addEventListener('click', () => { state.run = null; persistRun(); renderLibrary(); });
}
