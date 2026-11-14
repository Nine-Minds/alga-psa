import { beforeEach, describe, expect, it, vi } from 'vitest';

// Scope-denied coverage WITHOUT a database: the real retainCoManagedWorkflowTicketAuthority runs against a
// scripted query surface, with only the L1a authorizer and lifecycle gate stubbed. The DB-backed authorizer
// itself is covered by the L1a/L3c integration suites.
const { authorize, lockIdentity } = vi.hoisted(() => ({ authorize: vi.fn(), lockIdentity: vi.fn(async () => ({ subject: true })) }));

vi.mock('@alga-psa/licensing/lifecycle', () => ({ assertCoManagedOperationalWrite: vi.fn(async () => undefined) }));
vi.mock('../sharedWorkIdentity', async (orig) => ({
  ...(await orig<typeof import('../sharedWorkIdentity')>()),
  authorizeCoManagedWorkRecord: authorize,
  lockCoManagedRecipientIdentity: lockIdentity,
}));

const ids = {
  run: '11111111-1111-4111-8111-111111111111',
  ticket: '22222222-2222-4222-8222-222222222222',
  actor: '33333333-3333-4333-8333-333333333333',
};
const rows: Record<string, any> = {
  workflow_runs: { run_id: ids.run, workflow_id: 'wf', workflow_version: 1, status: 'RUNNING' },
  workflow_definitions: { created_by: ids.actor },
  workflow_definition_versions: { published_by: ids.actor },
  tickets: { ticket_id: ids.ticket, client_id: 'c', board_id: 'b', entered_by: ids.actor, assigned_to: null },
};
const written: string[] = [];

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      const q: any = new Proxy({}, {
        get: (_t, prop) => {
          if (prop === 'first') return async () => rows[name];
          if (['insert', 'update', 'del', 'delete'].includes(String(prop))) return async () => { written.push(`${name}.${String(prop)}`); };
          return () => q;
        },
      });
      return q;
    },
  }),
}));

import { retainCoManagedWorkflowTicketAuthority } from '../workflowTicketAuthority';

const trx: any = { raw: (s: string) => s };
const input = (fields: string[], readFields: string[] = []) => ({ tenant: 't', ticketId: ids.ticket, workflowRunId: ids.run, actorUserId: ids.actor, fields, readFields });

describe('workflow ticket authority: scope / redaction denial', () => {
  beforeEach(() => { authorize.mockReset(); written.length = 0; });

  it('allows an in-scope ticket with nothing redacted, and writes nothing itself', async () => {
    authorize.mockResolvedValue({ redactedFields: [] });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, input(['comments']))).resolves.toBeDefined();
    expect(written).toEqual([]);
  });

  it('refuses when the author\'s bundle/scope excludes the ticket (authorizer denies)', async () => {
    authorize.mockRejectedValue(new Error('denied'));
    await expect(retainCoManagedWorkflowTicketAuthority(trx, input(['comments']))).rejects.toThrow('denied');
    expect(written).toEqual([]);
  });

  it.each([
    ['assignment', ['assignment'], 'tickets.assigned_to'],
    ['status/close', ['status_id'], 'tickets.closed_at'],
    ['update', ['priority_id'], 'tickets.priority_id'],
  ])('refuses when a target field is redacted (%s)', async (_n, fields, hidden) => {
    authorize.mockResolvedValue({ redactedFields: [hidden] });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, input(fields))).rejects.toMatchObject({ name: 'CoManagedSharedWorkError' });
  });

  it('refuses when a read-only field is redacted', async () => {
    authorize.mockResolvedValue({ redactedFields: ['tickets.title'] });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, input(['comments'], ['title']))).rejects.toMatchObject({ name: 'CoManagedSharedWorkError' });
  });

  it('refuses when the acting author is not the published author', async () => {
    authorize.mockResolvedValue({ redactedFields: [] });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, { ...input(['comments']), actorUserId: '44444444-4444-4444-8444-444444444444' })).rejects.toMatchObject({ name: 'CoManagedSharedWorkError' });
  });
});
