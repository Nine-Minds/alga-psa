import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowedOperators, resolvePath, validateClause } from '@alga-psa/predicates';
import type { PredicateClause } from '@alga-psa/predicates';
import { compilePredicateFragment } from '@alga-psa/predicates/sql';
import { TICKET_COMPUTED_ATTRIBUTES, createTicketQuerySchema, ticketQuerySchema } from './ticketQuerySchema';

const NOW = '2026-10-25T12:00:00.000Z';
const schema = createTicketQuerySchema(() => NOW);
const UUID = '11111111-1111-4111-8111-111111111111';

const SAMPLE_VALUES: Record<string, PredicateClause['value']> = {
  title_folded: 'onboarding',
  description_folded: 'onboarding',
  from_service_request: true,
  service_request_definition_id: UUID,
  board_inactive: true,
  status_closed: false,
  status_name: 'Open',
  category: [UUID],
  sla_state: 'breached',
  involves_user: UUID,
};

describe('ticket query schema: computed attributes (T032)', () => {
  it('enumerates exactly the computed attributes the schema declares', () => {
    const declared = Object.entries(schema.attributes)
      .filter(([, attribute]) => attribute.kind === 'computed')
      .map(([name]) => name)
      .sort();
    expect(declared).toEqual([...TICKET_COMPUTED_ATTRIBUTES].sort());
    expect(Object.keys(SAMPLE_VALUES).sort()).toEqual(declared);
  });

  it.each(TICKET_COMPUTED_ATTRIBUTES)('%s compiles for every allowed operator and correlates on tenant', (name) => {
    const attribute = schema.attributes[name];
    for (const operator of allowedOperators(attribute)) {
      const sample = SAMPLE_VALUES[name] as PredicateClause["value"];
      const value = operator === 'is_empty' || operator === 'is_not_empty' ? undefined
        : operator === 'in' || operator === 'not_in' ? (Array.isArray(sample) ? sample : [sample!])
        : sample;
      const clause: PredicateClause = { path: name, operator, value };
      expect(validateClause(schema, clause)).toBeNull();
      const fragment = compilePredicateFragment(schema, clause, { rootAlias: 't' });
      expect(fragment.sql).not.toBe('');
      // Every `?` has a binding and every subselect is tenant-correlated.
      const placeholders = (fragment.sql.match(/\?\??/g) ?? []).length;
      expect(fragment.bindings).toHaveLength(placeholders);
      const subselects = (fragment.sql.match(/\(SELECT 1 FROM/g) ?? []).length;
      const correlations = (fragment.sql.match(/\.tenant = \?\?/g) ?? []).length;
      expect(correlations).toBeGreaterThanOrEqual(subselects);
    }
  });

  it('every sla_state value compiles to a two-valued boolean on the pinned clock', () => {
    for (const state of ['on_track', 'breached', 'paused', 'unknown']) {
      const fragment = compilePredicateFragment(schema, { path: 'sla_state', operator: 'equals', value: state }, { rootAlias: 't' });
      expect(fragment.sql.length).toBeGreaterThan(0);
      if (state === 'breached' || state === 'on_track') expect(fragment.bindings).toContain(NOW);
    }
  });

  it('declares no raw SQL outside the computed resolvers', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../../shared/lib/ticketQuery/ticketQuerySchema.ts'), 'utf8');
    const resolversStart = source.indexOf('const COMPUTED_RESOLVERS');
    const resolversEnd = source.indexOf('export type TicketComputedAttributeName');
    expect(resolversStart).toBeGreaterThan(0);
    expect(resolversEnd).toBeGreaterThan(resolversStart);
    const outside = source.slice(0, resolversStart) + source.slice(resolversEnd);
    // Strip comments before looking for SQL keywords.
    const code = outside.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b(SELECT|EXISTS|WHERE|JOIN)\b/);
    expect(code).not.toMatch(/\bsql\s*:/);
  });
});

describe('ticket query schema: paths', () => {
  it.each([
    ['contact.tags', 'in'],
    ['contact.tags', 'not_in'],
    ['client.tags', 'is_empty'],
    ['tags', 'in'],
    ['client.id', 'equals'],
    ['due_date', 'lt'],
    ['response_state', 'is_empty'],
    ['location_id', 'equals'],
    ['location_id', 'in'],
    ['location_id', 'not_in'],
    ['location_id', 'is_empty'],
    ['location_id', 'is_not_empty'],
    ['contact.locations', 'in'],
    ['contact.locations', 'not_in'],
    ['contact.locations', 'is_empty'],
    ['contact.locations', 'is_not_empty'],
  ] as const)('accepts %s %s', (path, operator) => {
    expect(resolvePath(ticketQuerySchema, path)).not.toBeNull();
    expect(allowedOperators(resolvePath(ticketQuerySchema, path)!.attribute)).toContain(operator);
  });

  it('rejects unknown paths and disallowed operators', () => {
    expect(resolvePath(ticketQuerySchema, 'contact.is_vip')).toBeNull();
    expect(resolvePath(ticketQuerySchema, 'requester_vip')).toBeNull();
    expect(validateClause(ticketQuerySchema, { path: 'contact.tags', operator: 'contains', value: 'x' })?.code).toBe('operator_not_allowed');
    expect(validateClause(ticketQuerySchema, { path: 'contact.tags', operator: 'in', value: ['VIP'] })?.code).toBe('bad_value');
  });

  // The two location paths are a persisted filter contract from first release (saved views, URLs),
  // so their operator sets and value types are pinned here rather than left to drift.
  it('pins the location paths to uuid values and the declared operators', () => {
    expect([...allowedOperators(resolvePath(ticketQuerySchema, 'location_id')!.attribute)].sort())
      .toEqual(['equals', 'in', 'is_empty', 'is_not_empty', 'not_in']);
    expect([...allowedOperators(resolvePath(ticketQuerySchema, 'contact.locations')!.attribute)].sort())
      .toEqual(['in', 'is_empty', 'is_not_empty', 'not_in']);

    expect(validateClause(ticketQuerySchema, { path: 'location_id', operator: 'contains', value: 'x' })?.code)
      .toBe('operator_not_allowed');
    expect(validateClause(ticketQuerySchema, { path: 'contact.locations', operator: 'equals', value: UUID })?.code)
      .toBe('operator_not_allowed');
    expect(validateClause(ticketQuerySchema, { path: 'contact.locations', operator: 'in', value: ['Warehouse'] })?.code)
      .toBe('bad_value');
    expect(validateClause(ticketQuerySchema, { path: 'location_id', operator: 'in', value: [UUID] })).toBeNull();
    expect(validateClause(ticketQuerySchema, { path: 'contact.locations', operator: 'in', value: [UUID] })).toBeNull();
  });

  // A requester's locations are a set over contact_locations, so the clause has to reach through
  // the contact hop and correlate both hops on tenant — the same shape a tag clause compiles to.
  it('compiles contact.locations as a tenant-correlated subselect through the contact hop', () => {
    const fragment = compilePredicateFragment(
      schema,
      { path: 'contact.locations', operator: 'in', value: [UUID] },
      { rootAlias: 't' },
    );
    // Identifiers are bound (??), so the table names and both tenant correlations live in the
    // bindings: two nested EXISTS, each correlated on tenant.
    expect(fragment.bindings).toContain('contact_locations');
    expect(fragment.bindings).toContain('contacts');
    expect((fragment.sql.match(/EXISTS \(SELECT 1 FROM/g) ?? []).length).toBe(2);
    expect(fragment.bindings.filter((binding) => String(binding).endsWith('.tenant'))).toHaveLength(4);
  });

  it('compiles location_id without a join, like any other ticket column', () => {
    const fragment = compilePredicateFragment(
      schema,
      { path: 'location_id', operator: 'in', value: [UUID] },
      { rootAlias: 't' },
    );
    // Columns bind their identifier (??), so no subselect and no join: the clause is on `tickets`.
    expect(fragment.bindings[0]).toBe('t.location_id');
    expect(fragment.sql).not.toContain('SELECT 1 FROM');
  });
});
