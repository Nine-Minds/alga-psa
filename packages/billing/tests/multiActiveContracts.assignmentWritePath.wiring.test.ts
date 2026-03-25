import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wizardSource = readFileSync(
  new URL('../src/actions/contractWizardActions.ts', import.meta.url),
  'utf8'
);
const sharedAssignmentsSource = readFileSync(
  new URL('../../../shared/billingClients/clientContracts.ts', import.meta.url),
  'utf8'
);
const clientsActionSource = readFileSync(
  new URL('../../clients/src/actions/clientContractActions.ts', import.meta.url),
  'utf8'
);
const clientsModelSource = readFileSync(
  new URL('../../clients/src/models/clientContract.ts', import.meta.url),
  'utf8'
);

describe('Multi-active contracts assignment write-path wiring', () => {
  it('T018/T019: wizard assignment creation routes through shared assignment helper without local overlap query', () => {
    expect(wizardSource).toContain('createClientContractAssignment(trx, tenant, {');
    expect(wizardSource).not.toContain('already has an active contract overlapping the specified range');
    expect(wizardSource).not.toContain("join('client_contracts as cc'");
  });

  it('T019/T020: shared assignment create/update no longer enforce active-window overlap singleton validation', () => {
    expect(sharedAssignmentsSource).not.toContain('already has an active contract overlapping the specified range');
    expect(sharedAssignmentsSource).not.toContain('.where(function overlap()');
  });

  it('T021: invoiced-period assignment date guard remains in clients update flow', () => {
    expect(clientsActionSource).toContain('Cannot change assignment dates as they overlap with an already invoiced period.');
    expect(clientsActionSource).toContain('Cannot shorten contract end date before');
  });

  it('T022: clients create/update flows delegate assignment persistence to shared helpers', () => {
    expect(clientsActionSource).toContain('createClientContractAssignment');
    expect(clientsActionSource).not.toContain('already has an active contract overlapping the specified range');
    expect(clientsModelSource).toContain('createClientContractAssignment(db, tenant, {');
    expect(clientsModelSource).toContain('updateClientContractAssignment(db, tenant, clientContractId, sanitized)');
  });
});
