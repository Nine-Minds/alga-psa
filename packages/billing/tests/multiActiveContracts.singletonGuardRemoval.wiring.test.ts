import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wizardBasicsSource = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep.tsx', import.meta.url),
  'utf8'
);
const contractDialogSource = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ContractDialog.tsx', import.meta.url),
  'utf8'
);
const clientContractsTabSource = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ClientContractsTab.tsx', import.meta.url),
  'utf8'
);
const contractsShellSource = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/Contracts.tsx', import.meta.url),
  'utf8'
);
const contractActionsSource = readFileSync(
  new URL('../src/actions/contractActions.ts', import.meta.url),
  'utf8'
);
const contractModelSource = readFileSync(
  new URL('../src/models/contract.ts', import.meta.url),
  'utf8'
);
const sharedContractsSource = readFileSync(
  new URL('../../../shared/billingClients/contracts.ts', import.meta.url),
  'utf8'
);

describe('Multi-active contracts singleton blocker removal wiring', () => {
  it('T005/T007: wizard basics does not disable clients or show singleton warning copy', () => {
    expect(wizardBasicsSource).not.toContain('disabledClientIds');
    expect(wizardBasicsSource).not.toContain('fetchClientIdsWithActiveContracts');
    expect(wizardBasicsSource).not.toContain('checkClientHasActiveContract');
    expect(wizardBasicsSource).not.toContain('This client already has an active contract');
  });

  it('T006/T008: quick add/edit dialog does not gate on sibling active contracts', () => {
    expect(contractDialogSource).not.toContain('disabledClientIds');
    expect(contractDialogSource).not.toContain('fetchClientIdsWithActiveContracts');
    expect(contractDialogSource).not.toContain('checkClientHasActiveContract');
    expect(contractDialogSource).not.toContain('clientHasActiveContract');
    expect(contractDialogSource).toContain('disabled={!contractName.trim() || !clientId}');
  });

  it('T009/T010/T011: activation flows no longer run singleton prechecks in either contracts tab shell', () => {
    expect(clientContractsTabSource).not.toContain('checkClientHasActiveContract');
    expect(contractsShellSource).not.toContain('checkClientHasActiveContract');
  });

  it('T013/T014/T015/T016: action/shared layers no longer encode singleton active-contract blockers', () => {
    expect(contractActionsSource).not.toContain('checkClientHasActiveContract');
    expect(contractActionsSource).not.toContain('fetchClientIdsWithActiveContracts');
    expect(contractActionsSource).not.toContain('Client already has an active contract');
    expect(sharedContractsSource).not.toContain('hasActiveContractForClient');
    expect(sharedContractsSource).not.toContain('getClientIdsWithActiveContracts');
    expect(sharedContractsSource).not.toContain('terminate their current active contract first');
  });

  it('T017: billing contract model no longer carries singleton helper wrappers', () => {
    expect(contractModelSource).not.toContain('hasActiveContractForClient: async');
    expect(contractModelSource).not.toContain('getClientIdsWithActiveContracts: async');
  });
});
