import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translationProblems, usedI18nKeys } from '@sapphirelabs/ui/testing';
import { TEMPLATES } from '../features/retro/model';
import { dict } from './index';

describe('translations', () => {
  it('are complete, consistent and cover every key the code uses', () => {
    const used = usedI18nKeys(fileURLToPath(new URL('../', import.meta.url)));
    expect(used.size).toBeGreaterThan(50); // sanity check that the scan found the code
    expect(translationProblems(dict, used)).toEqual([]);
  });

  it('has a title for every retro column (keys built at runtime)', () => {
    const kinds = Object.values(TEMPLATES).flat();
    expect(kinds.filter((k) => !(`retro.col.${k}` in dict.en))).toEqual([]);
  });
});
