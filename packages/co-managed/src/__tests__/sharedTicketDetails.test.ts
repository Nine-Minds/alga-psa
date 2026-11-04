import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ redactedFields: [] as string[] }));
vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ tenantJoin: () => undefined, table: () => {
  const builder: any = { where: () => builder, first: async () => ({ attributes: { description: 'Issue' }, due_date: null,
    contact_name_id: 'contact-id', contact_name: 'Requester', client_id: 'client-id', client_name: 'Customer', category_id: null,
    assigned_to: 'user-id', assignee_first_name: 'QA', assignee_last_name: 'Tester' }) };
  return builder;
} }) }));
vi.mock('../sharedWork', () => ({ withCoManagedSharedWork: async (_db: any, _actor: any, resource: any, _action: string, read: any) =>
  read({ trx: {}, resource, revision: 3, redactedFields: state.redactedFields }) }));

import { getCoManagedSharedTicketDetails } from '../sharedTicketDetails';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor: any = { tenant: U(1), userId: U(2) };
const resource: any = { kind: 'ticket', tenant: U(3), relationshipId: U(4), id: U(5) };

describe('getCoManagedSharedTicketDetails current assignee policy', () => {
  beforeEach(() => { state.redactedFields = []; });
  it('returns live customer assignee name when visible, then suppresses it after relationship tightening', async () => {
    const original = await getCoManagedSharedTicketDetails({} as any, actor, resource);
    expect(original.fields.customer_assignee).toEqual({ name: 'QA Tester' });
    state.redactedFields = ['assignee_name'];
    const tightened = await getCoManagedSharedTicketDetails({} as any, actor, resource);
    expect(tightened.fields.customer_assignee).toBeUndefined();
    expect(JSON.stringify(tightened)).not.toContain('QA Tester');
  });
  it.each(['assignee_name', 'users', 'teams'])('suppresses assignee_name under %s bundle redaction', async redaction => {
    state.redactedFields = [redaction];
    const details = await getCoManagedSharedTicketDetails({} as any, actor, resource);
    expect(details.fields.customer_assignee).toBeUndefined();
  });
});
