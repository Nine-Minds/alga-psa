// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES_DIR = path.resolve(__dirname, '../../../../server/public/locales');
const locales = fs.readdirSync(LOCALES_DIR).filter(name => fs.existsSync(path.join(LOCALES_DIR, name, 'features/tickets.json')));

const PLURAL_BASES = ['newCount', 'updatedCount', 'focusNew', 'focusUpdated', 'focusNewCapped', 'focusUpdatedCapped'];
const SINGLES = ['refresh', 'showAll', 'updatedBadge', 'boardActivity'];
const REMOVED = ['newOne', 'newMany', 'updatedOne', 'updatedMany', 'both'];

describe('T011: live-change banner and focus notice strings', () => {
  it('covers every locale including xx/yy', () => {
    expect(locales).toEqual(expect.arrayContaining(['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy']));
  });

  it.each(locales)('%s carries the pluralised keys and none of the retired ones', (locale) => {
    const live = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, 'features/tickets.json'), 'utf8')).live as Record<string, unknown>;
    for (const base of PLURAL_BASES) {
      expect(typeof live[`${base}_one`], `${base}_one`).toBe('string');
      expect(typeof live[`${base}_other`], `${base}_other`).toBe('string');
      expect(String(live[`${base}_other`])).toContain('{{count}}');
    }
    for (const key of SINGLES) expect(typeof live[key], key).toBe('string');
    for (const key of REMOVED) expect(live[key], key).toBeUndefined();
  });

  it('Polish carries its few/many plural forms', () => {
    const live = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, 'pl/features/tickets.json'), 'utf8')).live as Record<string, unknown>;
    for (const base of PLURAL_BASES) {
      expect(typeof live[`${base}_few`], `${base}_few`).toBe('string');
      expect(typeof live[`${base}_many`], `${base}_many`).toBe('string');
    }
  });
});
