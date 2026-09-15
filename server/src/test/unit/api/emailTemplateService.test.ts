// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const store: Record<string, Row[]> = { system_email_templates: [], tenant_email_templates: [] };
/** Every (table, tenant) pair the service touched, so tenant scoping is observable. */
const touched: Array<{ table: string; tenant: string }> = [];

const stripAlias = (table: string) => table.split(' as ')[0].trim();
const stripPrefix = (column: string) => column.split('.').pop() as string;

class FakeQuery implements PromiseLike<Row[]> {
  private predicates: Array<(row: Row) => boolean> = [];

  constructor(private table: string, private tenant: string) {}

  private get rows(): Row[] {
    return (store[this.table] ?? []).filter(
      (row) => row.tenant === this.tenant && this.predicates.every((predicate) => predicate(row)),
    );
  }

  select() { return this; }
  orderBy() { return this; }

  where(criteria: Row | string, value?: unknown) {
    if (typeof criteria === 'string') {
      this.predicates.push((row) => row[stripPrefix(criteria)] === value);
    } else {
      this.predicates.push((row) =>
        Object.entries(criteria).every(([key, expected]) => row[stripPrefix(key)] === expected));
    }
    return this;
  }

  async first(): Promise<Row | undefined> { return this.rows[0]; }

  async insert(row: Row): Promise<void> {
    store[this.table] = [...(store[this.table] ?? []), { id: (store[this.table]?.length ?? 0) + 100, ...row }];
  }

  async update(patch: Row): Promise<number> {
    const matches = this.rows;
    matches.forEach((row) => Object.assign(row, patch));
    return matches.length;
  }

  async del(): Promise<number> {
    const doomed = new Set(this.rows);
    store[this.table] = (store[this.table] ?? []).filter((row) => !doomed.has(row));
    return doomed.size;
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

vi.mock('@alga-psa/db', () => ({
  BaseService: class {
    constructor(_options: unknown) {}
    protected async getDbForContext(): Promise<unknown> { return {}; }
  },
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (table: string) => {
      touched.push({ table: stripAlias(table), tenant });
      return new FakeQuery(stripAlias(table), tenant);
    },
    // Category comes off the joined row in these fixtures; the join is a no-op here.
    tenantJoin: (query: unknown) => query,
  }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
}));

const { EmailTemplateService } = await import('../../../lib/api/services/EmailTemplateService');

const TENANT = 'tenant-oz';
const OTHER_TENANT = 'tenant-kansas';
const context = { tenant: TENANT, userId: 'user-1' } as any;

const systemRow = (overrides: Row = {}): Row => ({
  tenant: TENANT,
  id: 1,
  name: 'ticket-created',
  subject: 'New ticket',
  html_content: '<p>stock</p>',
  text_content: 'stock',
  language_code: 'en',
  category: 'Tickets',
  ...overrides,
});

beforeEach(() => {
  store.system_email_templates = [
    systemRow(),
    systemRow({ id: 2, language_code: 'fr', subject: 'Nouveau ticket' }),
    systemRow({ id: 3, name: 'invoice-email', subject: 'Invoice', category: 'Billing' }),
    systemRow({ id: 4, tenant: OTHER_TENANT, subject: 'Other tenant ticket' }),
  ];
  store.tenant_email_templates = [];
  touched.length = 0;
});

describe('EmailTemplateService', () => {
  const service = () => new EmailTemplateService();

  it('lists system defaults merged with tenant overrides', async () => {
    store.tenant_email_templates = [{
      tenant: TENANT, id: 50, name: 'ticket-created', subject: 'Ours', html_content: '<p>ours</p>',
      text_content: 'ours', language_code: 'en', system_template_id: 1, updated_at: '2026-09-01',
    }];

    const result = await service().listTemplates({}, context);

    expect(result.total).toBe(3);
    expect(result.data.map((row) => `${row.name}/${row.language_code}`)).toEqual([
      'invoice-email/en', 'ticket-created/en', 'ticket-created/fr',
    ]);
    const customized = result.data.find((row) => row.language_code === 'en' && row.name === 'ticket-created');
    expect(customized).toMatchObject({ subject: 'Ours', is_customized: true, tenant_template_id: 50, category: 'Tickets' });
    expect(result.data.find((row) => row.language_code === 'fr')?.is_customized).toBe(false);
  });

  it('never reads another tenant, and filters by language and category', async () => {
    const byLanguage = await service().listTemplates({ language: 'fr' }, context);
    expect(byLanguage.data.map((row) => row.subject)).toEqual(['Nouveau ticket']);

    const byCategory = await service().listTemplates({ category: 'Billing' }, context);
    expect(byCategory.data.map((row) => row.name)).toEqual(['invoice-email']);

    const everything = await service().listTemplates({}, context);
    expect(everything.data.some((row) => row.subject === 'Other tenant ticket')).toBe(false);
    expect(touched.every((access) => access.tenant === TENANT)).toBe(true);
  });

  it('paginates', async () => {
    const page = await service().listTemplates({ page: 2, limit: 2 }, context);

    expect(page).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(page.data).toHaveLength(1);
  });

  it('returns the system default, the override and the effective content', async () => {
    store.tenant_email_templates = [{
      tenant: TENANT, id: 50, name: 'ticket-created', subject: 'Ours', html_content: '<p>ours</p>',
      text_content: 'ours', language_code: 'en', system_template_id: 1, updated_at: '2026-09-01',
    }];

    const detail = await service().getByName('ticket-created', 'en', context);

    expect(detail.system?.html_content).toBe('<p>stock</p>');
    expect(detail.tenant?.html_content).toBe('<p>ours</p>');
    expect(detail.effective.subject).toBe('Ours');
  });

  it('falls back to the system default when nothing is customized', async () => {
    const detail = await service().getByName('ticket-created', 'fr', context);

    expect(detail.tenant).toBeNull();
    expect(detail.is_customized).toBe(false);
    expect(detail.effective.subject).toBe('Nouveau ticket');
  });

  it('404s for an unknown template or language', async () => {
    await expect(service().getByName('no-such-template', 'en', context)).rejects.toThrow(/not found/);
    await expect(service().getByName('ticket-created', 'de', context)).rejects.toThrow(/not found/);
  });

  it('clones the system row on the first write and keeps the untouched fields', async () => {
    const written = await service().upsertOverride(
      'ticket-created',
      { language_code: 'en', subject: 'Hand written' },
      context,
    );

    expect(written.is_customized).toBe(true);
    expect(written.tenant?.subject).toBe('Hand written');
    expect(written.tenant?.html_content).toBe('<p>stock</p>');
    expect(store.tenant_email_templates).toHaveLength(1);
    expect(store.tenant_email_templates[0]).toMatchObject({
      tenant: TENANT, name: 'ticket-created', language_code: 'en', system_template_id: 1,
    });
    expect(store.system_email_templates.map((row) => row.subject)).toContain('New ticket');
  });

  it('patches an existing override instead of cloning again', async () => {
    await service().upsertOverride('ticket-created', { language_code: 'en', subject: 'First' }, context);
    const second = await service().upsertOverride(
      'ticket-created',
      { language_code: 'en', html_content: '<p>second</p>' },
      context,
    );

    expect(store.tenant_email_templates).toHaveLength(1);
    expect(second.tenant).toMatchObject({ subject: 'First', html_content: '<p>second</p>' });
    expect(second.updated_at).toBeTruthy();
  });

  it('writes one language without disturbing its siblings', async () => {
    await service().upsertOverride('ticket-created', { language_code: 'fr', subject: 'Le nôtre' }, context);

    expect(store.tenant_email_templates.map((row) => row.language_code)).toEqual(['fr']);
    expect((await service().getByName('ticket-created', 'en', context)).is_customized).toBe(false);
  });

  it('refuses to write a template that has no system row', async () => {
    await expect(
      service().upsertOverride('invented-template', { language_code: 'en', subject: 'x' }, context),
    ).rejects.toThrow(/not found/);
    expect(store.tenant_email_templates).toHaveLength(0);
  });

  it('deletes the override for one language only', async () => {
    await service().upsertOverride('ticket-created', { language_code: 'en', subject: 'EN' }, context);
    await service().upsertOverride('ticket-created', { language_code: 'fr', subject: 'FR' }, context);

    await service().deleteOverride('ticket-created', 'en', context);

    expect(store.tenant_email_templates.map((row) => row.language_code)).toEqual(['fr']);
  });

  it('404s when there is no override to delete', async () => {
    await expect(service().deleteOverride('ticket-created', 'en', context)).rejects.toThrow(/No customized email template/i);
  });
});
