import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localeRoot = path.resolve(__dirname, '../../../../../server/public/locales');

const REQUIRED_LOCALES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt'];

const REQUIRED_DEVICE_KEYS = [
  'devices.statusOkTitle',
  'devices.statusOkBody',
  'devices.statusWarnTitle',
  'devices.statusWarnBody',
  'devices.status.active',
  'devices.status.inactive',
  'devices.searchPlaceholder',
  'devices.filters.allTypes',
  'devices.filters.allStatuses',
  'devices.clearFilters',
  'devices.columns.name',
  'devices.columns.type',
  'devices.columns.status',
  'devices.columns.location',
  'devices.columns.updated',
  'devices.notAvailable',
  'devices.detailsTitle',
  // FR-C6 / FR-E7b: the device list's Assigned-to column shares these with the
  // details panel.
  'assets.columns.assignedTo',
  'assets.unassigned',
  'assets.sharedWorkspace',
  'dashboard.timeAgo.justNow',
  'dashboard.timeAgo.minutes',
  'dashboard.timeAgo.hours',
  'dashboard.timeAgo.days',
  // F021: the dashboard widget has no status vocabulary of its own any more —
  // it reads a slug through the same labels as the list and the details panel.
  'assets.statuses.active',
  'assets.statuses.inactive',
  'assets.statuses.maintenance',
];

const REQUIRED_APPT_KEYS = [
  'calendar.label',
  'calendar.previousMonth',
  'calendar.nextMonth',
  'calendar.cellWithCount',
  'calendar.moreAria',
];

function getKey(obj: unknown, dotted: string): string | undefined {
  const parts = dotted.split('.');
  let cur: any = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
    else return undefined;
  }
  return typeof cur === 'string' ? cur : undefined;
}

function loadJson(locale: string, file: string) {
  return JSON.parse(
    fs.readFileSync(path.join(localeRoot, locale, file), 'utf8'),
  );
}

describe('client portal devices/calendar locale coverage', () => {
  it.each(REQUIRED_LOCALES)('locale %s contains every required client-portal key', (locale) => {
    const data = loadJson(locale, 'client-portal.json');
    for (const key of REQUIRED_DEVICE_KEYS) {
      const value = getKey(data, key);
      expect(value, `${locale}/client-portal.json missing ${key}`).toBeTruthy();
    }
  });

  it.each(REQUIRED_LOCALES)('locale %s contains every required appointments calendar key', (locale) => {
    const data = loadJson(locale, 'features/appointments.json');
    for (const key of REQUIRED_APPT_KEYS) {
      const value = getKey(data, key);
      expect(value, `${locale}/features/appointments.json missing ${key}`).toBeTruthy();
    }
  });

  it('does not retain the old "Healthy" English label', () => {
    const data = loadJson('en', 'client-portal.json');
    expect(data.devices.statusOkTitle).not.toMatch(/healthy/i);
    expect(data.assets.statuses.active).toBe('Active');
  });

  it.each(REQUIRED_LOCALES)('locale %s has retired the widget-only status labels', (locale) => {
    // The "Your devices" widget used to say Active/Inactive/Healthy on its own
    // terms, which is how a custom status read "Aktiv" on the dashboard.
    const devices = loadJson(locale, 'client-portal.json').dashboard.devices;
    expect(Object.keys(devices)).not.toContain('healthy');
    expect(Object.keys(devices)).not.toContain('active');
    expect(Object.keys(devices)).not.toContain('inactive');
  });
});
