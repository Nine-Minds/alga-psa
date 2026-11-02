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
  teams: { manager_id: ids.actor },
  tickets: { ticket_id: ids.ticket, client_id: 'c', board_id: 'b', entered_by: ids.actor, assigned_to: null },
};
const written: string[] = [];
const locks: string[] = [];

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      const q: any = new Proxy({}, {
        get: (_t, prop) => {
          if (['forShare', 'forUpdate'].includes(String(prop))) return () => { locks.push(`${name}.${String(prop)}`); return q; };
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
import { matchesCoManagedScopeConstraints } from '../sharedWorkIdentity';

const trx: any = { raw: (s: string) => s };
const managerId = '66666666-6666-4666-8666-666666666666';
const input = (fields: string[], readFields: string[] = []) => ({ tenant: 't', ticketId: ids.ticket, workflowRunId: ids.run, actorUserId: ids.actor, fields, readFields });

describe('workflow ticket authority: scope / redaction denial', () => {
  beforeEach(() => { authorize.mockReset(); written.length = 0; locks.length = 0; rows.teams = { manager_id: ids.actor }; });

  it('allows an in-scope ticket with nothing redacted, and writes nothing itself', async () => {
    authorize.mockResolvedValue({ redactedFields: [] });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, input(['comments']))).resolves.toBeDefined();
    expect(written).toEqual([]);
    expect(locks).toContain('tickets.forUpdate');
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
    ['entity links', ['entity_links'], 'tickets.entity_links'],
    ['attachments', ['attachments'], 'tickets.attachments'],
    ['checklists', ['checklist'], 'tickets.checklist'],
    ['document storage', ['attachments'], 'documents.file_id'],
    ['checklist storage', ['checklist'], 'ticket_checklist_items.item_name'],
    ['create description', ['description'], 'tickets.attributes.description'],
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
  it('read requires read authority only and returns redactions instead of rejecting the entire record', async () => {
    authorize.mockResolvedValue({ redactedFields: ['tickets.title', 'comments.note'] });
    const grant = await retainCoManagedWorkflowTicketAuthority(trx, { ...input([]), operation: 'read' });
    expect(locks).toContain('tickets.forShare');
    expect(locks).not.toContain('tickets.forUpdate');
    expect(grant.redactedFields).toEqual(['tickets.title', 'comments.note']);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith(trx, expect.anything(), expect.anything(), 'ticket', 'read', expect.objectContaining({ clientId: 'c', boardId: 'b' }));
  });

  it.each(['response_state', 'attributes.external_ref'])('read rejects a masked selector predicate: %s', async field => {
    authorize.mockResolvedValue({ redactedFields: [`tickets.${field}`] });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, {
      ...input([]), operation: 'read', predicateFields: [field],
    })).rejects.toMatchObject({ code: 'WORKFLOW_TICKET_PREDICATE_FORBIDDEN' });
  });

  it.each(['client', 'board'])('create rejects prospective %s scope excluded by the publisher bundle', async excluded => {
    authorize.mockImplementation(async (_trx, _actor, _subject, _resource, action, record) => {
      if (action === 'create' && (record.clientId !== ids.actor || record.boardId !== ids.ticket)) throw new Error('scope denied');
      return { redactedFields: [] };
    });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, {
      ...input(['title']), operation: 'create', ticketId: undefined,
      prospective: { clientId: excluded === 'client' ? ids.run : ids.actor, boardId: excluded === 'board' ? ids.run : ids.ticket, assignedUserIds: [], teamIds: [] }
    })).rejects.toThrow('scope denied');
    expect(written).toEqual([]);
  });

  it('create authorizes the prospective record without requiring an existing ticket', async () => {
    authorize.mockResolvedValue({ redactedFields: [] });
    const grant = await retainCoManagedWorkflowTicketAuthority(trx, {
      ...input(['title']), operation: 'create', ticketId: undefined,
      prospective: { clientId: ids.actor, boardId: ids.ticket, assignedUserIds: [], teamIds: [] }
    });
    expect(grant.before).toMatchObject({ client_id: ids.actor, board_id: ids.ticket });
    expect(authorize).toHaveBeenCalledWith(trx, expect.anything(), expect.anything(), 'ticket', 'create', expect.objectContaining({ clientId: ids.actor, boardId: ids.ticket }));
    expect(authorize).toHaveBeenCalledWith(trx, expect.anything(), expect.anything(), 'ticket', 'read', expect.objectContaining({ clientId: ids.actor, boardId: ids.ticket }));
  });

  it('create rejects redacted writable fields', async () => {
    authorize.mockResolvedValue({ redactedFields: ['tickets.title'] });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, {
      ...input(['title']), operation: 'create', ticketId: undefined,
      prospective: { clientId: ids.actor, boardId: ids.ticket, assignedUserIds: [], teamIds: [] }
    })).rejects.toMatchObject({ name: 'CoManagedSharedWorkError' });
  });

  it.each([
    ['create', 'tickets.custom_fields'], ['create', 'tickets.attributes.custom_fields'],
    ['update', 'tickets.custom_fields'], ['update', 'tickets.attributes.custom_fields'],
  ])('%s denies generic attributes.custom_fields writes through %s', async (operation, mask) => {
    authorize.mockResolvedValue({ redactedFields: [mask] });
    const request = operation === 'create'
      ? { ...input(['attributes.custom_fields']), operation: 'create' as const, ticketId: undefined,
          prospective: { clientId: ids.actor, boardId: ids.ticket, assignedUserIds: [], teamIds: [] } }
      : { ...input(['attributes.custom_fields']), operation: 'update' as const };
    await expect(retainCoManagedWorkflowTicketAuthority(trx, request)).rejects.toMatchObject({ name: 'CoManagedSharedWorkError' });
    expect(written).toEqual([]);
  });

  it.each(['create', 'update'])('%s allows generic attributes.custom_fields when no alias is masked', async operation => {
    authorize.mockResolvedValue({ redactedFields: [] });
    const request = operation === 'create'
      ? { ...input(['attributes.custom_fields']), operation: 'create' as const, ticketId: undefined,
          prospective: { clientId: ids.actor, boardId: ids.ticket, assignedUserIds: [], teamIds: [] } }
      : { ...input(['attributes.custom_fields']), operation: 'update' as const };
    await expect(retainCoManagedWorkflowTicketAuthority(trx, request)).resolves.toBeDefined();
  });

  it('create requires read permission for a defaulted status returned by tickets.create', async () => {
    authorize.mockImplementation(async (_trx, _actor, _subject, _resource, action) => ({
      redactedFields: action === 'read' ? ['tickets.status_id'] : [],
    }));
    await expect(retainCoManagedWorkflowTicketAuthority(trx, {
      ...input(['status_id']), operation: 'create', ticketId: undefined,
      readFields: ['status_id'],
      prospective: { clientId: ids.actor, boardId: ids.ticket, assignedUserIds: [], teamIds: [] }
    })).rejects.toMatchObject({ name: 'CoManagedSharedWorkError' });
    expect(authorize).toHaveBeenCalledWith(trx, expect.anything(), expect.anything(), 'ticket', 'create', expect.anything());
    expect(authorize).toHaveBeenCalledWith(trx, expect.anything(), expect.anything(), 'ticket', 'read', expect.anything());
    expect(written).toEqual([]);
  });

  it('rejects assignment changes that move a ticket outside the author scope', async () => {
    authorize.mockImplementation(async (_trx, _actor, _subject, _resource, _action, record) => {
      if (record.assignedUserIds.includes(ids.run)) throw new Error('prospective assignment denied');
      return { redactedFields: [] };
    });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, {
      ...input(['assignment']), operation: 'update', assignment: { assignedUserIds: [ids.run], teamIds: [] }
    })).rejects.toThrow('prospective assignment denied');
    expect(written).toEqual([]);
  });

  it('denies a team assignment when only an additional user matches assigned_to scope', async () => {
    rows.teams = { manager_id: managerId };
    authorize.mockImplementation(async (_trx, _actor, _subject, _resource, _action, record) => {
      if (!matchesCoManagedScopeConstraints([{ field: 'assigned_to', operator: 'eq', value: ids.actor } as any], record)) throw new Error('assigned_to scope denied');
      return { redactedFields: [] };
    });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, {
      ...input(['assignment']), operation: 'create', ticketId: undefined,
      prospective: { clientId: ids.actor, boardId: ids.ticket, assignedUserIds: [ids.actor], teamIds: [ids.run] }
    })).rejects.toThrow('assigned_to scope denied');
    expect(authorize).toHaveBeenCalledWith(trx, expect.anything(), expect.anything(), 'ticket', 'create',
      expect.objectContaining({ assignedUserIds: [managerId, ids.actor], teamIds: [ids.run] }));
  });

  it('allows a team assignment when the actual primary manager matches assigned_to scope', async () => {
    rows.teams = { manager_id: managerId };
    authorize.mockImplementation(async (_trx, _actor, _subject, _resource, _action, record) => {
      if (!matchesCoManagedScopeConstraints([{ field: 'assigned_to', operator: 'eq', value: managerId } as any], record)) throw new Error('assigned_to scope denied');
      return { redactedFields: [] };
    });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, {
      ...input(['assignment']), operation: 'create', ticketId: undefined,
      prospective: { clientId: ids.actor, boardId: ids.ticket, assignedUserIds: [ids.actor], teamIds: [ids.run] }
    })).resolves.toBeDefined();
    expect(authorize).toHaveBeenCalledWith(trx, expect.anything(), expect.anything(), 'ticket', 'create',
      expect.objectContaining({ assignedUserIds: [managerId, ids.actor], teamIds: [ids.run] }));
    expect(locks).toContain('teams.forShare');
  });

  it('denies the prospective team scope after projecting the persisted team assignee', async () => {
    authorize.mockImplementation(async (_trx, _actor, _subject, _resource, action, record) => {
      if (action === 'create' && record.teamIds.includes(ids.run)) throw new Error('team scope denied');
      return { redactedFields: [] };
    });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, {
      ...input(['assignment']), operation: 'create', ticketId: undefined,
      prospective: { clientId: ids.actor, boardId: ids.ticket, assignedUserIds: [], teamIds: [ids.run] }
    })).rejects.toThrow('team scope denied');
    expect(locks).toContain('teams.forShare');
  });

  it('checks stored attribute aliases for fields returned by a mutation', async () => {
    authorize.mockResolvedValue({ redactedFields: ['tickets.attributes.tags'] });
    await expect(retainCoManagedWorkflowTicketAuthority(trx, input(['priority_id'], ['tags'])))
      .rejects.toMatchObject({ name: 'CoManagedSharedWorkError' });
  });

});
