import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions create-renewal-draft wiring', () => {
  it('creates a renewal draft contract for eligible queue statuses and links it back to the work item when supported', () => {
    expect(source).toContain("import { randomUUID } from 'node:crypto';");
    expect(source).toContain('export type RenewalDraftCreationResult = {');
    expect(source).toContain('export const createRenewalDraftForQueueItem = withAuth(async (');
    expect(source).toContain("throw new Error('Client contract id is required');");
    expect(source).toContain("schema?.hasColumn?.('client_contracts', 'created_draft_contract_id') ?? false");
    expect(source).toContain('if (currentStatus !== \'pending\' && currentStatus !== \'renewing\') {');
    expect(source).toContain('Renewal draft can only be created for pending or renewing work items');
    expect(source).toContain('const draftContractId = randomUUID();');
    expect(source).toContain('status: \'draft\',');
    expect(source).toContain('if (hasCreatedDraftColumn) {');
    expect(source).toContain('created_draft_contract_id: draftContractId,');
    expect(source).toContain('created_draft_contract_id: draftContractId');
    expect(source).toContain('draft_client_contract_id: draftClientContractId');
  });
});
