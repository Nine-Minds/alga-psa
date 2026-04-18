// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, record);
}

describe('RecurringServicePeriodsTab i18n wiring contract', () => {
  it('T018: page chrome, form labels, schedule option copy, and open-schedule controls resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/RecurringServicePeriodsTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'recurringServicePeriods.title',
      'recurringServicePeriods.description',
      'recurringServicePeriods.fields.scheduleSelect',
      'recurringServicePeriods.fields.scheduleSelectPlaceholder',
      'recurringServicePeriods.fields.scheduleKey',
      'recurringServicePeriods.fields.scheduleKeyPlaceholder',
      'recurringServicePeriods.actions.loadingSchedule',
      'recurringServicePeriods.actions.openSchedule',
      'recurringServicePeriods.errors.enterScheduleKey',
      'recurringServicePeriods.errors.loadFailed',
      'recurringServicePeriods.labels.recurringObligation',
      'recurringServicePeriods.fields.client',
      'recurringServicePeriods.fields.cadenceSource',
      'recurringServicePeriods.fields.billingTiming',
      'recurringServicePeriods.fields.chargeFamily',
      'recurringServicePeriods.fields.scheduleKeyLabel',
      'recurringServicePeriods.values.notLinked',
      'recurringServicePeriods.values.contractAnniversary',
      'recurringServicePeriods.values.clientSchedule',
      'recurringServicePeriods.values.advance',
      'recurringServicePeriods.values.arrears',
      'recurringServicePeriods.values.unknownClient',
      'recurringServicePeriods.values.scheduleOptionLabel',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
