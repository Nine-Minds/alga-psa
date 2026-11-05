import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ policyRules: [] as any[], candidateRows: [] as any[], ticketSelections: 0, ticketLocks: 0 }));
vi.mock('@alga-psa/licensing/lifecycle', () => ({ assertCoManagedOperationalWrite: vi.fn() }));
vi.mock('../sharedWorkIdentity', async original => ({
  ...await original<typeof import('../sharedWorkIdentity')>(),
  lockCoManagedRecipientIdentity: vi.fn(async () => ({ tenant: 'tenant', userId: 'actor', userType: 'internal' })),
}));
vi.mock('../localPermission', () => ({ hasCoManagedLocalPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/authorization', async original => ({
  ...await original<typeof import('@alga-psa/authorization')>(),
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => state.policyRules),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      const predicates: Array<(row: any) => boolean> = [];
      const query: any = new Proxy({}, { get: (_target, key) => {
        if (key === 'where') return (column: string, value: unknown) => { predicates.push(row => row[column.replace(/^tickets\./, '')] === value); return query; };
        if (key === 'whereIn') return (column: string, values: unknown[]) => { predicates.push(row => values.includes(row[column.replace(/^tickets\./, '')])); return query; };
        if (key === 'whereRaw') return (sql: string, bindings: unknown[] = []) => {
          predicates.push(row => sql === '1 = 0' ? false : row.attributes?.external_ref === bindings[0]);
          return query;
        };
        if (key === 'andWhere') return (callback: (builder: any) => void) => { callback.call(query, query); return query; };
        if (key === 'orWhere') return (_callback: unknown) => query;
        if (key === 'select') return () => query;
        if (key === 'forShare' || key === 'forUpdate') return () => { if (name === 'tickets') state.ticketLocks++; return query; };
        if (key === 'first') return async () => name === 'workflow_runs'
          ? { workflow_id: 'workflow', workflow_version: 1, status: 'RUNNING' }
          : name === 'workflow_definitions' ? { created_by: '33333333-3333-4333-8333-333333333333' }
          : name === 'workflow_definition_versions' ? { published_by: '33333333-3333-4333-8333-333333333333' }
          : undefined;
        if (key === 'then') return (resolve: (value: any) => void) => {
          if (name === 'tickets') {
            state.ticketSelections++;
            resolve(state.candidateRows.filter(row => predicates.every(predicate => predicate(row))).map(row => ({ ticket_id: row.ticket_id })));
          } else resolve([]);
        };
        return () => query;
      } });
      return query;
    },
  }),
}));

import { findCoManagedWorkflowTicketCandidates } from '../workflowTicketAuthority';

const tenant = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const clientA = '44444444-4444-4444-8444-444444444444';
const clientB = '55555555-5555-4555-8555-555555555555';
const trx: any = { isTransaction: true, raw: (sql: string) => sql };
const request = (externalRef: string) => ({
  tenant, workflowRunId: runId, actorUserId: actorId,
  selector: { externalRef }, predicateFields: ['attributes.external_ref'],
});

describe('co-managed workflow ticket selector policy and indexed candidate scope', () => {
  beforeEach(() => {
    state.policyRules = [{ id: 'client-a', resource: 'ticket', action: 'read', constraints: [
      { field: 'client_id', operator: 'eq', value: clientA },
    ] }];
    state.candidateRows = [
      { ticket_id: 'ticket-a', client_id: clientA, attributes: { external_ref: 'ref-a' } },
      { ticket_id: 'ticket-b', client_id: clientB, attributes: { external_ref: 'ref-a' } },
    ];
    state.ticketSelections = 0;
    state.ticketLocks = 0;
  });

  it('uses selector and publisher scope together before returning candidate IDs', async () => {
    await expect(findCoManagedWorkflowTicketCandidates(trx, request('ref-a'))).resolves.toEqual(['ticket-a']);
    expect(state.ticketSelections).toBe(1);
    expect(state.ticketLocks).toBe(0);
  });

  it('returns no candidates for a missing selector without scanning unrelated ticket rows', async () => {
    await expect(findCoManagedWorkflowTicketCandidates(trx, request('missing'))).resolves.toEqual([]);
    expect(state.ticketSelections).toBe(1);
    expect(state.ticketLocks).toBe(0);
  });

  it('preserves selected-client scope when a policy only redacts other fields', async () => {
    state.policyRules = [{ id: 'client-a-redaction', resource: 'ticket', action: 'read',
      templateKey: 'selected_clients', selectedClientIds: [clientA],
      constraintKey: 'hide_sensitive_fields', redactedFields: ['tickets.description'],
    }];
    await expect(findCoManagedWorkflowTicketCandidates(trx, request('ref-a'))).resolves.toEqual(['ticket-a']);
    await expect(findCoManagedWorkflowTicketCandidates(trx, request('missing'))).resolves.toEqual([]);
    expect(state.ticketLocks).toBe(0);
  });

  it.each([
    ['response_state', 'tickets.response_state'], ['response_state', 'tickets.status_id'],
    ['attributes.external_ref', 'tickets.attributes.external_ref'], ['attributes.external_ref', 'tickets.external_ref'],
  ])('rejects %s when source %s is masked before selector lookup', async (field, mask) => {
    state.policyRules = [{ id: 'mask', resource: 'ticket', action: 'read',
      templateKey: 'selected_clients', selectedClientIds: [clientA],
      constraintKey: 'hide_sensitive_fields', redactedFields: [mask],
    }];
    await expect(findCoManagedWorkflowTicketCandidates(trx, {
      ...request('ref-a'), predicateFields: [field],
    })).rejects.toMatchObject({ code: 'WORKFLOW_TICKET_PREDICATE_FORBIDDEN' });
    expect(state.ticketSelections).toBe(0);
  });
});
