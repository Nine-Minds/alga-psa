import knex, { type Knex } from 'knex';
import { afterAll, describe, expect, it, vi } from 'vitest';

const { tenantDb } = vi.hoisted(() => ({ tenantDb: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb }));
vi.mock('../../ticketActivity', async () => ({
  ...await import('../../ticketActivity/types'),
  writeTicketActivity: vi.fn(),
}));

import { matchingRuleTemplateIds } from '../applyTemplates';

const sql = knex({ client: 'pg' });
afterAll(() => sql.destroy());

describe('matchingRuleTemplateIds SQL bindings', () => {
  it('keeps predicate values parameterized and associates each result with its rule in order', async () => {
    const hostileTitle = "x'); DROP TABLE tickets; --";
    const rules = [
      { template_id: 'title-template', where_version: 1, where: {
        join: 'and', clauses: [{ path: 'title_folded', operator: 'equals', value: hostileTitle }],
      } },
      { template_id: 'request-template', where_version: 1, where: {
        join: 'and', clauses: [{ path: 'from_service_request', operator: 'equals', value: true }],
      } },
      { template_id: 'fallback-template', where_version: 1, where: { join: 'and', clauses: [] } },
    ];
    const ruleQuery = {
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue(rules),
    };
    let projections: Knex.Raw[] = [];
    const ticketQuery = {
      where: vi.fn().mockReturnThis(),
      select: vi.fn((values: Knex.Raw[]) => { projections = values; return ticketQuery; }),
      first: vi.fn().mockResolvedValue({ r0: true, r1: false, r2: true }),
    };
    tenantDb.mockReturnValue({
      table: (name: string) => name === 'tickets as t' ? ticketQuery : ruleQuery,
      tenantJoin: () => ruleQuery,
    });

    await expect(matchingRuleTemplateIds(sql as unknown as Knex.Transaction, 'tenant', 'ticket'))
      .resolves.toEqual(['title-template', 'fallback-template']);

    const compiled = projections.map((projection) => projection.toSQL());
    expect(compiled).toHaveLength(3);
    expect(compiled[0].bindings).toEqual([hostileTitle]);
    expect(compiled[0].sql).not.toContain(hostileTitle);
    expect(compiled[0].sql).toContain('"t"."title"');
    expect(compiled[1].bindings).toEqual([true]);
    expect(compiled[1].sql).toContain('"t"."tenant"');
    expect(compiled[1].sql).toContain('"t"."ticket_id"');
    expect(compiled[2].bindings).toEqual([]);
    compiled.forEach((projection, index) => expect(projection.sql).toMatch(new RegExp(` AS "r${index}"$`)));
    expect(ticketQuery.where).toHaveBeenCalledWith('t.ticket_id', 'ticket');
  });
});
