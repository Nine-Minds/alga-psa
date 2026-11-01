import { describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';

vi.mock('server/src/lib/authorization/kernel', () => ({ getAuthorizationKernel: vi.fn() }));

import { buildPredicateGuard } from '../../../lib/api/controllers/authorizationKernel';
import { isRecordFieldReadable, PROJECT_RECORD_SOURCE, TICKET_RECORD_SOURCE } from '@alga-psa/co-managed/recordProjection';

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
