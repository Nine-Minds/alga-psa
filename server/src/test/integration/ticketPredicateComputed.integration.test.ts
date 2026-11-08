import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { compilePredicateFragment } from '@alga-psa/predicates/sql';
import { createTicketQuerySchema } from '@alga-psa/tickets/lib/ticketQuerySchema';
import { unicodeLowerV1, type PredicateClause } from '@alga-psa/predicates';

const describeDb = await describeWithDb();

describeDb('ticket folded attributes in PostgreSQL', () => {
  let db: Knex;
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
  });
  afterAll(async () => { await db?.destroy(); });

  async function evaluate(clause: PredicateClause, title: string | null, description: unknown) {
    const fragment = compilePredicateFragment(createTicketQuerySchema(), clause, { rootAlias: 't' });
    const result = await db.raw(`SELECT (${fragment.sql}) AS matches FROM (SELECT ?::text AS title, ?::jsonb AS attributes) AS t`, [
      ...fragment.bindings, title, JSON.stringify({ description }),
    ]);
    return result.rows[0].matches;
  }

  it('folds case while treating percent, underscore, and backslash as literal substrings', async () => {
    const clause: PredicateClause = { path: 'title_folded', operator: 'contains', value: 'a%_\\b' };
    expect(await evaluate(clause, 'START A%_\\B end', null)).toBe(true);
    expect(await evaluate(clause, 'START AXYYB end', null)).toBe(false);
  });

  it('matches plain and block descriptions and joins block boundaries with a space', async () => {
    const clause: PredicateClause = { path: 'description_folded', operator: 'contains', value: 'hello world' };
    expect(await evaluate(clause, null, 'HELLO WORLD')).toBe(true);
    expect(await evaluate(clause, null, [{ content: [{ type: 'text', text: 'Hello' }] }, { content: [{ type: 'text', text: 'World' }] }])).toBe(true);
    expect(await evaluate(clause, null, [{ content: [{ type: 'text', text: 'Hello' }] }])).toBe(false);
  });

  it('correlates service-request predicates by tenant and ticket inside the transaction', async () => {
    const tenant = '11111111-1111-4111-8111-111111111111';
    const otherTenant = '22222222-2222-4222-8222-222222222222';
    const ticket = '33333333-3333-4333-8333-333333333333';
    const definition = '44444444-4444-4444-8444-444444444444';
    await db.transaction(async (trx) => {
      await trx.raw('CREATE TEMP TABLE service_request_submissions (tenant uuid, created_ticket_id uuid, definition_id uuid) ON COMMIT DROP');
      await trx('service_request_submissions').insert({ tenant: otherTenant, created_ticket_id: ticket, definition_id: definition });
      async function matches(clause: PredicateClause) {
        const fragment = compilePredicateFragment(createTicketQuerySchema(), clause, { rootAlias: 't' });
        const result = await trx.raw(`SELECT (${fragment.sql}) AS matches FROM (SELECT ?::uuid AS tenant, ?::uuid AS ticket_id) AS t`, [...fragment.bindings, tenant, ticket]);
        return result.rows[0].matches;
      }
      expect(await matches({ path: 'from_service_request', operator: 'equals', value: true })).toBe(false);
      await trx('service_request_submissions').insert({ tenant, created_ticket_id: ticket, definition_id: definition });
      expect(await matches({ path: 'from_service_request', operator: 'equals', value: true })).toBe(true);
      expect(await matches({ path: 'service_request_definition_id', operator: 'in', value: [definition] })).toBe(true);
    });
  });

  it('searches visible text rather than serialized JSON markup', async () => {
    const serialized = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Visible' }] }]);
    // Serialized and parsed documents have the same visible-text projection.
    expect(await evaluate({ path: 'description_folded', operator: 'contains', value: 'paragraph' }, null, serialized)).toBe(false);
  });

  it('uses JavaScript Unicode casing, including dotted I and contextual final sigma', async () => {
    for (const text of ['İ', 'ΟΣ', 'ΟΣΑ', 'Ο\u0301Σ', 'Σ', 'École', '𐐀']) {
      const result = await db.raw('SELECT alga_predicate_lower_v1(?::text) AS folded', [text]);
      expect(result.rows[0].folded).toBe(text.toLowerCase());
      expect(await evaluate({ path: 'title_folded', operator: 'contains', value: text.toLowerCase() }, text, null)).toBe(true);
    }
  });

  it('decodes a serialized attributes object before projecting its description', async () => {
    const fragment = compilePredicateFragment(createTicketQuerySchema(), { path: 'description_folded', operator: 'contains', value: 'visible' }, { rootAlias: 't' });
    const attributes = JSON.stringify(JSON.stringify({ description: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Visible' }] }]) }));
    const result = await db.raw(`SELECT (${fragment.sql}) AS matches FROM (SELECT ?::jsonb AS attributes) AS t`, [...fragment.bindings, attributes]);
    expect(result.rows[0].matches).toBe(true);
  });

  it('matches frozen v1 casing for all Unicode code points that change case and their sigma contexts', async () => {
    const input: string[] = [];
    for (let codepoint = 1; codepoint <= 0x10ffff; codepoint++) {
      if (codepoint >= 0xd800 && codepoint <= 0xdfff) continue;
      const character = String.fromCodePoint(codepoint);
      if (character !== unicodeLowerV1(character) || character !== character.toLowerCase()) input.push(character, `A${character}Σ`, `ΑΣ${character}`);
    }
    const cases = input.map((text) => [text, unicodeLowerV1(text)]);
    const result = await db.raw(`SELECT item->>0 AS input FROM jsonb_array_elements(?::jsonb) AS item
      WHERE alga_predicate_lower_v1(item->>0) IS DISTINCT FROM item->>1 LIMIT 5`, [JSON.stringify(cases)]);
    expect(result.rows).toEqual([]);
  });

  it('treats missing text as empty and comparisons as two-valued', async () => {
    expect(await evaluate({ path: 'description_folded', operator: 'is_empty' }, null, null)).toBe(true);
    expect(await evaluate({ path: 'title_folded', operator: 'contains', value: 'x' }, null, null)).toBe(false);
  });
});
