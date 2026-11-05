import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateCalls: { table: string; payload: Record<string, unknown> }[] = [];
const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];

function queryStub(table: string): any {
  const stub: any = {
    where: () => stub,
    whereNull: () => stub,
    first: async () => ({ id: 1, name: 'invoice' }),
    orderBy: async () => [],
    update: (payload: Record<string, unknown>) => {
      updateCalls.push({ table, payload });
      return { returning: async () => [{ id: 1, ...payload }] };
    },
    insert: (payload: Record<string, unknown>) => {
      insertCalls.push({ table, payload });
      return { returning: async () => [{ id: 1, ...payload }] };
    },
  };
  return stub;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} as any }),
  getConnection: async () => ({} as any),
  tenantDb: () => ({ table: (table: string) => queryStub(table), tenantJoin: (query: any) => query }),
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { getInstance: vi.fn(), getTenantEmailSettings: vi.fn() },
  StaticTemplateProcessor: class {},
}));

describe('notification writes are limited to columns the UI owns', () => {
  beforeEach(() => {
    updateCalls.length = 0;
    insertCalls.length = 0;
  });

  it('updateSettings writes only is_enabled and rate_limit_per_minute', async () => {
    const { getEmailNotificationService } = await import('./email');

    await getEmailNotificationService().updateSettings('tenant-1', {
      is_enabled: false,
      rate_limit_per_minute: 30,
      tenant: 'victim-tenant',
      id: 99,
      created_at: '2020-01-01',
    } as any);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({ is_enabled: false, rate_limit_per_minute: 30 });
  });

  it('updateTenantTemplate writes only the editable template body', async () => {
    const { getEmailNotificationService } = await import('./email');

    await getEmailNotificationService().updateTenantTemplate('tenant-1', 7, {
      subject: 'Edited',
      html_content: '<p>hi</p>',
      text_content: 'hi',
      language_code: 'sv',
      name: 'some-other-template',
      system_template_id: 42,
      tenant: 'victim-tenant',
      id: 99,
    } as any);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({
      subject: 'Edited',
      html_content: '<p>hi</p>',
      text_content: 'hi',
      language_code: 'sv',
    });
  });

  it('updateTenantTemplate leaves out fields the caller did not send', async () => {
    const { getEmailNotificationService } = await import('./email');

    await getEmailNotificationService().updateTenantTemplate('tenant-1', 7, { html_content: '<p>hi</p>' });

    expect(updateCalls[0].payload).toEqual({ html_content: '<p>hi</p>' });
  });

  it('createTenantTemplate takes the tenant from its argument, not the payload', async () => {
    const { getEmailNotificationService } = await import('./email');

    await getEmailNotificationService().createTenantTemplate('tenant-1', {
      name: 'invoice',
      subject: 'Invoice',
      html_content: '<p>hi</p>',
      text_content: 'hi',
      language_code: 'en',
      system_template_id: 5,
      tenant: 'victim-tenant',
      id: 99,
      created_at: '2020-01-01',
      updated_at: '2020-01-01',
    } as any);

    const insert = insertCalls.at(-1)!;
    expect(insert.payload).toEqual({
      name: 'invoice',
      subject: 'Invoice',
      html_content: '<p>hi</p>',
      text_content: 'hi',
      language_code: 'en',
      system_template_id: 5,
      tenant: 'tenant-1',
    });
  });
});
