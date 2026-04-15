import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('recurring service period sync wiring', () => {
  it('routes live contract-line writes through a cadence-aware sync helper so client cadence materializes without billing-schedule edits', () => {
    const syncSource = readFileSync(
      resolve(__dirname, '../src/actions/recurringServicePeriodSync.ts'),
      'utf8',
    );
    const contractLineActionSource = readFileSync(
      resolve(__dirname, '../src/actions/contractLineAction.ts'),
      'utf8',
    );
    const contractWizardActionsSource = readFileSync(
      resolve(__dirname, '../src/actions/contractWizardActions.ts'),
      'utf8',
    );
    const billingClientsActionsSource = readFileSync(
      resolve(__dirname, '../src/actions/billingClientsActions.ts'),
      'utf8',
    );
    const presetActionsSource = readFileSync(
      resolve(__dirname, '../src/actions/contractLinePresetActions.ts'),
      'utf8',
    );

    expect(syncSource).toContain("import { getClientBillingCycleAnchor } from '@shared/billingClients/billingSchedule';");
    expect(syncSource).toContain('regenerateClientCadenceServicePeriodsForScheduleChange');
    expect(syncSource).toContain('retireFutureClientCadenceRowsForLine');
    expect(syncSource).toContain('await materializeContractCadenceServicePeriodsForContractLine(trx, {');
    expect(syncSource).toContain("if (line.cadence_owner === 'client' && line.owner_client_id) {");
    expect(syncSource).toContain('await regenerateClientCadenceRowsForOwner(trx, {');
    expect(syncSource).toContain('await retireFutureClientCadenceRowsForLine(trx, {');

    expect(contractLineActionSource).toContain("import { syncRecurringServicePeriodsForContractLine } from './recurringServicePeriodSync';");
    expect(contractLineActionSource).toContain('await syncRecurringServicePeriodsForContractLine(trx, {');
    expect(contractLineActionSource).not.toContain('materializeContractCadenceServicePeriodsForContractLine');

    expect(contractWizardActionsSource).toContain("import { syncRecurringServicePeriodsForContract } from './recurringServicePeriodSync';");
    expect(contractWizardActionsSource).toContain("sourceRunPrefix: 'contract_wizard_save'");
    expect(contractWizardActionsSource).toContain('await syncRecurringServicePeriodsForContract(trx, {');

    expect(billingClientsActionsSource).toContain("import { syncRecurringServicePeriodsForContract } from './recurringServicePeriodSync';");
    expect(billingClientsActionsSource).toContain("sourceRunPrefix: 'client_contract_assignment_create'");
    expect(billingClientsActionsSource).toContain("sourceRunPrefix: 'client_contract_assignment_update'");

    expect(presetActionsSource).toContain("import { syncRecurringServicePeriodsForContractLine } from './recurringServicePeriodSync';");
    expect(presetActionsSource).toContain("sourceRunPrefix: 'contract_line_preset_copy'");
    expect(presetActionsSource).toContain("sourceRunPrefix: 'contract_line_custom_create'");
  });
});
