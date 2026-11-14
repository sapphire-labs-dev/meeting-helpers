// State shared by the views of the daily page and which view is shown.

import { $ } from '@sapphirelabs/ui/dom';
import { t } from '../../../i18n';
import { load, remove, save } from '@sapphirelabs/ui/storage';
import { isValidSession, type Session } from '../session';
import { parseTeams, type Team, type TeamStore } from '../teams';

const TEAMS_KEY = 'daily:teams';
const SESSION_KEY = 'daily:session';

export const state = {
  teams: { teams: [], activeId: '' } as TeamStore,
  /** The daily in progress, persisted so a reload resumes it. */
  session: null as Session | null,
};

export function loadState(): void {
  state.teams = parseTeams(load<unknown>(TEAMS_KEY, null));
  persistTeams(); // save the cleaned-up copy
  const saved = load<unknown>(SESSION_KEY, null);
  state.session = isValidSession(saved) && saved.current >= 0 ? saved : null;
  persistSession();
}

/** The team selected in the setup view. */
export const team = (): Team => state.teams.teams.find((tm) => tm.id === state.teams.activeId)!;
export const teamName = (tm: Team) => tm.name || t('setup.defaultTeam');

export const persistTeams = () => save(TEAMS_KEY, state.teams);
export const persistSession = () => (state.session ? save(SESSION_KEY, state.session) : remove(SESSION_KEY));

// ───────────── Views ─────────────

export type View = 'setup' | 'run' | 'summary';
const VIEWS: View[] = ['setup', 'run', 'summary'];
const listeners: ((view: View) => void)[] = [];

/** Run `fn` every time a view is shown (e.g. start or stop the clock). */
export const onShow = (fn: (view: View) => void) => listeners.push(fn);

export const isShown = (view: View) => !$(view).hidden;

export function show(view: View): void {
  for (const v of VIEWS) $(v).hidden = v !== view;
  document.body.classList.toggle('running', view === 'run');
  window.scrollTo({ top: 0 });
  for (const fn of listeners) fn(view);
}
