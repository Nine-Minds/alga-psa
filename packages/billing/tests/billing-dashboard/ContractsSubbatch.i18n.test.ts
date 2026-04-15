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

describe('Contracts i18n wiring contract', () => {
  it('T002: ContractDetail tab labels use msp/contracts translation keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractDetail.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const tabKeyExpectations: Array<[string, string]> = [
      ['contractDetail.tabs.overview', 'Overview'],
      ['contractDetail.tabs.lines', 'Contract Lines'],
      ['contractDetail.tabs.pricing', 'Pricing Schedules'],
      ['contractDetail.tabs.documents', 'Documents'],
      ['contractDetail.tabs.invoices', 'Invoices'],
    ];

    for (const [key, fallback] of tabKeyExpectations) {
      expect(source).toContain(`t('${key}', { defaultValue: '${fallback}' })`);
      expect(getLeaf(en, key)).toBe(fallback);
    }
  });

  it('T003: ContractDetail unsaved + save-success alerts use msp/contracts keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractDetail.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain(
      "t('contractDetail.alerts.unsavedChanges', {"
    );
    expect(source).toContain(
      "t('contractDetail.alerts.saveSuccess', {"
    );

    expect(getLeaf(en, 'contractDetail.alerts.unsavedChanges')).toBe(
      'You have unsaved changes. Click "Save Changes" to apply them.'
    );
    expect(getLeaf(en, 'contractDetail.alerts.saveSuccess')).toBe('Contract saved successfully!');
  });

  it('T004: ContractDetail details-card labels and edit/save/cancel actions use msp/contracts keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractDetail.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keys = [
      'contractDetail.detailsCard.title',
      'contractDetail.detailsCard.contractNameLabel',
      'contractDetail.detailsCard.descriptionLabel',
      'contractDetail.detailsCard.actions.editName',
      'contractDetail.detailsCard.actions.saveName',
      'contractDetail.detailsCard.actions.cancelName',
      'contractDetail.detailsCard.actions.editDescription',
      'contractDetail.detailsCard.actions.saveDescription',
      'contractDetail.detailsCard.actions.cancelDescription',
      'contractDetail.labels.noDescription',
    ];

    for (const key of keys) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T005: ContractDetail header-card status, billing, currency, and renewal labels use msp/contracts keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractDetail.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keyChecks = [
      'contractDetail.headerCard.title',
      'contractDetail.headerCard.assignmentStatus',
      'contractDetail.headerCard.billingFrequencyLabel',
      'common.labels.currency',
      'common.labels.created',
      'common.labels.lastUpdated',
      'contractDetail.headerCard.renewalHeading',
      'contractDetail.headerCard.notice',
      'contractDetail.headerCard.tenantDefaults',
      'contractDetail.headerCard.customSettings',
      'renewal.labels.mode',
      'renewal.labels.source',
      'renewal.labels.decisionDue',
      'status.active',
      'status.draft',
      'status.terminated',
      'status.expired',
      'renewal.modes.auto',
      'renewal.modes.manual',
      'renewal.modes.none',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T006: ContractDetail ownership and assignment cards use translated labels, PO fields, and empty-state copy', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractDetail.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keyChecks = [
      'contractDetail.clientOwnership.title',
      'contractDetail.clientOwnership.systemManaged',
      'contractDetail.clientOwnership.ownerClient',
      'contractDetail.clientOwnership.clientName',
      'contractDetail.clientOwnership.assignmentStatus',
      'contractDetail.clientOwnership.startDate',
      'contractDetail.clientOwnership.endDate',
      'contractDetail.labels.noClientAssigned',
      'contractDetail.clientAssignment.title',
      'contractDetail.clientAssignment.empty',
      'contractDetail.clientAssignment.startDate',
      'contractDetail.clientAssignment.endDate',
      'contractDetail.clientAssignment.required',
      'contractDetail.clientAssignment.notRequired',
      'po.labels.required',
      'po.labels.number',
      'po.labels.amount',
      'common.labels.yes',
      'common.labels.no',
      'common.empty.ongoing',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
