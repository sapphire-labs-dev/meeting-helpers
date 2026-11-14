// Entry point of the presentation page (/present). Each view lives in ui/;
// this file loads the saved state, wires the routes between views and picks
// the first view to show.

import { initI18n } from '../../i18n';
import { bindEditor, openEditor, refreshEditor } from './ui/editor';
import { bindLibrary, renderLibrary } from './ui/library';
import { bindPresenter, enterPresenter, renderPresenter, startPresenting } from './ui/presenter';
import { deckById, go, isShown, loadState, show } from './ui/state';
import { refreshSummary } from './ui/summary';

export function initPresent(): void {
  initI18n();
  loadState();

  Object.assign(go, {
    library: () => { show('library'); renderLibrary(); },
    editor: openEditor,
    present: startPresenting,
    resume: enterPresenter,
  });

  bindLibrary();
  bindEditor();
  bindPresenter();

  window.addEventListener('langchange', () => {
    if (isShown('library')) renderLibrary();
    if (isShown('editor')) refreshEditor();
    if (isShown('presenter')) renderPresenter();
    if (isShown('psummary')) refreshSummary();
  });

  const fromHash = /^#deck=(.+)$/.exec(location.hash)?.[1];
  if (fromHash && deckById(fromHash)) go.editor(fromHash);
  else go.library();
}
