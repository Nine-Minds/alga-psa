import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const assignmentUiSource = readFileSync(
  new URL('../../clients/src/components/clients/ClientContractAssignment.tsx', import.meta.url),
  'utf8'
);

describe('Multi-active clients assignment identity wiring', () => {
  it('T023: assignment picker no longer treats contract_id as unique active-assignment identity', () => {
    expect(assignmentUiSource).not.toContain('!clientContracts.some(cc => cc.contract_id === contract.contract_id && cc.is_active)');
    expect(assignmentUiSource).toContain('const selectableContracts = availableContracts;');
  });

  it('T024: add/apply flow uses the returned client_contract_id rather than re-finding by contract_id', () => {
    expect(assignmentUiSource).toContain('const createdAssignment = await assignContractToClient(');
    expect(assignmentUiSource).toContain('await applyContractToClient(createdAssignment.client_contract_id);');
    expect(assignmentUiSource).not.toContain('newContracts.find(c => c.contract_id === selectedContractToAdd)');
  });
});
