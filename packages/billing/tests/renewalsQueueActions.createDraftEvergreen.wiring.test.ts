import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions evergreen draft wiring', () => {
  it('supports create-renewal-draft for evergreen queue entries', () => {
    const createDraftSection = source
      .split('export const createRenewalDraftForQueueItem = withAuth(async (')[1]
      ?.split('export const snoozeRenewalQueueItem = withAuth(async (')[0] ?? '';

    expect(createDraftSection).toContain("if (currentStatus !== 'pending' && currentStatus !== 'renewing') {");
    expect(createDraftSection).toContain("start_date: (source as any).end_date ?? (source as any).start_date,");
    expect(createDraftSection).toContain("end_date: (source as any).end_date ?? null,");
    expect(createDraftSection).toContain("created_draft_contract_id: draftContractId,");
    expect(createDraftSection).not.toContain('contract_type');
  });
});
