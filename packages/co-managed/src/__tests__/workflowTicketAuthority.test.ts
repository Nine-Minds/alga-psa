import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authorizeMock, recipientIdentityMock } = vi.hoisted(() => ({
  authorizeMock: vi.fn(),
  recipientIdentityMock: vi.fn(async (..._args: unknown[]) => ({ tenant: 'tenant-1', userId: 'author-1' }))
}));

vi.mock('@alga-psa/db', () => ({ tenantDb: (trx: any, tenant: string) => {
  const rows: Record<string, any> = {
    workflow_runs: { run_id: 'run-1', workflow_id: 'workflow-1', workflow_version: 3, status: 'RUNNING' },
    workflow_definitions: { created_by: 'author-1' },
    workflow_definition_versions: { published_by: 'author-1' },
    tickets: { ticket_id: 'ticket-1', client_id: 'client-1', board_id: 'board-1', entered_by: 'requester-1', assigned_to: null, assigned_team_id: null }
  };
  return { table: (table: string) => {
    const query: any = {
      where: (arg: any) => { if (typeof arg === 'function') arg(query); return query; },
      whereRaw: () => query,
      whereNull: () => query,
      orWhere: () => query,
      forShare: () => query,
      forUpdate: () => query,
      first: async () => rows[table]
    };
    return query;
  }};
}}));
vi.mock('@alga-psa/licensing/lifecycle', () => ({ assertCoManagedOperationalWrite: vi.fn(async () => undefined) }));
vi.mock('../sharedWorkIdentity', () => ({
  authorizeCoManagedWorkRecord: (...args: unknown[]) => authorizeMock(...args),
  CoManagedSharedWorkError: class CoManagedSharedWorkError extends Error {},
  isCoManagedUuid: () => true,
  lockCoManagedRecipientIdentity: (...args: unknown[]) => recipientIdentityMock(...args)
}));

import { retainCoManagedWorkflowTicketAuthority } from '../workflowTicketAuthority';

const trx = { raw: () => 'clock_timestamp()' } as any;
const input = { tenant: 'tenant-1', ticketId: 'ticket-1', workflowRunId: 'run-1', actorUserId: 'author-1', fields: ['comments'], readFields: [] };

describe('co-managed workflow ticket authority', () => {
  beforeEach(() => {
    authorizeMock.mockReset().mockResolvedValue({ redactedFields: [] });
    recipientIdentityMock.mockClear();
  });

  it("allows a published author's in-scope workflow mutation", async () => {
    const write = vi.fn();
    const authority = await retainCoManagedWorkflowTicketAuthority(trx as any, input);
    await write();
    expect(authorizeMock).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledOnce();
    expect(authority.actor.userId).toBe(input.actorUserId);
  });

  it('refuses an out-of-scope ticket before the workflow mutation runs', async () => {
    authorizeMock.mockRejectedValueOnce(new Error('scope denied'));
    const write = vi.fn();
    await expect(async () => {
      await retainCoManagedWorkflowTicketAuthority(trx as any, input);
      await write();
    }).rejects.toThrow('scope denied');
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['comments', 'assignment', 'status_id'])("refuses a policy-hidden %s field before the workflow mutation runs", async (field) => {
    authorizeMock.mockResolvedValue({ redactedFields: [field] });
    const write = vi.fn();
    await expect(async () => {
      await retainCoManagedWorkflowTicketAuthority(trx as any, { ...input, fields: [field] });
      await write();
    }).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
