// Teams for the daily timer: who is in each team and how their daily runs.
// Pure data (no DOM), stored in localStorage as a TeamStore.

import { clampNumber, cleanString, isNonEmptyString, isObject, oneOf } from '@sapphirelabs/ui/check';
import { newId } from '@sapphirelabs/ui/id';

export const ORDERS = ['shuffle', 'saved', 'alpha'] as const;
export type Order = (typeof ORDERS)[number];

export interface Person { id: string; name: string; present: boolean }
export interface TeamSettings { order: Order; durationMin: number; bufferMin: number; adaptive: boolean; sound: boolean }
export interface Team { id: string; name: string; people: Person[]; settings: TeamSettings }
export interface TeamStore { teams: Team[]; activeId: string }

export const NAME_MAX = 60;
export const DURATION_MAX = 240;

export const defaultSettings = (): TeamSettings => ({ order: 'shuffle', durationMin: 15, bufferMin: 0, adaptive: true, sound: true });

/** An empty name means "the default team name" so it follows the language. */
export const newTeam = (name = ''): Team => ({ id: newId(), name, people: [], settings: defaultSettings() });

/** Older versions stored the translated default name; it is stored empty now. */
const DEFAULT_TEAM_NAMES = ['My team', 'Meu time'];

function parseSettings(x: unknown): TeamSettings {
  const d = defaultSettings();
  if (!isObject(x)) return d;
  const durationMin = Math.round(clampNumber(x.durationMin, 1, DURATION_MAX, d.durationMin));
  return {
    order: oneOf(x.order, ORDERS, d.order),
    durationMin,
    bufferMin: Math.round(clampNumber(x.bufferMin, 0, durationMin - 1, d.bufferMin)),
    adaptive: typeof x.adaptive === 'boolean' ? x.adaptive : d.adaptive,
    sound: typeof x.sound === 'boolean' ? x.sound : d.sound,
  };
}

function parsePerson(x: unknown): Person | null {
  if (!isObject(x) || !isNonEmptyString(x.name)) return null;
  return {
    id: isNonEmptyString(x.id) ? x.id : newId(),
    name: cleanString(x.name, NAME_MAX),
    present: typeof x.present === 'boolean' ? x.present : true,
  };
}

function parseTeam(x: unknown): Team | null {
  if (!isObject(x)) return null;
  const name = cleanString(x.name, NAME_MAX);
  return {
    id: isNonEmptyString(x.id) ? x.id : newId(),
    name: DEFAULT_TEAM_NAMES.includes(name) ? '' : name,
    people: Array.isArray(x.people) ? x.people.map(parsePerson).filter((p): p is Person => p !== null) : [],
    settings: parseSettings(x.settings),
  };
}

/** Rebuild the team store from whatever was saved; never throws, always has a team. */
export function parseTeams(raw: unknown): TeamStore {
  const teams = isObject(raw) && Array.isArray(raw.teams)
    ? raw.teams.map(parseTeam).filter((tm): tm is Team => tm !== null)
    : [];
  if (!teams.length) teams.push(newTeam());
  const activeId = isObject(raw) && teams.some((tm) => tm.id === raw.activeId) ? (raw.activeId as string) : teams[0].id;
  return { teams, activeId };
}
