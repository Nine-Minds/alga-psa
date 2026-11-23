import { describe, expect, it, vi } from 'vitest';
import { localAuthorReference } from '../conversationAuthorReference';

const state = vi.hoisted(() => ({ rows: [] as any[], redactedFields: [] as string[] }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (_db: unknown, tenant: string) => ({ table: () => {
    let filters: Record<string, unknown> = {};
    const query: any = {
      where: (key: any, value?: unknown) => { if (typeof key === 'object') filters = { ...filters, ...key }; else filters[key] = value; return query; },
      orderBy: () => query,
      limit: () => query,
      select: async () => state.rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value)),
    };
    return query;
  } }),
}));
vi.mock('../sharedWork', () => ({ withCoManagedSharedWork: (_db: unknown, actor: any, resource: any, _action: string, command: any) =>
  command({ trx: {}, actor, resource, sessionId: 'session', redactedFields: state.redactedFields }) }));
vi.mock('../customerWork', () => ({ withCoManagedCustomerTicket: (_db: unknown, actor: any, resource: any, _action: string, command: any) =>
  command({ trx: {}, actor, resource, sessionId: 'session', redactedFields: state.redactedFields }) }));
vi.mock('../sharedWorkIdentity', async () => {
  const actual = await vi.importActual<typeof import('../sharedWorkIdentity')>('../sharedWorkIdentity');
  return { ...actual, assertCoManagedSessionUnexpired: async () => undefined };
});

import { getCoManagedTicketHandoffHistory } from '../ticketCollaboration';

const customer = '00000000-0000-4000-8000-0000000000c1';
const sponsor = '00000000-0000-4000-8000-0000000000a1';
const customerUser = '00000000-0000-4000-8000-0000000000c2';
const sponsorUser = '00000000-0000-4000-8000-0000000000a2';
const resource = { tenant: customer, relationshipId: '00000000-0000-4000-8000-0000000000e1', kind: 'ticket' as const,
  id: '00000000-0000-4000-8000-0000000000f1' };

describe('getCoManagedTicketHandoffHistory author projection', () => {
  it.each([
    { label: 'customer viewer sees sponsor author opaquely', viewer: customer, source: sponsor, userId: sponsorUser, refTenant: customer, side: 'sponsor' },
    { label: 'sponsor viewer sees customer author opaquely', viewer: sponsor, source: customer, userId: customerUser, refTenant: customer, side: 'customer' },
  ])('$label', async ({ viewer, source, userId, refTenant, side }) => {
    state.rows = [{ tenant: customer, operation_id: 'op', revision: 1, transition: 'escalated', occurred_at: '2026-11-01T00:00:00.000Z',
      note: 'shared note', actor_tenant: source, actor_user_id: userId, actor_name: 'Alex Actor', actor_organization: 'Other Org',
      relationship_id: resource.relationshipId, ticket_id: resource.id, audience: 'shared_it' }];
    state.redactedFields = [];
    const result = await getCoManagedTicketHandoffHistory({} as any, { tenant: viewer, userId: viewer === customer ? customerUser : sponsorUser } as any, resource);
    const author = result.items[0].author as any;
    expect(author).toMatchObject({ tenant: source, name: 'Alex Actor', organization: 'Other Org' });
    expect(author.referenceId).toBe(localAuthorReference(refTenant, 'user', userId));
    expect(author.side).toBe(side);
    expect(author).not.toHaveProperty('userId');
    expect(JSON.stringify(result)).not.toContain(userId);
  });

  it.each([
    { label: 'customer viewer', viewer: customer, source: sponsor, userId: sponsorUser },
    { label: 'sponsor viewer', viewer: sponsor, source: customer, userId: customerUser },
  ])('suppresses a stored UUID display-name fallback for a $label, including old rows', async ({ viewer, source, userId }) => {
    state.rows = [{ tenant: customer, operation_id: 'legacy-op', revision: 1, transition: 'handed_back',
      occurred_at: '2026-11-01T00:00:00.000Z', note: 'done', actor_tenant: source, actor_user_id: userId,
      actor_name: userId, actor_organization: 'Other Org', relationship_id: resource.relationshipId,
      ticket_id: resource.id, audience: 'shared_it' }];
    state.redactedFields = [];

    const result = await getCoManagedTicketHandoffHistory({} as any,
      { tenant: viewer, userId: viewer === customer ? customerUser : sponsorUser } as any, resource);

    expect(JSON.stringify(result)).not.toContain(userId);
    expect(result.items[0].author).toMatchObject({ tenant: source, name: '', organization: 'Other Org' });
  });

  it('preserves own-tenant userId under the established contract', async () => {
    state.rows = [{ tenant: customer, relationship_id: resource.relationshipId, ticket_id: resource.id, audience: 'shared_it', operation_id: 'op',
      revision: 1, transition: 'escalated', occurred_at: '2026-11-01T00:00:00.000Z', note: 'n', actor_tenant: customer,
      actor_user_id: customerUser, actor_name: 'Cara Customer', actor_organization: 'Customer Co' }];
    state.redactedFields = [];
    const result = await getCoManagedTicketHandoffHistory({} as any, { tenant: customer, userId: customerUser } as any, resource);
    expect(result.items[0].author).toEqual({ tenant: customer, userId: customerUser, name: 'Cara Customer', organization: 'Customer Co' });
  });

  it('omits the complete author object when actor visibility is hidden', async () => {
    state.rows = [{ tenant: customer, relationship_id: resource.relationshipId, ticket_id: resource.id, audience: 'shared_it', operation_id: 'op',
      revision: 1, transition: 'escalated', occurred_at: '2026-11-01T00:00:00.000Z', note: 'n', actor_tenant: sponsor,
      actor_user_id: sponsorUser, actor_name: 'Max Msp', actor_organization: 'Sponsor Co' }];
    state.redactedFields = ['actor'];
    const result = await getCoManagedTicketHandoffHistory({} as any, { tenant: customer, userId: customerUser } as any, resource);
    expect(result.items[0]).not.toHaveProperty('author');
    expect(JSON.stringify(result)).not.toContain(sponsorUser);
  });
});
