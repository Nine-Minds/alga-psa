import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const assignmentUiSource = readFileSync(
  new URL('../../clients/src/components/clients/ClientContractAssignment.tsx', import.meta.url),
  'utf8'
);

describe('Multi-active clients assignment identity wiring', () => {
  it('T023: assignment rows and actions are keyed by client_contract_id, not contract_id', () => {
    expect(assignmentUiSource).not.toContain('!clientContracts.some(cc => cc.contract_id === contract.contract_id && cc.is_active)');
    expect(assignmentUiSource).toContain("dataIndex: 'client_contract_id'");
    expect(assignmentUiSource).toContain('const handleDeactivateContract = async (clientContractId: string)');
    expect(assignmentUiSource).toContain('await getDetailedClientContract(contract.client_contract_id)');
  });

  it('T024: add/apply flow routes through cross-feature wizard and quick-add instead of re-finding by contract_id', () => {
    expect(assignmentUiSource).not.toContain('newContracts.find(c => c.contract_id === selectedContractToAdd)');
    expect(assignmentUiSource).toContain('const { renderContractWizard, renderContractQuickAdd } = useClientCrossFeature();');
    expect(assignmentUiSource).toContain('renderContractWizard?.({');
    expect(assignmentUiSource).toContain('renderContractQuickAdd?.({');
    expect(assignmentUiSource).toContain('handleContractUpdated(editingContract.client_contract_id, payload)');
  });
});
