import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions draft-link audit wiring', () => {
  it('audits renewal draft linkage with actor and timestamp metadata', () => {
    expect(source).toContain("export const createRenewalDraftForQueueItem = withAuth(async (");
    expect(source).toContain('sourceWorkItemUpdate.created_draft_contract_id = draftContractId;');
    expect(source).toContain("withActionLabel(sourceWorkItemUpdate, 'create_renewal_draft'), actorUserId");
    expect(source).toContain('withActionActor(');
    expect(source).toContain('withActionTimestamp(');
    expect(source).toContain('const actorUserId = resolveActorUserId(user);');
    expect(source).toContain('const nowIso = new Date().toISOString();');
  });
});
