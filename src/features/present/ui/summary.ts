// Summary view shown when a presentation ends: total vs plan, time per topic.

import { $, h } from '@sapphirelabs/ui/dom';
import { getLang, t } from '../../../i18n';
import { formatClock, formatShort } from '@sapphirelabs/ui/time';
import { plan, topicUsed, totalMs, totalUsed, type Deck, type Run } from '../model';
import { go, show } from './state';

let last: { deck: Deck; run: Run } | null = null;

export function showSummary(deck: Deck, r: Run): void {
  last = { deck, run: r };
  const now = r.endedAt ?? Date.now();
  const total = totalUsed(r, now);
  const planned = totalMs(deck);
  $('ps-total').textContent = formatClock(total);
  $('ps-planned').textContent = t('common.planned', { time: formatClock(planned) });
  const late = total - planned;
  const card = $('ps-verdict-card');
  card.classList.toggle('ok', late <= 999);
  card.classList.toggle('late', late > 999);
  $('ps-verdict').textContent = late > 999 ? t('common.late', { time: formatShort(late, getLang()) }) : t('common.onTime');

  const { topicMs } = plan(deck);
  const usedAll = deck.topics.map((_, j) => topicUsed(deck, r, j, now));
  const maxMs = Math.max(1, ...usedAll, ...topicMs);
  $('ps-rows').replaceChildren(
    ...deck.topics.map((tp, j) => {
      const used = usedAll[j];
      const over = used > topicMs[j] + 999;
      const mini = h('div', { class: `mini${over ? ' over' : ''}` }, h('span'));
      (mini.firstChild as HTMLElement).style.width = `${Math.min(100, (used / maxMs) * 100)}%`;
      return h('tr', {},
        h('td', { text: tp.text }),
        h('td', { class: `mono${over ? ' over' : ''}`, text: formatClock(used) }),
        h('td', { class: 'mono', text: formatClock(topicMs[j]) }),
        h('td', {}, mini),
      );
    }),
  );
  $('ps-rows').closest<HTMLElement>('.table-card')!.hidden = deck.topics.length === 0;
  $('ps-back').onclick = () => go.editor(deck.id);
  show('psummary');
}

/** Re-render with the current language. */
export function refreshSummary(): void {
  if (last) showSummary(last.deck, last.run);
}
