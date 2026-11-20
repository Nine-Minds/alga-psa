import { describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import { BundleAuthorizationKernelProvider, compileBundleReadNarrowingSql } from '../kernel';

const db = knexFactory({ client: 'pg' });

const input = {
  subject: { tenant: 'tenant-1', userId: 'user-1', userType: 'internal' as const },
  resource: { type: 'ticket', action: 'delete' },
  record: { id: 'ticket-1', ownerUserId: 'someone-else' },
};

describe('bundle mutation action aliases', () => {
  it('applies update bundle rules to delete when no exact delete rule exists', async () => {
    const provider = new BundleAuthorizationKernelProvider({
      resolveRules: async () => [{ id: 'update-own', resource: 'ticket', action: 'update', templateKey: 'own' }],
    });
    const result = await provider.evaluateNarrowing(input);

    expect(result.scope.denied).toBe(true);
    expect(result.reasons[0]?.metadata?.ruleIds).toEqual(['update-own']);

    const query = db('tickets');
    compileBundleReadNarrowingSql(query, [
      { id: 'update-own', resource: 'ticket', action: 'update', templateKey: 'own' },
    ], 'ticket', 'delete', {
      subject: input.subject,
      adapter: {
        ownerColumn: 'tickets.entered_by',
        clientColumn: 'tickets.client_id',
        boardColumn: 'tickets.board_id',
        teamColumn: 'tickets.assigned_team_id',
        applyAssignedUsers: () => undefined,
      },
    });
    expect(query.toSQL().sql).toContain('"tickets"."entered_by"');
  });

  it('lets an exact delete rule replace the update alias', async () => {
    const provider = new BundleAuthorizationKernelProvider({
      resolveRules: async () => [
        { id: 'update-own', resource: 'ticket', action: 'update', templateKey: 'own' },
        { id: 'delete-all', resource: 'ticket', action: 'delete' },
      ],
    });
    const result = await provider.evaluateNarrowing(input);

    expect(result.scope.denied).toBe(false);
    expect(result.reasons[0]?.metadata?.ruleIds).toEqual(['delete-all']);
  });
});
