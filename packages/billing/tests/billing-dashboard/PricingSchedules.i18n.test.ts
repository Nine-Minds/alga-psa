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

describe('Pricing schedules i18n wiring contract', () => {
  it('T035: list and dialog labels/columns/actions/empty states use translated keys', () => {
    const listSource = read('../../src/components/billing-dashboard/contracts/PricingSchedules.tsx');
    const dialogSource = read('../../src/components/billing-dashboard/contracts/PricingScheduleDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(listSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(dialogSource).toContain("const { t } = useTranslation('msp/contracts');");

    const listKeys = [
      'pricingSchedules.list.title',
      'pricingSchedules.list.columns.effectiveDate',
      'pricingSchedules.list.columns.endDate',
      'pricingSchedules.list.columns.customRate',
      'pricingSchedules.list.columns.notes',
      'pricingSchedules.list.columns.actions',
      'pricingSchedules.list.actions.addSchedule',
      'pricingSchedules.list.actions.editSchedule',
      'pricingSchedules.list.actions.deleteSchedule',
      'pricingSchedules.list.loading',
      'pricingSchedules.list.empty.noPricingSchedules',
      'pricingSchedules.list.empty.description',
      'pricingSchedules.list.timeline.title',
      'pricingSchedules.list.values.ongoing',
      'pricingSchedules.list.values.defaultRate',
      'pricingSchedules.list.values.useDefaultRate',
      'pricingSchedules.list.readOnlyNotice',
      'pricingSchedules.list.dialogs.confirmDeleteSchedule',
      'pricingSchedules.list.errors.failedToLoadPricingSchedules',
      'pricingSchedules.list.errors.failedToDeletePricingSchedule',
      'common.actions.openMenu',
      'common.notAvailable',
    ];

    for (const key of listKeys) {
      expect(listSource).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }

    const dialogKeys = [
      'pricingSchedules.dialog.title.addPricingSchedule',
      'pricingSchedules.dialog.title.editPricingSchedule',
      'pricingSchedules.dialog.actions.cancel',
      'pricingSchedules.dialog.actions.saving',
      'pricingSchedules.dialog.actions.addSchedule',
      'pricingSchedules.dialog.actions.updateSchedule',
      'pricingSchedules.dialog.fields.effectiveDate',
      'pricingSchedules.dialog.fields.useDuration',
      'pricingSchedules.dialog.fields.duration',
      'pricingSchedules.dialog.fields.durationPlaceholder',
      'pricingSchedules.dialog.fields.unit',
      'pricingSchedules.dialog.durationUnits.days',
      'pricingSchedules.dialog.durationUnits.weeks',
      'pricingSchedules.dialog.durationUnits.months',
      'pricingSchedules.dialog.durationUnits.years',
      'pricingSchedules.dialog.fields.hasEndDate',
      'pricingSchedules.dialog.fields.endDate',
      'pricingSchedules.dialog.fields.useDefaultRate',
      'pricingSchedules.dialog.fields.customRate',
      'pricingSchedules.dialog.fields.customRatePlaceholder',
      'pricingSchedules.dialog.fields.notes',
      'pricingSchedules.dialog.fields.notesPlaceholder',
      'pricingSchedules.dialog.validation.effectiveDateRequired',
      'pricingSchedules.dialog.validation.durationRequired',
      'pricingSchedules.dialog.validation.durationPositive',
      'pricingSchedules.dialog.validation.endDateRequiredWhenEnabled',
      'pricingSchedules.dialog.validation.endDateAfterEffectiveDate',
      'pricingSchedules.dialog.validation.customRateRequired',
      'pricingSchedules.dialog.validation.customRatePositive',
      'pricingSchedules.dialog.errors.failedToSavePricingSchedule',
    ];

    for (const key of dialogKeys) {
      expect(dialogSource).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
