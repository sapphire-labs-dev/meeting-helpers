// Summary view shown when the daily ends: total vs plan, time per person.

import { $, h } from '@sapphirelabs/ui/dom';
import { getLang, t } from '../../../i18n';
import { formatClock, formatShort } from '@sapphirelabs/ui/time';
import { elapsedOf, usedTotal, type Session } from '../session';
import { show, state } from './state';

export const displayName = (s: Session, i: number) =>
  (s.speakers[i].kind === 'buffer' ? t('run.generalTopics') : s.speakers[i].name);

export function showSummary(): void {
  const s = state.session;
  if (!s) return;
  const now = s.endedAt ?? Date.now();
  const total = usedTotal(s, now);
  $('sum-total').textContent = formatClock(total);
  $('sum-planned').textContent = t('common.planned', { time: formatClock(s.totalMs) });
  const late = total - s.totalMs;
  const card = $('sum-verdict-card');
  card.classList.toggle('ok', late <= 999);
  card.classList.toggle('late', late > 999);
  $('sum-verdict').textContent = late > 999 ? t('common.late', { time: formatShort(late, getLang()) }) : t('common.onTime');

  const maxMs = Math.max(1, ...s.speakers.map((sp, i) => Math.max(elapsedOf(s, i, now), sp.slotMs ?? 0)));
  $('sum-rows').replaceChildren(
    ...s.speakers
      .map((sp, i) => ({ sp, i }))
      .filter(({ sp }) => !(sp.kind === 'buffer' && sp.status !== 'done'))
      .map(({ sp, i }) => {
        const used = elapsedOf(s, i, now);
        const slot = sp.slotMs ?? 0;
        const over = sp.status !== 'skipped' && used > slot + 999;
        const mini = h('div', { class: `mini${over ? ' over' : ''}` }, h('span'));
        (mini.firstChild as HTMLElement).style.width = `${(used / maxMs) * 100}%`;
        return h('tr', { class: sp.status === 'skipped' ? 'skipped' : '' },
          h('td', { text: displayName(s, i) }),
          h('td', { class: `mono${over ? ' over' : ''}`, text: sp.status === 'skipped' && used === 0 ? t('run.skipped') : formatClock(used) }),
          h('td', { class: 'mono', text: slot ? formatClock(slot) : '–' }),
          h('td', {}, mini),
        );
      }),
  );
  show('summary');
}
