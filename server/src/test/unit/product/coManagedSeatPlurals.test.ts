import { readFileSync } from 'node:fs';
import path from 'node:path';
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

const localesDir = path.resolve(__dirname, '../../../../public/locales');
const load = (locale: string) => JSON.parse(readFileSync(path.join(localesDir, locale, 'msp/licensing.json'), 'utf8'));

describe('co-managed seat counts are pluralized', () => {
  const i18n = i18next.createInstance();

  beforeAll(async () => {
    await i18n.init({
      lng: 'en',
      fallbackLng: false,
      resources: { en: { licensing: load('en') }, de: { licensing: load('de') }, pl: { licensing: load('pl') } },
      ns: ['licensing'],
      defaultNS: 'licensing',
      interpolation: { escapeValue: false },
    });
  });

  it.each([
    ['coManaged.provisioning.capacity', {}, '1 seat available.', '2 seats available.'],
    ['coManaged.provisioning.noSeatsAvailable', {}, 'your 1 purchased seat is allocated', 'all 2 purchased seats are allocated'],
    ['coManaged.monthlyTotal', { amount: '$10' }, '1 seat · $10 per month', '2 seats · $10 per month'],
    ['coManaged.pendingCapacity', {}, 'A purchase of 1 seat is pending.', 'A purchase of 2 seats is pending.'],
    ['coManaged.client.seatAllocation', {}, '1 allocated technician seat', '2 allocated technician seats'],
    ['coManaged.client.seatUsage', { used: 0 }, '0 of 1 technician seat', '0 of 2 technician seats'],
    ['coManaged.shortfall.review', { total: 6 }, 'Add 1 seat to the sponsor pool', 'Add 2 seats to the sponsor pool'],
  ])('%s', (key, params, one, other) => {
    const singular = i18n.t(key, { ...params, count: 1 });
    expect(singular).toContain(one);
    expect(singular).not.toMatch(/\b1 seats\b/);
    expect(i18n.t(key, { ...params, count: 2 })).toContain(other);
  });

  it('uses the locale plural categories beyond one/other', () => {
    expect(i18n.t('coManaged.shortfall.review', { lng: 'pl', count: 3, total: 8 })).toContain('Dodaj 3 miejsca');
    expect(i18n.t('coManaged.shortfall.review', { lng: 'pl', count: 5, total: 10 })).toContain('Dodaj 5 miejsc ');
    expect(i18n.t('coManaged.client.seatAllocation', { lng: 'de', count: 1 })).toBe('1 zugewiesener Technikerplatz');
  });
});
