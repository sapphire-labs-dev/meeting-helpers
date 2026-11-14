// Entry point of the daily page (/daily). Each view lives in ui/; this file
// loads the saved state, binds the views and shows the setup.

import { $ } from '@sapphirelabs/ui/dom';
import { initI18n } from '../../i18n';
import { bindRun, renderRun } from './ui/run';
import { bindSetup, renderSetup } from './ui/setup';
import { isShown, loadState, persistSession, show, state, team } from './ui/state';
import { showSummary } from './ui/summary';

export function initDaily(): void {
  initI18n();
  loadState();

  bindSetup();
  bindRun();
  $('again-btn').addEventListener('click', () => { state.session = null; persistSession(); renderSetup(); show('setup'); });

  window.addEventListener('langchange', () => {
    renderSetup();
    if (isShown('run')) renderRun();
    if (isShown('summary')) showSummary();
  });

  renderSetup();
  show('setup');
  if (team().people.length === 0) $('add-input').focus();
}
