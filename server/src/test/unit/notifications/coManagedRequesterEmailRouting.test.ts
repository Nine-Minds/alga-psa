import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const runtime = vi.hoisted(() => ({ settings: vi.fn(), defaultFrom: vi.fn(), connection: vi.fn(), scopes: [] as string[],
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
vi.mock('@alga-psa/email', () => ({ TenantEmailService: { getTenantEmailSettings: runtime.settings, getDefaultFromAddress: runtime.defaultFrom } }));
import { resolveCoManagedRequesterEmailRouting } from '@alga-psa/jobs/handlers/coManagedRequesterEmailRouting';
import { buildTenantPortalSlug } from '@alga-psa/shared/utils/tenantSlug';
afterEach(() => vi.unstubAllEnvs());
const item = () => ({ tenant: randomUUID(), message: { resource: { id: randomUUID() } } } as any);
beforeEach(() => {
  runtime.settings.mockReset().mockResolvedValue({}); runtime.defaultFrom.mockReset().mockReturnValue({ email: 'default@example.test' });
  runtime.connection.mockReset().mockResolvedValue({}); runtime.scopes.length = 0; runtime.rows = {};
  vi.stubEnv('NEXTAUTH_URL', 'https://app.example.test');
});
it('uses configured ticketing From, provider display name, the originating reply mailbox and a tenant-qualified portal link', async () => {
  const delivery = item(), providerId = randomUUID();
  runtime.settings.mockResolvedValue({ ticketingFromEmail: ' helpdesk@example.test ' });
  runtime.rows.tickets = { board_id: randomUUID(), email_metadata: { providerId } };
  runtime.rows.email_providers = (where: any) => where.mailbox ? { sender_display_name: 'Customer IT' }
    : where.id === providerId && where.is_active ? { mailbox: 'intake@example.test', sender_display_name: 'Intake' } : undefined;
  expect(await resolveCoManagedRequesterEmailRouting(delivery)).toEqual({
    from: { email: 'helpdesk@example.test', name: 'Customer IT' }, replyTo: { email: 'intake@example.test', name: 'Intake' },
    url: `https://app.example.test/client-portal/tickets/${delivery.message.resource.id}?tenant=${buildTenantPortalSlug(delivery.tenant)}`,
  });
  expect(runtime.scopes).toEqual([delivery.tenant]);
});
it('uses the configured display name with the default sender and preserves an active customer portal host', async () => {
  runtime.settings.mockResolvedValue({ ticketingFromName: ' Customer support ' });
  runtime.rows.portal_domains = { status: 'active', domain: 'support.customer.test', canonical_host: 'placeholder.test' };
  const delivery = item(), result = await resolveCoManagedRequesterEmailRouting(delivery);
  expect(result).toMatchObject({ from: { email: 'default@example.test', name: 'Customer support' }, replyTo: { email: 'default@example.test' } });
  expect(result.url).toBe(`https://support.customer.test/client-portal/tickets/${delivery.message.resource.id}`);
});
it('uses the board name when a ticketing address has no configured or provider name', async () => {
  runtime.settings.mockResolvedValue({ ticketingFromEmail: 'helpdesk@example.test' });
  runtime.rows.tickets = { board_id: randomUUID() }; runtime.rows.boards = { board_name: 'Client Helpdesk' };
  expect(await resolveCoManagedRequesterEmailRouting(item())).toMatchObject({ from: { email: 'helpdesk@example.test', name: 'Client Helpdesk' } });
});
it.each(['pending_dns', 'disabled'])('ignores the canonical placeholder for a %s portal domain', async status => {
  runtime.rows.portal_domains = { status, domain: 'not-active.customer.test', canonical_host: 'placeholder.portal.test' };
  const delivery = item(), result = await resolveCoManagedRequesterEmailRouting(delivery);
  expect(result.url).toContain('https://app.example.test/client-portal/'); expect(result.url).toContain(`tenant=${buildTenantPortalSlug(delivery.tenant)}`);
  expect(result.from).toBeUndefined(); expect(result.replyTo).toBeUndefined();
});
it('propagates routing lookup failures so a durable delivery retries instead of using a guessed sender', async () => {
  runtime.settings.mockRejectedValue(new Error('temporary settings failure'));
  await expect(resolveCoManagedRequesterEmailRouting(item())).rejects.toThrow('temporary settings failure');
});
it('rejects a malformed active portal host before it can appear in a requester link', async () => {
  runtime.rows.portal_domains = { status: 'active', domain: 'customer.test/path?tenant=other' };
  await expect(resolveCoManagedRequesterEmailRouting(item())).rejects.toThrow('Invalid active portal domain');
});
