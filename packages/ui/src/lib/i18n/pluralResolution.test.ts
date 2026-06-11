// @vitest-environment node

import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInstance, type i18n } from 'i18next';

const LOCALES = resolve(__dirname, '../../../../../server/public/locales');
const load = (loc: string, ns: string) =>
  JSON.parse(readFileSync(resolve(LOCALES, loc, `${ns}.json`), 'utf8'));

let i18next: i18n;

beforeAll(async () => {
  i18next = createInstance();
  await i18next.init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: {
        'msp/settings': load('en', 'msp/settings'),
        'msp/profile': load('en', 'msp/profile'),
      },
      pl: {
        'msp/settings': load('pl', 'msp/settings'),
        'msp/profile': load('pl', 'msp/profile'),
      },
    },
  });
});

describe('migrated plural keys resolve via i18next v4 count selection', () => {
  it('T049: teams.details.memberCount pluralizes under en', () => {
    const t = i18next.getFixedT('en', 'msp/settings');
    expect(t('teams.details.memberCount', { count: 1 })).toBe('1 member');
    expect(t('teams.details.memberCount', { count: 5 })).toBe('5 members');
  });

  it('T050: Polish forms resolve for counts 1 (_one), 2 (_few), 5 (_many)', () => {
    const t = i18next.getFixedT('pl', 'msp/settings');
    expect(t('teams.details.memberCount', { count: 1 })).toBe('1 członek');
    expect(t('teams.details.memberCount', { count: 2 })).toBe('2 członków');
    expect(t('teams.details.memberCount', { count: 5 })).toBe('5 członków');
    expect(t('interactions.types.messages.success.imported', { count: 2 })).toBe(
      'Zaimportowano 2 typy interakcji'
    );
    expect(t('interactions.types.messages.success.imported', { count: 5 })).toBe(
      'Zaimportowano 5 typów interakcji'
    );
  });

  it('T051: sessions subtitle interpolates both counts with count-driven plural', () => {
    const t = i18next.getFixedT('en', 'msp/profile');
    expect(t('security.sessions.subtitle', { count: 1, sessionCount: 1, userCount: 1 })).toBe(
      '1 active session across 1 user'
    );
    expect(t('security.sessions.subtitle', { count: 5, sessionCount: 5, userCount: 3 })).toBe(
      '5 active sessions across 3 users'
    );
  });

  it('T052: interaction-types import toast pluralizes under en', () => {
    const t = i18next.getFixedT('en', 'msp/settings');
    expect(t('interactions.types.messages.success.imported', { count: 1 })).toBe(
      'Imported 1 interaction type'
    );
    expect(t('interactions.types.messages.success.imported', { count: 4 })).toBe(
      'Imported 4 interaction types'
    );
  });

  it('T056: pseudo-locale files carry plural-suffixed keys with variables intact', () => {
    const xx = load('xx', 'msp/settings');
    expect(xx.teams.details.memberCount_one).toContain('{{count}}');
    expect(xx.teams.details.memberCount_one).toContain('11111');
    expect(xx.teams.details.memberCount_other).toContain('{{count}}');
    expect(load('yy', 'msp/profile').security.sessions.subtitle_other).toContain('{{sessionCount}}');
  });
});
