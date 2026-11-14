// All strings of the site: shared layout words from @sapphirelabs/ui plus
// one group per area. `t()` only accepts keys defined here.
import { createTranslator, mergeStrings, uiStrings } from '@sapphirelabs/ui/i18n';
import { common } from './common';
import { daily } from './daily';
import { pomodoro } from './pomodoro';
import { present } from './present';
import { retro } from './retro';

export const dict = mergeStrings(uiStrings, common, daily, present, retro, pomodoro);
export type Key = keyof typeof dict.en & string;
export const t = createTranslator(dict);

export { applyTitle, getLang, initI18n, locale } from '@sapphirelabs/ui/i18n';
