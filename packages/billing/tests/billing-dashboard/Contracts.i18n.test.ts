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

describe('Contracts list i18n wiring contract', () => {
  it('T025: sub-tab labels, create actions, and search placeholders use msp/contracts keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/Contracts.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'common.tabs.templates',
      'common.tabs.clientContracts',
      'common.tabs.drafts',
      'contractsList.actions.createTemplate',
      'contractsList.actions.createContract',
      'contractsList.actions.quickAdd',
      'contractsList.search.templatesPlaceholder',
      'contractsList.search.templatesAriaLabel',
      'contractsList.search.clientContractsPlaceholder',
      'contractsList.search.clientContractsAriaLabel',
      'contractsList.search.draftsPlaceholder',
      'contractsList.search.draftsAriaLabel',
      'contractsList.drafts.badgeCount',
      'contractsList.heading.title',
      'contractsList.heading.description',
      'contractsList.loading.contracts',
      'contractsList.errors.failedToFetch',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T026: row menus, confirmation dialogs, and toasts use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/Contracts.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keyChecks = [
      'contractsList.actions.openMenu',
      'contractsList.actions.resume',
      'contractsList.actions.terminate',
      'contractsList.actions.restore',
      'contractsList.actions.setToActive',
      'contractsList.actions.deleting',
      'common.actions.edit',
      'common.actions.delete',
      'common.actions.cancel',
      'common.actions.discard',
      'contractsList.dialogs.discardDraft.title',
      'contractsList.dialogs.discardDraft.message',
      'contractsList.dialogs.deleteClient.title',
      'contractsList.dialogs.deleteClient.message',
      'contractsList.dialogs.deleteClient.clientSuffix',
      'contractsList.dialogs.deleteTemplate.title',
      'contractsList.dialogs.deleteTemplate.message',
      'contractsList.toasts.failedToDeleteContract',
      'contractsList.toasts.failedToResumeDraft',
      'contractsList.toasts.draftDiscarded',
      'contractsList.toasts.failedToDiscardDraft',
      'contractsList.toasts.failedToTerminateContract',
      'contractsList.toasts.failedToRestoreContract',
      'contractsList.toasts.failedToActivateContract',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T027: column headers across template/client/draft tables use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/Contracts.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keyChecks = [
      'contractsList.columns.contractName',
      'contractsList.columns.description',
      'contractsList.columns.status',
      'contractsList.columns.actions',
      'contractsList.columns.client',
      'contractsList.columns.sourceTemplate',
      'contractsList.columns.startDate',
      'contractsList.columns.endDate',
      'contractsList.columns.created',
      'contractsList.columns.lastModified',
      'contractsList.empty.noTemplates',
      'contractsList.empty.noClientContracts',
      'contractsList.empty.noDraftMatches',
      'contractsList.empty.noDrafts',
      'contractsList.loading.contracts',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
