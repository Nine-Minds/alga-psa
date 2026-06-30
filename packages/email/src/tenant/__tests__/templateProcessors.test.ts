/**
 * Tests for the tenant-flavoured DatabaseTemplateProcessor, which
 * normalizes the locale, walks tenant -> system fallbacks and always
 * runs variable substitution (even with no template data).
 */
import { describe, expect, it } from 'vitest';
import { DatabaseTemplateProcessor, StaticTemplateProcessor } from '../templateProcessors';

function createFakeKnex(rows: Array<Record<string, any>>) {
  const lookups: Array<{ table: string; filters: Record<string, any> }> = [];

  const normalizeColumn = (column: string) => column.split('.').pop() ?? column;
  const normalizeFilters = (args: unknown[]): Record<string, any> => {
    const [first, second] = args;
    if (typeof first === 'string') {
      return { [normalizeColumn(first)]: second };
    }

    return Object.fromEntries(
      Object.entries(first as Record<string, any>).map(([key, value]) => [normalizeColumn(key), value])
    );
  };

  const createQuery = (table: string, filters: Record<string, any> = {}) => ({
    where(...args: unknown[]) {
      return createQuery(table, { ...filters, ...normalizeFilters(args) });
    },
    async first() {
      lookups.push({ table, filters });
      return rows.find(
        (row) =>
          row.__table === table &&
          Object.entries(filters).every(([key, value]) => row[key] === value)
      );
    }
  });

  const knex = (table: string) => createQuery(table);
  return { knex: knex as any, lookups };
}

const systemEnRow = {
  __table: 'system_email_templates',
  name: 'ticket-created',
  language_code: 'en',
  subject: 'Ticket {{ticket.id}}',
  html_content: '<p>{{ticket.id}}</p>',
  text_content: 'Ticket {{ticket.id}}'
};

describe('tenant DatabaseTemplateProcessor', () => {
  it('lower-cases the requested locale before querying', async () => {
    const { knex, lookups } = createFakeKnex([
      { ...systemEnRow, language_code: 'fr', subject: 'fr', html_content: '<p>fr</p>', text_content: 'fr' }
    ]);

    const processor = new DatabaseTemplateProcessor(knex, 'ticket-created');
    const result = await processor.process({ locale: 'FR' });

    expect(result.subject).toBe('fr');
    expect(lookups[0].filters.language_code).toBe('fr');
  });

  it('checks all tenant locales before any system locale', async () => {
    const { knex, lookups } = createFakeKnex([systemEnRow]);

    const processor = new DatabaseTemplateProcessor(knex, 'ticket-created');
    await processor.process({ tenantId: 't1', locale: 'de', templateData: { ticket: { id: 'T-9' } } });

    expect(lookups.map((l) => [l.table, l.filters.language_code])).toEqual([
      ['tenant_email_templates', 'de'],
      ['tenant_email_templates', 'en'],
      ['system_email_templates', 'de'],
      ['system_email_templates', 'en']
    ]);
  });

  it('only queries English once when the requested locale is already en', async () => {
    const { knex, lookups } = createFakeKnex([systemEnRow]);

    const processor = new DatabaseTemplateProcessor(knex, 'ticket-created');
    await processor.process({ tenantId: 't1', locale: 'en' });

    expect(lookups.map((l) => [l.table, l.filters.language_code])).toEqual([
      ['tenant_email_templates', 'en'],
      ['system_email_templates', 'en']
    ]);
  });

  it('substitutes nested template data into the resolved template', async () => {
    const { knex } = createFakeKnex([systemEnRow]);

    const processor = new DatabaseTemplateProcessor(knex, 'ticket-created');
    await expect(
      processor.process({ templateData: { ticket: { id: 'T-9' } } })
    ).resolves.toEqual({
      subject: 'Ticket T-9',
      html: '<p>T-9</p>',
      text: 'Ticket T-9'
    });
  });

  it('includes the tenant context in the not-found error message', async () => {
    const { knex } = createFakeKnex([]);
    const processor = new DatabaseTemplateProcessor(knex, 'ghost');

    await expect(processor.process({ tenantId: 't1' })).rejects.toThrow(
      "Template 'ghost' not found for tenant t1"
    );
    await expect(processor.process({})).rejects.toThrow("Template 'ghost' not found for system");
  });
});

describe('tenant StaticTemplateProcessor', () => {
  it('behaves like the shared static processor (substitution + html-to-text)', async () => {
    const processor = new StaticTemplateProcessor('Hi {{user.name}}', '<p>Hi <b>{{user.name}}</b></p>');

    await expect(
      processor.process({ templateData: { user: { name: 'Ada' } } })
    ).resolves.toEqual({
      subject: 'Hi Ada',
      html: '<p>Hi <b>Ada</b></p>',
      text: 'Hi Ada'
    });
  });
});
