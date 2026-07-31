import { afterAll, describe, expect, it } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  compileTenantScopedResourceReadAuthorizationSql,
  type AuthorizationSubject,
  type RelationshipSqlAdapter,
} from './index';

const db = knexFactory({ client: 'pg' });

afterAll(async () => {
  await db.destroy();
});

const subject: AuthorizationSubject = {
  tenant: 'tenant-1',
  userId: 'user-1',
  userType: 'internal',
};

const adapter: RelationshipSqlAdapter = {
  ownerColumn: 't.entered_by',
  clientColumn: 't.client_id',
  boardColumn: 't.board_id',
  teamColumn: 't.assigned_team_id',
  applyAssignedUsers(builder: Knex.QueryBuilder, userIds: string[]) {
    if (userIds.length === 0) {
      builder.whereRaw('1 = 0');
      return;
    }
    builder.whereIn('t.assigned_to', userIds);
  },
};

describe('tenant-scoped relationship SQL compiler', () => {
  it('applies authorization to a tenant-scoped query', () => {
    const query = tenantDb(db, subject.tenant).scoped('tickets as t');

    const result = compileTenantScopedResourceReadAuthorizationSql(query, {
      resourceType: 'ticket',
      action: 'read',
      builtinRules: [{ template: 'own' }],
      bundleRules: [],
      ctx: { subject, adapter },
    });

    expect(result.supported).toBe(true);
    expect(query.builder.toString()).toContain('"t"."tenant" = \'tenant-1\'');
    expect(query.builder.toString()).toContain('"t"."entered_by" = \'user-1\'');
  });

  it('throws before mutating when query and subject tenants disagree', () => {
    const query = tenantDb(db, 'tenant-2').scoped('tickets as t');

    expect(() =>
      compileTenantScopedResourceReadAuthorizationSql(query, {
        resourceType: 'ticket',
        action: 'read',
        builtinRules: [{ template: 'own' }],
        bundleRules: [],
        ctx: { subject, adapter },
      })
    ).toThrow(/does not match subject tenant/);

    expect(query.builder.toString()).not.toContain('"t"."entered_by"');
  });
});
