import { describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';
import { getAuthorizationKernel } from 'server/src/lib/authorization/kernel';

vi.mock('server/src/lib/authorization/kernel', () => ({ getAuthorizationKernel: vi.fn() }));

import { buildPredicateGuard, createPredicateGuard } from '../../../lib/api/controllers/authorizationKernel';
import {
  isRecordFieldReadable,
  projectRecordByRedactions,
  ASSET_RECORD_SOURCE,
  PROJECT_RECORD_SOURCE,
  QUOTE_RECORD_SOURCE,
  TICKET_RECORD_SOURCE,
} from '@alga-psa/co-managed/recordProjection';

const qb = () => knexFactory({ client: 'pg' }).queryBuilder().from('projects');

describe('isRecordFieldReadable (descriptor-driven)', () => {
  it('hides a field by its own name, its values./table. forms and descriptor aliases', () => {
    expect(isRecordFieldReadable(['description'], PROJECT_RECORD_SOURCE, 'description')).toBe(false);
    expect(isRecordFieldReadable(['projects.description'], PROJECT_RECORD_SOURCE, 'description')).toBe(false);
    expect(isRecordFieldReadable(['description'], PROJECT_RECORD_SOURCE, 'project_name')).toBe(true);
  });

  it('hides derived fields whose source is hidden', () => {
    expect(isRecordFieldReadable(['client_id'], PROJECT_RECORD_SOURCE, 'client_name')).toBe(false);
    expect(isRecordFieldReadable(['assigned_to'], TICKET_RECORD_SOURCE, 'assigned_to_name')).toBe(false);
    expect(isRecordFieldReadable(['assigned_to'], TICKET_RECORD_SOURCE, 'title')).toBe(true);
  });

  it.each(['tickets.assigned_to', 'values.assigned_to'])(
    'hides derived ticket names when the dependency is redacted as %s', (alias) => {
      expect(isRecordFieldReadable([alias], TICKET_RECORD_SOURCE, 'assigned_to_name')).toBe(false);
      expect(buildPredicateGuard('ticket', [alias]).columns([
        { column: 't.assigned_to_name', field: 'assigned_to_name' },
        { column: 't.title', field: 'title' },
      ])).toEqual(['t.title']);
    },
  );

  it.each([
    ['entered_by', 'entered_by_name'],
    ['board_id', 'board_name'],
    ['subcategory_id', 'subcategory_name'],
    ['attributes', 'description_html'],
    ['contact_name_id', 'contact_avatar_url'],
    ['client_id', 'client_logo_url'],
  ])('projects and guards ticket field %s -> %s', (sourceField, derivedField) => {
    const record = {
      ticket_id: 'ticket-1',
      [sourceField]: `${sourceField}-value`,
      [derivedField]: `${derivedField}-visible`,
    };
    expect(projectRecordByRedactions([], record, TICKET_RECORD_SOURCE)?.[derivedField]).toBe(`${derivedField}-visible`);

    for (const alias of [sourceField, `values.${sourceField}`, `tickets.${sourceField}`]) {
      const projected = projectRecordByRedactions([alias], record, TICKET_RECORD_SOURCE);
      expect(projected).not.toHaveProperty(sourceField);
      expect(projected?.[derivedField], alias).toBeNull();
      expect(buildPredicateGuard('ticket', [alias]).columns([
        { column: `t.${derivedField}`, field: derivedField },
        { column: 't.title', field: 'title' },
      ])).toEqual(['t.title']);
    }
  });

  it('projects and guards display quote numbers through quote_number and version', () => {
    const record = { quote_id: 'quote-1', quote_number: 'Q-9', version: 2, display_quote_number: 'Q-9 v2' };
    expect(projectRecordByRedactions([], record, QUOTE_RECORD_SOURCE)?.display_quote_number).toBe('Q-9 v2');

    for (const alias of ['quote_number', 'values.quote_number', 'quotes.quote_number', 'version']) {
      const projected = projectRecordByRedactions([alias], record, QUOTE_RECORD_SOURCE);
      expect(projected).not.toHaveProperty(alias === 'version' ? 'version' : 'quote_number');
      expect(projected?.display_quote_number, alias).toBeNull();
      expect(buildPredicateGuard('quote', [alias]).columns([
        { column: 'q.display_quote_number', field: 'display_quote_number' },
        { column: 'q.title', field: 'title' },
      ])).toEqual(['q.title']);
    }
  });

  it('suppresses each resource when a values-prefixed identifier alias is hidden', () => {
    const cases = [
      [PROJECT_RECORD_SOURCE, 'project_id', { project_id: 'project-1', project_name: 'Project' }],
      [TICKET_RECORD_SOURCE, 'ticket_id', { ticket_id: 'ticket-1', title: 'Ticket' }],
      [QUOTE_RECORD_SOURCE, 'quote_id', { quote_id: 'quote-1', title: 'Quote' }],
      [ASSET_RECORD_SOURCE, 'asset_id', { asset_id: 'asset-1', name: 'Asset' }],
    ] as const;

    for (const [source, identifier, record] of cases) {
      expect(projectRecordByRedactions([], record, source)).not.toBeNull();
      expect(projectRecordByRedactions([`values.${identifier}`], record, source)).toBeNull();
    }
  });

  it('fails closed on wildcard, suppression and uninterpretable entries', () => {
    expect(isRecordFieldReadable(['*'], PROJECT_RECORD_SOURCE, 'project_name')).toBe(false);
    expect(isRecordFieldReadable(['projects'], PROJECT_RECORD_SOURCE, 'project_name')).toBe(false);
    expect(isRecordFieldReadable([42 as any], PROJECT_RECORD_SOURCE, 'project_name')).toBe(false);
    expect(isRecordFieldReadable([], PROJECT_RECORD_SOURCE, 'description')).toBe(true);
  });
});

describe('buildPredicateGuard', () => {
  it('drops hidden columns from the search OR-group', () => {
    const guard = buildPredicateGuard('project', ['description']);
    const sql = guard.search(qb(), ['projects.project_name', 'projects.description'], 'x').toSQL().sql;
    expect(sql).toContain('"projects"."project_name" ilike');
    expect(sql).not.toContain('description');
  });

  it('matches nothing when no searchable column is readable', () => {
    const guard = buildPredicateGuard('project', ['description']);
    expect(guard.search(qb(), ['projects.description'], 'x').toSQL().sql).toContain('1 = 0');
  });

  it('turns a filter on a hidden column into match-nothing and leaves visible ones alone', () => {
    const guard = buildPredicateGuard('ticket', ['assigned_to']);
    const hidden = guard.filter(qb(), 't.assigned_to', (q, c) => { q.where(c, 'u'); }).toSQL().sql;
    expect(hidden).toContain('1 = 0');
    expect(hidden).not.toContain('assigned_to');
    expect(guard.filter(qb(), 't.client_id', (q, c) => { q.where(c, 'u'); }).toSQL().sql).toContain('"t"."client_id" = ?');
  });
});

describe('createPredicateGuard principal resolution', () => {
  const authorizeResource = vi.fn();
  const setup = () => {
    authorizeResource.mockReset();
    authorizeResource.mockResolvedValue({ allowed: true, redactedFields: ['description'] });
    (getAuthorizationKernel as any).mockResolvedValue({ authorizeResource });
  };

  it('builds the subject from context.userId when there is no user object', async () => {
    setup();
    const guard = await createPredicateGuard({} as any, { tenant: 't1', userId: 'u1' }, 'project');
    expect(authorizeResource).toHaveBeenCalledTimes(1);
    expect(authorizeResource.mock.calls[0][0].subject).toMatchObject({ userId: 'u1', tenant: 't1' });
    expect(guard.readable('projects.description')).toBe(false);
  });

  it('accepts tenantId as the tenant key', async () => {
    setup();
    await createPredicateGuard({} as any, { tenantId: 't2', userId: 'u1' }, 'project');
    expect(authorizeResource.mock.calls[0][0].subject.tenant).toBe('t2');
  });

  it('skips the kernel and treats every column as readable when there is no principal', async () => {
    setup();
    const guard = await createPredicateGuard({} as any, { tenant: 't1', userId: '' }, 'project');
    expect(authorizeResource).not.toHaveBeenCalled();
    expect(guard.readable('projects.description')).toBe(true);
    expect(guard.readable('projects.project_name')).toBe(true);
  });
});
