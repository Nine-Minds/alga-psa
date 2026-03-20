import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const clientContractModelSource = readFileSync(
  new URL('../../clients/src/models/clientContract.ts', import.meta.url),
  'utf8'
);
const assignmentUiSource = readFileSync(
  new URL('../../clients/src/components/clients/ClientContractAssignment.tsx', import.meta.url),
  'utf8'
);

describe('Multi-active assignment detail scoping wiring', () => {
  it('T030: assignment detail line names and counts are scoped by selected client_contract_id', () => {
    expect(clientContractModelSource).toContain("db('client_contract_lines as ccl')");
    expect(clientContractModelSource).toContain("'ccl.client_contract_id': clientContractId");
    expect(clientContractModelSource).toContain("'ccl.is_active': true");
    expect(clientContractModelSource).toContain("normalized.contract_line_names = assignmentContractLines.map((line) => line.contract_line_name);");
    expect(clientContractModelSource).toContain('normalized.contract_line_count = assignmentContractLines.length;');
    expect(clientContractModelSource).not.toContain(".where({ contract_id: normalized.contract_id, tenant })");
  });

  it('T030: assignment edit dialog consumes the selected assignment line names', () => {
    expect(assignmentUiSource).toContain('onContractAssigned={(payload: ClientContractDialogSubmission) =>');
    expect(assignmentUiSource).toContain('handleContractUpdated(editingContract.client_contract_id, payload)');
    expect(assignmentUiSource).toContain('contractLineNames={editingContract.contract_line_names}');
  });
});
