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

  it('T019: summary labels, table headers, and row state chrome resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/RecurringServicePeriodsTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const sourceKeyChecks = [
      'recurringServicePeriods.labels.generated',
      'recurringServicePeriods.labels.edited',
      'recurringServicePeriods.labels.billed',
      'recurringServicePeriods.labels.exceptions',
      'recurringServicePeriods.table.columns.state',
      'recurringServicePeriods.table.columns.servicePeriod',
      'recurringServicePeriods.table.columns.invoiceWindow',
      'recurringServicePeriods.table.columns.revision',
      'recurringServicePeriods.table.columns.reason',
      'recurringServicePeriods.table.columns.allowedActions',
      'recurringServicePeriods.values.range',
      'recurringServicePeriods.values.generatedFromSourceCadence',
    ];
    const localeKeyChecks = [
      ...sourceKeyChecks,
      'recurringServicePeriods.displayStates.generated.label',
      'recurringServicePeriods.displayStates.generated.detail',
      'recurringServicePeriods.displayStates.billed.detailLinked',
      'recurringServicePeriods.displayStates.billed.detailUnlinked',
      'recurringServicePeriods.provenanceReasons.source_rule_changed',
      'recurringServicePeriods.provenanceReasons.initial_materialization',
      'recurringServicePeriods.governanceActions.edit_boundaries',
      'recurringServicePeriods.governanceActions.invoice_linkage_repair',
    ];

    expect(source).toContain('translateDisplayStateLabel');
    expect(source).toContain('translateDisplayStateDetail');
    expect(source).toContain('translateReasonCode');
    expect(source).toContain('translateGovernanceAction');

    for (const key of sourceKeyChecks) {
      expect(source).toContain(key);
    }

    for (const key of localeKeyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T020: repair and regeneration-preview panels resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/RecurringServicePeriodsTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const sourceKeyChecks = [
      'recurringServicePeriods.labels.repairCompleted',
      'recurringServicePeriods.repairPanel.title',
      'recurringServicePeriods.repairPanel.description',
      'recurringServicePeriods.repairPanel.result',
      'recurringServicePeriods.actions.repairMissing',
      'recurringServicePeriods.actions.repairing',
      'recurringServicePeriods.regenerationPreview.title',
      'recurringServicePeriods.regenerationPreview.description',
      'recurringServicePeriods.labels.candidateRecordsJson',
      'recurringServicePeriods.actions.previewRegeneration',
      'recurringServicePeriods.actions.previewing',
      'recurringServicePeriods.labels.conflicts',
      'recurringServicePeriods.values.noConflicts',
      'recurringServicePeriods.errors.candidateRecordsArray',
      'recurringServicePeriods.errors.previewFailed',
      'recurringServicePeriods.errors.repairFailed',
    ];
    const localeKeyChecks = [
      ...sourceKeyChecks,
      'recurringServicePeriods.conflicts.kinds.missing_candidate',
      'recurringServicePeriods.conflicts.kinds.service_period_mismatch',
      'recurringServicePeriods.conflicts.reasons.missing_candidate',
      'recurringServicePeriods.conflicts.reasons.service_period_mismatch',
    ];

    expect(source).toContain('translateConflictKind');
    expect(source).toContain('translateConflictReason');

    for (const key of sourceKeyChecks) {
      expect(source).toContain(key);
    }

    for (const key of localeKeyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
