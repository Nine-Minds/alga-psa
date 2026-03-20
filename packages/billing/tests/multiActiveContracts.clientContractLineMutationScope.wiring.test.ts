import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lineActionsSource = readFileSync(
  new URL('../../clients/src/actions/clientContractLineActions.ts', import.meta.url),
  'utf8'
);
const contractLinesUiSource = readFileSync(
  new URL('../../clients/src/components/clients/ContractLines.tsx', import.meta.url),
  'utf8'
);
const billingConfigUiSource = readFileSync(
  new URL('../../clients/src/components/clients/BillingConfiguration.tsx', import.meta.url),
  'utf8'
);

describe('Multi-active client contract-line mutation scope wiring', () => {
  it('T026/T027: mutation actions require assignment-scoped identity and fail explicitly for shared-header ambiguity', () => {
    expect(lineActionsSource).toContain('ensureAssignmentScopedIdentity');
    expect(lineActionsSource).toContain('Assignment-scoped client contract line identity is required for this mutation.');
    expect(lineActionsSource).toContain('assertSharedHeaderMutationIsExplicit');
    expect(lineActionsSource).toContain('Contract line mutation is ambiguous for assignment');
  });

  it('T028: contract-line add UI carries explicit client_contract_id assignment context', () => {
    expect(contractLinesUiSource).toContain('selectedClientContractId');
    expect(contractLinesUiSource).toContain('onSelectedClientContractChange');
    expect(contractLinesUiSource).toContain('client_contract_id: selectedClientContractId');
    expect(billingConfigUiSource).toContain('selectedClientContractId');
    expect(billingConfigUiSource).toContain('getClientContracts(client.client_id)');
    expect(billingConfigUiSource).toContain('onSelectedClientContractChange={setSelectedClientContractId}');
  });

  it('T029: billing configuration refreshes assignment-scoped line views after assignment mutations', () => {
    expect(billingConfigUiSource).toContain('const hydrateAssignmentScopedViews = async () => {');
    expect(billingConfigUiSource).toContain('onAssignmentsChanged={hydrateAssignmentScopedViews}');
    expect(contractLinesUiSource).toContain('data={clientContractLines}');
  });
});
