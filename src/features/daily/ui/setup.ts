// Setup view: teams, people, order and time settings, start / resume.

import { $, bold, h } from '@sapphirelabs/ui/dom';
import { getLang, t } from '../../../i18n';
import { newId } from '@sapphirelabs/ui/id';
import { formatShort } from '@sapphirelabs/ui/time';
import { createSession } from '../session';
import { DURATION_MAX, NAME_MAX, newTeam, type Order } from '../teams';
import { renderRun } from './run';
import { unlockAudio } from '@sapphirelabs/ui/sound';
import { persistSession, persistTeams, show, state, team, teamName } from './state';

function renderTeams(): void {
  const { teams, activeId } = state.teams;
  $<HTMLSelectElement>('team-select').replaceChildren(
    ...teams.map((tm) => h('option', { value: tm.id, text: teamName(tm), selected: tm.id === activeId })),
  );
  $<HTMLButtonElement>('team-delete').disabled = teams.length < 2;
}

function renderPeople(): void {
  const people = team().people;
  $('people').replaceChildren(
    ...people.map((p, i) =>
      h('li', { class: p.present ? '' : 'absent', 'data-id': p.id },
        h('input', { type: 'checkbox', checked: p.present, title: t('setup.present'), 'aria-label': `${t('setup.present')}: ${p.name}`, 'data-act': 'present' }),
        h('span', { class: 'pos', text: String(i + 1) }),
        h('input', { type: 'text', class: 'row-input', value: p.name, 'aria-label': p.name, 'data-act': 'rename', maxlength: NAME_MAX }),
        h('button', { type: 'button', class: 'row-btn', title: t('common.moveUp'), 'aria-label': t('common.moveUp'), 'data-act': 'up', disabled: i === 0, text: '↑' }),
        h('button', { type: 'button', class: 'row-btn', title: t('common.moveDown'), 'aria-label': t('common.moveDown'), 'data-act': 'down', disabled: i === people.length - 1, text: '↓' }),
        h('button', { type: 'button', class: 'row-btn', title: t('common.remove'), 'aria-label': `${t('common.remove')} ${p.name}`, 'data-act': 'remove', text: '✕' }),
      ),
    ),
  );
  $('people-empty').hidden = people.length > 0;
  renderCounts();
}

function renderCounts(): void {
  const people = team().people;
  const present = people.filter((p) => p.present).length;
  $('present-count').textContent = people.length ? t('setup.countPresent', { n: present, total: people.length }) : '';

  const s = team().settings;
  const est = $('estimate');
  const speakMin = Math.max(0, s.durationMin - s.bufferMin);
  if (present > 0 && speakMin > 0) {
    const per = formatShort((speakMin * 60000) / present, getLang());
    const [before, after] = t('setup.perPerson', { time: '\u0000' }).split('\u0000');
    est.replaceChildren(before, bold(per), after);
  } else est.replaceChildren();

  $<HTMLButtonElement>('start-btn').disabled = !(present > 0 && s.durationMin > 0);
  $('start-hint').hidden = present > 0 || people.length === 0;
}

function renderSettings(): void {
  const s = team().settings;
  document.querySelectorAll<HTMLInputElement>('input[name="order"]').forEach((r) => { r.checked = r.value === s.order; });
  $<HTMLInputElement>('duration').value = String(s.durationMin);
  $<HTMLInputElement>('buffer').value = String(s.bufferMin);
  $<HTMLInputElement>('adaptive').checked = s.adaptive;
  $<HTMLInputElement>('sound').checked = s.sound;
  markPreset();
}

function markPreset(): void {
  const min = team().settings.durationMin;
  document.querySelectorAll<HTMLButtonElement>('#presets .chip').forEach((c) => c.classList.toggle('on', Number(c.dataset.min) === min));
}

export function renderSetup(): void {
  renderTeams();
  renderPeople();
  renderSettings();
  $('resume-banner').hidden = !(state.session && state.session.current >= 0);
}

function addNames(raw: string): void {
  const names = raw.split(/[\n,;\t]+/).map((n) => n.trim()).filter(Boolean).map((n) => n.slice(0, NAME_MAX));
  if (!names.length) return;
  team().people.push(...names.map((name) => ({ id: newId(), name, present: true })));
  persistTeams();
  renderPeople();
}

function clampInt(v: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startDaily(): void {
  const s = team().settings;
  let names = team().people.filter((p) => p.present).map((p) => p.name);
  if (!names.length) return;
  if (s.order === 'shuffle') names = shuffle(names);
  else if (s.order === 'alpha') names = [...names].sort((a, b) => a.localeCompare(b, getLang(), { sensitivity: 'base' }));
  state.session = createSession(names, { totalMs: s.durationMin * 60000, bufferMs: s.bufferMin * 60000, adaptive: s.adaptive }, Date.now());
  persistSession();
  unlockAudio();
  show('run');
  renderRun();
}

function bindTeams(): void {
  $<HTMLSelectElement>('team-select').addEventListener('change', (e) => {
    state.teams.activeId = (e.target as HTMLSelectElement).value;
    persistTeams();
    renderSetup();
  });
  $('team-new').addEventListener('click', () => {
    const name = prompt(t('setup.teamNamePrompt'))?.trim();
    if (!name) return;
    const tm = newTeam(name.slice(0, NAME_MAX));
    state.teams.teams.push(tm);
    state.teams.activeId = tm.id;
    persistTeams();
    renderSetup();
    $('add-input').focus();
  });
  $('team-rename').addEventListener('click', () => {
    const name = prompt(t('setup.teamNamePrompt'), teamName(team()))?.trim();
    if (!name) return;
    team().name = name.slice(0, NAME_MAX);
    persistTeams();
    renderTeams();
  });
  $('team-delete').addEventListener('click', () => {
    const store = state.teams;
    if (store.teams.length < 2 || !confirm(t('setup.deleteConfirm', { name: teamName(team()) }))) return;
    store.teams = store.teams.filter((tm) => tm.id !== store.activeId);
    store.activeId = store.teams[0].id;
    persistTeams();
    renderSetup();
  });
}

function bindPeople(): void {
  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('add-input');
    addNames(input.value);
    input.value = '';
    input.focus();
  });
  // Pasting a multi-line list adds everyone at once.
  $('add-input').addEventListener('paste', (e) => {
    const text = (e as ClipboardEvent).clipboardData?.getData('text') ?? '';
    if (/[\n,;\t]/.test(text.trim())) {
      e.preventDefault();
      addNames(text);
    }
  });

  const list = $('people');
  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!btn) return;
    const id = btn.closest('li')!.dataset.id!;
    const people = team().people;
    const i = people.findIndex((p) => p.id === id);
    if (i === -1) return;
    const action = btn.dataset.act;
    if (action === 'remove') people.splice(i, 1);
    else if (action === 'up' && i > 0) [people[i - 1], people[i]] = [people[i], people[i - 1]];
    else if (action === 'down' && i < people.length - 1) [people[i + 1], people[i]] = [people[i], people[i + 1]];
    persistTeams();
    renderPeople();
    // Keep focus on the same control so repeated moves work from the keyboard.
    if (action !== 'remove') list.querySelector<HTMLButtonElement>(`li[data-id="${CSS.escape(id)}"] [data-act="${action}"]:not(:disabled)`)?.focus();
  });
  list.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    const person = team().people.find((p) => p.id === el.closest('li')?.dataset.id);
    if (!person) return;
    if (el.dataset.act === 'present') {
      person.present = el.checked;
      el.closest('li')!.classList.toggle('absent', !el.checked);
      persistTeams();
      renderCounts();
    } else if (el.dataset.act === 'rename') {
      const name = el.value.trim().slice(0, NAME_MAX);
      if (name) person.name = name; else el.value = person.name;
      persistTeams();
    }
  });
  list.addEventListener('keydown', (e) => {
    const el = e.target as HTMLInputElement;
    if (e.key === 'Enter' && el.dataset.act === 'rename') el.blur();
  });
}

function bindSettings(): void {
  const settings = () => team().settings;
  document.querySelectorAll<HTMLInputElement>('input[name="order"]').forEach((r) =>
    r.addEventListener('change', () => { settings().order = r.value as Order; persistTeams(); }),
  );
  $<HTMLInputElement>('duration').addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value;
    if (v === '') return;
    settings().durationMin = clampInt(v, 1, DURATION_MAX, settings().durationMin);
    if (settings().bufferMin >= settings().durationMin) {
      settings().bufferMin = Math.max(0, settings().durationMin - 1);
      $<HTMLInputElement>('buffer').value = String(settings().bufferMin);
    }
    markPreset();
    persistTeams();
    renderCounts();
  });
  $<HTMLInputElement>('buffer').addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value;
    if (v === '') return;
    settings().bufferMin = clampInt(v, 0, Math.max(0, settings().durationMin - 1), settings().bufferMin);
    persistTeams();
    renderCounts();
  });
  // Snap typed values back into range when the field loses focus.
  ['duration', 'buffer'].forEach((id) => $(id).addEventListener('blur', renderSettings));
  $('presets').addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('.chip');
    if (!chip) return;
    settings().durationMin = Number(chip.dataset.min);
    if (settings().bufferMin >= settings().durationMin) settings().bufferMin = 0;
    persistTeams();
    renderSettings();
    renderCounts();
  });
  $<HTMLInputElement>('adaptive').addEventListener('change', (e) => { settings().adaptive = (e.target as HTMLInputElement).checked; persistTeams(); });
  $<HTMLInputElement>('sound').addEventListener('change', (e) => { settings().sound = (e.target as HTMLInputElement).checked; persistTeams(); });
}

export function bindSetup(): void {
  bindTeams();
  bindPeople();
  bindSettings();
  $('start-btn').addEventListener('click', startDaily);
  $('resume-btn').addEventListener('click', () => { if (state.session) { unlockAudio(); show('run'); renderRun(); } });
  $('discard-btn').addEventListener('click', () => { state.session = null; persistSession(); renderSetup(); });
}
