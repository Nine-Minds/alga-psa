import knexFactory from 'knex';
import { describe, expect, it } from 'vitest';
import { createDocumentRelationshipSqlAdapter } from '@shared/lib/documentAuthorization';

// The SQL facet of the seat resolver's ticket guards, as the document adapter maps it (S31, F076).
const knex = knexFactory({ client: 'pg' });
const adapter = createDocumentRelationshipSqlAdapter({ documentAlias: 'd' });
const sql = (quantifier: 'every' | 'some', scope = { clientIds: ['c1'], boardIds: ['b1', 'b2'] }) => {
  const builder = knex('documents as d');
  adapter.applyAttachedTickets!(builder, scope, quantifier);
  return builder.toSQL().toNative();
};

describe('document adapter: tickets a document is attached to', () => {
  it('`some`: an association to a ticket whose client and board are both in scope', () => {
    const { sql: text, bindings } = sql('some');
    expect(text).toContain('exists (select 1 from "document_associations" as "scope_dt" inner join "tickets" as "t"');
    expect(text).toContain('"t"."tenant" = "scope_dt"."tenant" and "t"."ticket_id" = "scope_dt"."entity_id"');
    expect(text).toContain('"scope_dt"."tenant" = "d"."tenant"');
    expect(text).toContain('"scope_dt"."document_id" = "d"."document_id"');
    expect(text).toContain(`"scope_dt"."entity_type" = $`);
    expect(text).toContain('coalesce(t.client_id::text = any($');
    expect(text).not.toContain('not coalesce');
    expect(bindings).toContain('ticket');
    expect(bindings).toContainEqual(['c1']);
    expect(bindings).toContainEqual(['b1', 'b2']);
  });

  it('`every`: no association to a ticket outside the scope; a ticket with no board counts as outside', () => {
    const { sql: text } = sql('every');
    expect(text).toContain('not exists (select 1 from "document_associations" as "scope_dt"');
    // `not coalesce(.., false)`: a null board is outside the scope instead of unknown (which would let it through).
    expect(text).toContain('not coalesce(t.client_id::text = any($');
  });

  it('an empty scope: nothing is in scope, so `some` matches no row and `every` admits only a document attached to no ticket', () => {
    const { bindings } = sql('some', { clientIds: [], boardIds: [] });
    expect(bindings).toContainEqual([]);
  });
});
