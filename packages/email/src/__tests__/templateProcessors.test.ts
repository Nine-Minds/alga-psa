/**
 * Tests for email template processing: variable substitution (including
 * nested objects), HTML-to-text conversion and the DB-backed template
 * lookup with tenant/system + locale fallback.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StaticTemplateProcessor,
  CustomTemplateProcessor,
  DatabaseTemplateProcessor
} from '../templateProcessors';

describe('StaticTemplateProcessor', () => {
  it('substitutes {{variable}} placeholders in subject, html and text', async () => {
    const processor = new StaticTemplateProcessor(
      'Hello {{name}}',
      '<p>Hi {{name}}, your ticket {{ticketId}} is ready.</p>',
      'Hi {{name}}, your ticket {{ticketId}} is ready.'
    );

    await expect(
      processor.process({ templateData: { name: 'Natallia', ticketId: 'T-42' } })
    ).resolves.toEqual({
      subject: 'Hello Natallia',
      html: '<p>Hi Natallia, your ticket T-42 is ready.</p>',
      text: 'Hi Natallia, your ticket T-42 is ready.'
    });
  });

  it('flattens nested objects into dotted placeholder keys', async () => {
    const processor = new StaticTemplateProcessor(
      '{{ticket.priority}} ticket from {{user.profile.firstName}}',
      '<p>{{ticket.id}}</p>'
    );

    const result = await processor.process({
      templateData: {
        ticket: { id: 'T-1', priority: 'High' },
        user: { profile: { firstName: 'Ada' } }
      }
    });

    expect(result.subject).toBe('High ticket from Ada');
    expect(result.html).toBe('<p>T-1</p>');
  });

  it('replaces every occurrence of a placeholder and renders null/undefined as empty string', async () => {
    const processor = new StaticTemplateProcessor(
      '{{a}} and {{a}}',
      '<p>{{missingValue}}</p>'
    );

    const result = await processor.process({
      templateData: { a: 'x', missingValue: null }
    });

    expect(result.subject).toBe('x and x');
    expect(result.html).toBe('<p></p>');
  });

  it('leaves placeholders intact when no data key matches', async () => {
    const processor = new StaticTemplateProcessor('Hi {{name}}', '<p>{{name}}</p>');
    const result = await processor.process({ templateData: { other: 'value' } });
    expect(result.subject).toBe('Hi {{name}}');
  });

  it('does not flatten arrays or Date values', async () => {
    const when = new Date('2024-06-01T00:00:00Z');
    const processor = new StaticTemplateProcessor('{{tags}} at {{when}}', '<p></p>');

    const result = await processor.process({
      templateData: { tags: ['a', 'b'], when }
    });

    expect(result.subject).toBe(`a,b at ${String(when)}`);
  });

  it('derives the text body from the html when no text template is provided', async () => {
    const processor = new StaticTemplateProcessor(
      'Subject',
      '<div><h1>Title</h1>\n  <p>Line   one</p></div>'
    );

    const result = await processor.process({});
    expect(result.text).toBe('Title Line one');
  });

  it('returns the templates untouched when no template data is given', async () => {
    const processor = new StaticTemplateProcessor('S {{x}}', '<p>{{x}}</p>', 't {{x}}');
    await expect(processor.process({})).resolves.toEqual({
      subject: 'S {{x}}',
      html: '<p>{{x}}</p>',
      text: 't {{x}}'
    });
  });
});

describe('CustomTemplateProcessor', () => {
  it('loads templates through the provided loader and applies substitution', async () => {
    const loader = vi.fn(async () => ({
      subject: 'Loaded {{kind}}',
      html: '<p>{{kind}}</p>'
    }));
    const processor = new CustomTemplateProcessor(loader);

    const result = await processor.process({ templateData: { kind: 'invoice' }, locale: 'fr' });

    expect(loader).toHaveBeenCalledWith({ templateData: { kind: 'invoice' }, locale: 'fr' });
    expect(result).toEqual({
      subject: 'Loaded invoice',
      html: '<p>invoice</p>',
      text: 'invoice'
    });
  });
});

/**
 * Minimal fake knex: knex('table').where(filters).first() resolving against
 * a list of seeded template rows, recording every lookup for assertions.
 */
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

describe('DatabaseTemplateProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers the tenant template in the requested locale', async () => {
    const { knex } = createFakeKnex([
      {
        __table: 'tenant_email_templates',
        tenant: 't1',
        name: 'welcome',
        language_code: 'fr',
        subject: 'Bonjour {{name}}',
        html_content: '<p>Bonjour {{name}}</p>',
        text_content: 'Bonjour {{name}}'
      },
      {
        __table: 'system_email_templates',
        name: 'welcome',
        language_code: 'fr',
        subject: 'system-fr',
        html_content: '<p>system</p>',
        text_content: null
      }
    ]);

    const processor = new DatabaseTemplateProcessor(knex, 'welcome');
    await expect(
      processor.process({ tenantId: 't1', locale: 'fr', templateData: { name: 'Ada' } })
    ).resolves.toEqual({
      subject: 'Bonjour Ada',
      html: '<p>Bonjour Ada</p>',
      text: 'Bonjour Ada'
    });
  });

  it('falls back tenant-fr -> tenant-en -> system-fr -> system-en in order', async () => {
    const { knex, lookups } = createFakeKnex([
      {
        __table: 'system_email_templates',
        name: 'welcome',
        language_code: 'en',
        subject: 'system-en',
        html_content: '<p>system en</p>',
        text_content: 'system en'
      }
    ]);

    const processor = new DatabaseTemplateProcessor(knex, 'welcome');
    const result = await processor.process({ tenantId: 't1', locale: 'fr' });

    expect(result.subject).toBe('system-en');
    expect(lookups).toEqual([
      { table: 'tenant_email_templates', filters: { tenant: 't1', name: 'welcome', language_code: 'fr' } },
      { table: 'tenant_email_templates', filters: { tenant: 't1', name: 'welcome', language_code: 'en' } },
      { table: 'system_email_templates', filters: { name: 'welcome', language_code: 'fr' } },
      { table: 'system_email_templates', filters: { name: 'welcome', language_code: 'en' } }
    ]);
  });

  it('skips tenant lookups entirely when no tenantId is given', async () => {
    const { knex, lookups } = createFakeKnex([
      {
        __table: 'system_email_templates',
        name: 'welcome',
        language_code: 'en',
        subject: 'system-en',
        html_content: '<p>system en</p>',
        text_content: 'system en'
      }
    ]);

    const processor = new DatabaseTemplateProcessor(knex, 'welcome');
    await processor.process({});

    expect(lookups.every((lookup) => lookup.table === 'system_email_templates')).toBe(true);
  });

  it('derives text from html_content when text_content is empty', async () => {
    const { knex } = createFakeKnex([
      {
        __table: 'system_email_templates',
        name: 'welcome',
        language_code: 'en',
        subject: 's',
        html_content: '<p>Hello <b>world</b></p>',
        text_content: null
      }
    ]);

    const processor = new DatabaseTemplateProcessor(knex, 'welcome');
    const result = await processor.process({});
    expect(result.text).toBe('Hello world');
  });

  it('throws when the template cannot be found anywhere', async () => {
    const { knex } = createFakeKnex([]);
    const processor = new DatabaseTemplateProcessor(knex, 'missing-template');

    await expect(processor.process({ tenantId: 't1', locale: 'de' })).rejects.toThrow(
      "Template 'missing-template' not found"
    );
  });
});
