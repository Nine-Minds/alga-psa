import { afterAll, describe, expect, it } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import {
  compileRelationshipTemplateSql,
  compileResourceReadAuthorizationSql,
  type AuthorizationSubject,
  type RelationshipSqlAdapter,
  type RelationshipSqlContext,
  type RelationshipTemplateKey,
} from '@alga-psa/authorization/kernel';

// Build SQL offline (no DB connection) and assert the generated predicate text.
const db = knexFactory({ client: 'pg' });

afterAll(async () => {
  await db.destroy();
});

const ALL_TEMPLATES: RelationshipTemplateKey[] = [
  'own',
  'assigned',
  'managed',
  'own_or_assigned',
  'own_or_managed',
  'same_client',
  'client_portfolio',
  'selected_clients',
  'same_team',
  'selected_boards',
];

const subject: AuthorizationSubject = {
  tenant: 'tenant-1',
  userId: 'user-1',
  userType: 'internal',
  teamIds: ['team-1'],
  managedUserIds: ['managed-1'],
  portfolioClientIds: ['client-1', 'client-2'],
  clientId: 'client-1',
};

const adapter: RelationshipSqlAdapter = {
  ownerColumn: 't.entered_by',
  clientColumn: 't.client_id',
  boardColumn: 't.board_id',
  teamColumn: 't.assigned_team_id',
  applyAssignedUsers(builder, userIds) {
    if (userIds.length === 0) {
      builder.whereRaw('1 = 0');
      return;
    }
    builder.whereIn('t.assigned_to', userIds).orWhereExists(function exists(this: Knex.QueryBuilder) {
      this.select(db.raw('1'))
        .from('ticket_resources as tr')
        .whereRaw('tr.ticket_id = t.ticket_id')
        .whereIn('tr.additional_user_id', userIds);
    });
  },
};

function ctx(overrides: Partial<RelationshipSqlContext> = {}): RelationshipSqlContext {
  return { subject, adapter, ...overrides };
}

function sql(build: (builder: Knex.QueryBuilder) => void): string {
  const builder = db('tickets as t').where('t.tenant', subject.tenant);
  build(builder);
  return builder.toString().toLowerCase();
}

describe('relationship template SQL compiler', () => {
  it('compiles every relationship template without throwing', () => {
    for (const template of ALL_TEMPLATES) {
      const text = sql((b) => compileRelationshipTemplateSql(b, template, ctx({ selectedBoardIds: ['board-1'], selectedClientIds: ['client-9'] })));
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('maps scalar-column templates to equality / IN predicates', () => {
    expect(sql((b) => compileRelationshipTemplateSql(b, 'own', ctx()))).toContain('"t"."entered_by" = \'user-1\'');
    expect(sql((b) => compileRelationshipTemplateSql(b, 'same_client', ctx()))).toContain('"t"."client_id" = \'client-1\'');
    expect(sql((b) => compileRelationshipTemplateSql(b, 'client_portfolio', ctx()))).toContain(
      '"t"."client_id" in (\'client-1\', \'client-2\')'
    );
    expect(sql((b) => compileRelationshipTemplateSql(b, 'same_team', ctx()))).toContain('"t"."assigned_team_id" in (\'team-1\')');
    expect(sql((b) => compileRelationshipTemplateSql(b, 'selected_boards', ctx({ selectedBoardIds: ['board-1'] })))).toContain(
      '"t"."board_id" in (\'board-1\')'
    );
    expect(sql((b) => compileRelationshipTemplateSql(b, 'selected_clients', ctx({ selectedClientIds: ['client-9'] })))).toContain(
      '"t"."client_id" in (\'client-9\')'
    );
  });

  it('denies (1 = 0) when a template has nothing to match', () => {
    expect(sql((b) => compileRelationshipTemplateSql(b, 'same_client', ctx({ subject: { ...subject, clientId: null } })))).toContain('1 = 0');
    expect(sql((b) => compileRelationshipTemplateSql(b, 'selected_boards', ctx({ selectedBoardIds: [] })))).toContain('1 = 0');
    expect(sql((b) => compileRelationshipTemplateSql(b, 'managed', ctx({ subject: { ...subject, managedUserIds: [] } })))).toContain('1 = 0');
  });

  it('routes assignment templates through the adapter (primary + co-assignee)', () => {
    const assigned = sql((b) => compileRelationshipTemplateSql(b, 'assigned', ctx()));
    expect(assigned).toContain('"t"."assigned_to" in (\'user-1\')');
    expect(assigned).toContain('exists');
    expect(assigned).toContain('additional_user_id');

    const ownOrAssigned = sql((b) => compileRelationshipTemplateSql(b, 'own_or_assigned', ctx()));
    expect(ownOrAssigned).toContain('"t"."entered_by" = \'user-1\'');
    expect(ownOrAssigned).toContain('"t"."assigned_to" in (\'user-1\')');
    expect(ownOrAssigned).toContain(' or ');
  });
});

describe('resource read authorization SQL compiler', () => {
  it('applies builtin relationship rules as an OR group', () => {
    const result: { supported: boolean } = { supported: true };
    const text = sql((b) => {
      const r = compileResourceReadAuthorizationSql(b, {
        resourceType: 'ticket',
        action: 'read',
        builtinRules: [{ template: 'own' }, { template: 'same_client' }],
        bundleRules: [],
        ctx: ctx(),
      });
      result.supported = r.supported;
    });
    expect(result.supported).toBe(true);
    expect(text).toContain('"t"."entered_by" = \'user-1\'');
    expect(text).toContain('"t"."client_id" = \'client-1\'');
    expect(text).toContain(' or ');
  });

  it('intersects bundle rules with AND semantics and respects rule-scoped ids', () => {
    const text = sql((b) =>
      compileResourceReadAuthorizationSql(b, {
        resourceType: 'ticket',
        action: 'read',
        builtinRules: [],
        bundleRules: [
          { id: 'r1', resource: 'ticket', action: 'read', templateKey: 'own' },
          { id: 'r2', resource: 'ticket', action: 'read', templateKey: 'selected_clients', selectedClientIds: ['client-9'] },
        ],
        ctx: ctx(),
      })
    );
    expect(text).toContain('"t"."entered_by" = \'user-1\'');
    expect(text).toContain('"t"."client_id" in (\'client-9\')');
  });

  it('ignores bundle rules for other resources/actions', () => {
    const text = sql((b) =>
      compileResourceReadAuthorizationSql(b, {
        resourceType: 'ticket',
        action: 'read',
        builtinRules: [],
        bundleRules: [
          { id: 'r1', resource: 'project', action: 'read', templateKey: 'own' },
          { id: 'r2', resource: 'ticket', action: 'update', templateKey: 'same_team' },
        ],
        ctx: ctx(),
      })
    );
    // Only the tenant filter survives; no narrowing predicate was added.
    expect(text).not.toContain('"t"."entered_by"');
    expect(text).not.toContain('"t"."assigned_team_id"');
  });

  it('denies tickets for client_visible_only when no visibility column exists', () => {
    let supported = false;
    const text = sql((b) => {
      const r = compileResourceReadAuthorizationSql(b, {
        resourceType: 'ticket',
        action: 'read',
        builtinRules: [],
        bundleRules: [{ id: 'r1', resource: 'ticket', action: 'read', constraintKey: 'client_visible_only' }],
        ctx: ctx(),
      });
      supported = r.supported;
    });
    expect(supported).toBe(true);
    expect(text).toContain('1 = 0');
  });

  it('honours a clientVisibleColumn when the adapter provides one', () => {
    const text = sql((b) =>
      compileResourceReadAuthorizationSql(b, {
        resourceType: 'ticket',
        action: 'read',
        builtinRules: [],
        bundleRules: [{ id: 'r1', resource: 'ticket', action: 'read', constraintKey: 'client_visible_only' }],
        ctx: ctx({ adapter: { ...adapter, clientVisibleColumn: 't.is_client_visible' } }),
      })
    );
    expect(text).toContain('"t"."is_client_visible" = true');
  });

  it('treats not_self_approver as supported on the read path (mutation-only)', () => {
    const r = compileResourceReadAuthorizationSql(db('tickets as t'), {
      resourceType: 'ticket',
      action: 'read',
      builtinRules: [],
      bundleRules: [{ id: 'r1', resource: 'ticket', action: 'read', constraintKey: 'not_self_approver', templateKey: 'own' }],
      ctx: ctx(),
    });
    expect(r.supported).toBe(true);
  });

  it('reports unsupported for constraints not representable in SQL', () => {
    const r = compileResourceReadAuthorizationSql(db('tickets as t'), {
      resourceType: 'ticket',
      action: 'read',
      builtinRules: [],
      bundleRules: [{ id: 'r1', resource: 'ticket', action: 'read', constraintKey: 'some_future_constraint' }],
      ctx: ctx(),
    });
    expect(r.supported).toBe(false);
    if (!r.supported) {
      expect(r.reason).toContain('some_future_constraint');
    }
  });

  it('adds no narrowing when there are no builtin or bundle rules', () => {
    const text = sql((b) =>
      compileResourceReadAuthorizationSql(b, {
        resourceType: 'ticket',
        action: 'read',
        builtinRules: [],
        bundleRules: [],
        ctx: ctx(),
      })
    );
    expect(text).toBe('select * from "tickets" as "t" where "t"."tenant" = \'tenant-1\'');
  });
});
