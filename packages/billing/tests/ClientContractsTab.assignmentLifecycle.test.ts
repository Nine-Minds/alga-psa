import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ClientContractsTab.tsx', import.meta.url),
  'utf8'
);

const contractsListSource = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/Contracts.tsx', import.meta.url),
  'utf8'
);

const billingClientsActionsSource = readFileSync(
  new URL('../src/actions/billingClientsActions.ts', import.meta.url),
  'utf8'
);

describe('ClientContractsTab assignment lifecycle wiring', () => {
  it('T025: renders assignment-first status and template copy for client-owned contracts', () => {
    expect(source).toContain("title: t('clientContracts.columns.sourceTemplate', { defaultValue: 'Source Template' }),");
    expect(source).toContain("dataIndex: 'assignment_status'");
    expect(source).toContain("render: (value: string | null, record) => renderStatusBadge(value ?? record.status),");
    expect(source).not.toContain('updateContract(contractId, { status:');
  });

  it('T026: routes terminate, restore, and activate actions through client contract mutations', () => {
    expect(source).toContain("from '@alga-psa/billing/actions/billingClientsActions';");
    expect(source).toContain("await updateClientContractForBilling(clientContractId, { is_active: false });");
    expect(source).toContain("await updateClientContractForBilling(clientContractId, { is_active: true });");
    // Activation has to move contracts.status off 'draft' too, which only the dedicated
    // action does — a bare is_active flip leaves the derived status showing Draft.
    expect(source).toContain("await activateClientContractForBilling(clientContractId);");
    expect(source).toContain("clientContractId: record.client_contract_id,");
    expect(source).toContain("onConfirm={() => void handleTerminateContract(contractToTerminate?.clientContractId)}");
    expect(source).toContain("void handleRestoreContract(record.client_contract_id);");
    expect(source).toContain("void handleSetToActive(record.client_contract_id);");
    expect(source).not.toContain('checkClientHasActiveContract');
  });
});

describe('Set to Active activation wiring', () => {
  // alga0002267: the old handler flipped client_contracts.is_active only, so contracts.status
  // stayed 'draft', deriveClientContractStatus kept reporting Draft, and the row never moved.
  it('routes both Set to Active copies through the dedicated activation action', () => {
    for (const uiSource of [source, contractsListSource]) {
      expect(uiSource).toContain('activateClientContractForBilling');
      expect(uiSource).toContain("await activateClientContractForBilling(clientContractId);");
      expect(uiSource).toContain(
        "toast.success(t('contractsList.toasts.contractActivated', { defaultValue: 'Contract activated' }));",
      );
    }
  });

  it('keeps the activation action behind the authorable guard and resyncs service periods', () => {
    expect(billingClientsActionsSource).toContain('export const activateClientContractForBilling');
    // System-managed default contracts are attribution-only; activation must not bypass that.
    const actionBody = billingClientsActionsSource.slice(
      billingClientsActionsSource.indexOf('export const activateClientContractForBilling'),
    );
    expect(actionBody).toContain('assertClientContractAssignmentIsAuthorable(trx, tenant, clientContractId)');
    expect(actionBody).toContain('activateClientContractAssignment(trx, tenant, clientContractId)');
    expect(actionBody).toContain("sourceRunPrefix: 'client_contract_activate'");
    // Quote-converted contracts never emitted CONTRACT_CREATED; the wizard key shape dedupes
    // the drafts that already did.
    expect(actionBody).toContain("eventType: 'CONTRACT_CREATED'");
    expect(actionBody).toContain('idempotencyKey: `contract_created:${activated.contract_id}:${activated.client_id}`');
  });
});

describe('ClientContractsTab column ids', () => {
  it('gives every client contract column a distinct dataIndex so Actions renders its menu', () => {
    const start = source.indexOf('const clientContractColumns');
    const end = source.indexOf('const filteredClientContracts');
    const block = source.slice(start, end);
    const dataIndexes = [...block.matchAll(/^ {6}dataIndex: '([^']+)'/gm)].map((match) => match[1]);
    expect(dataIndexes.length).toBeGreaterThan(5);
    expect(new Set(dataIndexes).size).toBe(dataIndexes.length);
    expect(block).toContain("dataIndex: 'po_required'");
  });
});
