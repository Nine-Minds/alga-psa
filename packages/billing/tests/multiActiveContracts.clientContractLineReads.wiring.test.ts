import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const clientLineActionsSource = readFileSync(
  new URL('../../clients/src/actions/clientContractLineActions.ts', import.meta.url),
  'utf8'
);
const clientLineModelSource = readFileSync(
  new URL('../../clients/src/models/clientContractLine.ts', import.meta.url),
  'utf8'
);

describe('Multi-active client contract-line read scoping wiring', () => {
  it('T025: contract-line reads encode assignment identity as client_contract_id + contract_line_id', () => {
    expect(clientLineActionsSource).toContain("concat('contract-', cc.client_contract_id, '-', cl.contract_line_id) as client_contract_line_id");
    expect(clientLineActionsSource).not.toContain('cl.contract_line_id as client_contract_line_id');
    expect(clientLineModelSource).toContain("concat('contract-', cc.client_contract_id, '-', cl.contract_line_id) as client_contract_line_id");
  });

  it('T025: mutation and historical guard paths parse synthetic assignment identities safely', () => {
    expect(clientLineActionsSource).toContain('parseClientContractLineIdentity');
    expect(clientLineActionsSource).toContain('/^contract-([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$/');
    expect(clientLineModelSource).toContain('parseClientContractLineIdentity');
    expect(clientLineModelSource).toContain("/^contract-([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$/");
  });
});
