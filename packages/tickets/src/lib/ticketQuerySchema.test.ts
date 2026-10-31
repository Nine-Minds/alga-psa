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
});
