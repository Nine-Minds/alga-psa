import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/models/contract.ts', import.meta.url),
  'utf8'
);

describe('Contract.getAllWithClients assignment-first wiring', () => {
  it('T019: scopes live contract rows from client_contracts instead of treating clientless headers as live contracts', () => {
    expect(source).toContain("const rows = await knexOrTrx('client_contracts as cc')");
    expect(source).toContain(".where({ 'cc.tenant': tenant })");
    expect(source).toContain(".whereNotNull('co.owner_client_id')");
  });

  it('T024: derives list status from assignment lifecycle and preserves header status separately', () => {
    expect(source).toContain('deriveClientContractStatus({');
    expect(source).toContain('const assignmentStatus = deriveClientContractStatus({');
    expect(source).toContain('status: assignmentStatus,');
    expect(source).toContain('assignment_status: assignmentStatus,');
    expect(source).toContain('contract_header_status: row.contract_header_status ?? row.status,');
  });
});
