import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const runtime = vi.hoisted(() => ({ connection: vi.fn(), scopes: [] as string[],
  rows: {} as Record<string, any> }));
vi.mock('@alga-psa/db', () => ({ getConnection: runtime.connection, tenantDb: (_db: any, tenant: string) => {
  runtime.scopes.push(tenant);
  return { table: (table: string) => {
    let filter: any = {};
    const query: any = { where: (key: any, value: any) => { filter = typeof key === 'string' ? { [key]: value } : key; return query; },
      first: async () => typeof runtime.rows[table] === 'function' ? runtime.rows[table](filter) : runtime.rows[table] };
    return query;
  } };
} }));
import { resolveCoManagedRequesterEmailRouting } from '@alga-psa/jobs/handlers/coManagedRequesterEmailRouting';
import { buildTenantPortalSlug } from '@alga-psa/shared/utils/tenantSlug';
afterEach(() => vi.unstubAllEnvs());
const item = () => ({ tenant: randomUUID(), message: { resource: { id: randomUUID() } } } as any);
beforeEach(() => {
  runtime.connection.mockReset().mockResolvedValue({}); runtime.scopes.length = 0; runtime.rows = {};
  vi.stubEnv('NEXTAUTH_URL', 'https://app.example.test');
});
it('routes the sender through the ticket board, replies to the originating intake mailbox and links a tenant-qualified portal', async () => {
  const delivery = item(), providerId = randomUUID(), boardId = randomUUID();
  runtime.rows.tickets = { board_id: boardId, email_metadata: { providerId } };
  runtime.rows.email_providers = (where: any) => where.id === providerId && where.is_active ? { mailbox: 'intake@example.test', sender_display_name: 'Intake' } : undefined;
  expect(await resolveCoManagedRequesterEmailRouting(delivery)).toEqual({
    boardId, replyTo: { email: 'intake@example.test', name: 'Intake' },
    url: `https://app.example.test/client-portal/tickets/${delivery.message.resource.id}?tenant=${buildTenantPortalSlug(delivery.tenant)}`,
  });
  expect(new Set(runtime.scopes)).toEqual(new Set([delivery.tenant]));
});
it('leaves the reply mailbox to the resolved sender and preserves an active customer portal host', async () => {
  runtime.rows.portal_domains = { status: 'active', domain: 'support.customer.test', canonical_host: 'placeholder.test' };
  const delivery = item(), result = await resolveCoManagedRequesterEmailRouting(delivery);
  expect(result.replyTo).toBeUndefined();
  expect(result.url).toBe(`https://support.customer.test/client-portal/tickets/${delivery.message.resource.id}`);
});
it.each(['pending_dns', 'disabled'])('ignores the canonical placeholder for a %s portal domain', async status => {
  runtime.rows.portal_domains = { status, domain: 'not-active.customer.test', canonical_host: 'placeholder.portal.test' };
  const delivery = item(), result = await resolveCoManagedRequesterEmailRouting(delivery);
  expect(result.url).toContain('https://app.example.test/client-portal/'); expect(result.url).toContain(`tenant=${buildTenantPortalSlug(delivery.tenant)}`);
  expect(result.boardId).toBeUndefined(); expect(result.replyTo).toBeUndefined();
});
it('propagates routing lookup failures so a durable delivery retries instead of using a guessed sender', async () => {
  runtime.connection.mockRejectedValue(new Error('temporary connection failure'));
  await expect(resolveCoManagedRequesterEmailRouting(item())).rejects.toThrow('temporary connection failure');
});
it('rejects a malformed active portal host before it can appear in a requester link', async () => {
  runtime.rows.portal_domains = { status: 'active', domain: 'customer.test/path?tenant=other' };
  await expect(resolveCoManagedRequesterEmailRouting(item())).rejects.toThrow('Invalid active portal domain');
});

it('resolves technician reply mailboxes without consulting a requester portal domain', async () => {
  const { resolveCoManagedTicketEmailMailbox } = await import('@alga-psa/jobs/handlers/coManagedRequesterEmailRouting');
  const delivery = item(), providerId = randomUUID();
  runtime.rows.tickets = { email_metadata: { providerId } };
  runtime.rows.email_providers = (where: any) => where.id === providerId && where.is_active ? { mailbox: 'inbound@example.test' } : undefined;
  runtime.rows.portal_domains = () => { throw new Error('Technician routing must not use a requester portal domain'); };
  expect(await resolveCoManagedTicketEmailMailbox(delivery.tenant, delivery.message.resource.id)).toEqual({ boardId: undefined, replyTo: { email: 'inbound@example.test', name: undefined } });
});
