import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexFactory, { type Knex } from 'knex';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  compileResourceReadAuthorizationSql,
  type AuthorizationRecord,
  type AuthorizationSubject,
  type BundleNarrowingRule,
  type RelationshipRule,
  type RelationshipSqlAdapter,
} from '@alga-psa/authorization/kernel';

// Differential parity: the SQL compiler must select EXACTLY the rows the JS
// kernel allows, across a fixture matrix. The JS side runs the real kernel
// (the same providers the ticket server-action wires); the SQL side runs the
// shared compiler. They share one template registry, so this proves the two
// facets stay in lock-step against real Postgres semantics (OR/AND grouping,
// EXISTS, IN, NULL handling).
//
// Uses session-local TEMP tables on the local dev DB — never touches real data.

function readPassword(): string {
  const candidates = [
    path.resolve(process.cwd(), '../secrets/postgres_password'),
    path.resolve(process.cwd(), 'secrets/postgres_password'),
    '/run/secrets/postgres_password',
  ];
  for (const file of candidates) {
    try {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (value) return value;
    } catch {
      /* try next */
    }
  }
  return 'postpass123';
}

const TENANT = '11111111-1111-4111-8111-111111111111';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const U9 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9';
const MANAGED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2';
const TEAM1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const TEAMX = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbx'.replace('x', '9');
const C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const C2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const CX = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9';
const B1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const BX = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd9';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';

interface TicketRow {
  ticket_id: string;
  entered_by: string;
  assigned_to: string | null;
  client_id: string | null;
  board_id: string | null;
  assigned_team_id: string | null;
}

// id -> additional (co-assignee) user ids
const ADDITIONAL: Record<string, string[]> = {
  'ticket-6': [U1],
};

const TICKETS: TicketRow[] = [
  { ticket_id: 'ticket-1', entered_by: U1, assigned_to: U9, client_id: CX, board_id: BX, assigned_team_id: TEAMX },
  { ticket_id: 'ticket-2', entered_by: U9, assigned_to: U1, client_id: CX, board_id: BX, assigned_team_id: TEAMX },
  { ticket_id: 'ticket-3', entered_by: U9, assigned_to: U9, client_id: CX, board_id: BX, assigned_team_id: TEAM1 },
  { ticket_id: 'ticket-4', entered_by: U9, assigned_to: U9, client_id: C1, board_id: B1, assigned_team_id: TEAMX },
  { ticket_id: 'ticket-5', entered_by: U9, assigned_to: U9, client_id: C2, board_id: BX, assigned_team_id: TEAMX },
  // ticket-6: U1 reaches this ONLY as a ticket_resources co-assignee (entered/assigned = U9).
  { ticket_id: 'ticket-6', entered_by: U9, assigned_to: U9, client_id: CX, board_id: BX, assigned_team_id: TEAMX },
  { ticket_id: 'ticket-7', entered_by: U1, assigned_to: U1, client_id: C1, board_id: B1, assigned_team_id: TEAM1 },
  { ticket_id: 'ticket-8', entered_by: U9, assigned_to: null, client_id: null, board_id: null, assigned_team_id: null },
  // ticket-9: U1 is a co-assignee ONLY under a different tenant (see beforeAll). The
  // tenant-scoped EXISTS must ignore it — this guards the adapter's tenant filter.
  { ticket_id: 'ticket-9', entered_by: U9, assigned_to: U9, client_id: CX, board_id: BX, assigned_team_id: TEAMX },
];

const internalSubject: AuthorizationSubject = {
  tenant: TENANT,
  userId: U1,
  userType: 'internal',
  teamIds: [TEAM1],
  managedUserIds: [MANAGED],
  portfolioClientIds: [C1, C2],
  clientId: null,
};

const clientSubject: AuthorizationSubject = {
  tenant: TENANT,
  userId: U1,
  userType: 'client',
  teamIds: [TEAM1],
  managedUserIds: [],
  portfolioClientIds: [C1, C2],
  clientId: C1,
};

interface Scenario {
  name: string;
  subject: AuthorizationSubject;
  selectedBoardIds?: string[];
  bundleRules: BundleNarrowingRule[];
}

const rule = (overrides: Partial<BundleNarrowingRule> & { id: string }): BundleNarrowingRule => ({
  resource: 'ticket',
  action: 'read',
  ...overrides,
});

const SCENARIOS: Scenario[] = [
  { name: 'own', subject: internalSubject, bundleRules: [rule({ id: 'r', templateKey: 'own' })] },
  { name: 'assigned (primary + co-assignee)', subject: internalSubject, bundleRules: [rule({ id: 'r', templateKey: 'assigned' })] },
  { name: 'managed', subject: { ...internalSubject, managedUserIds: [U9] }, bundleRules: [rule({ id: 'r', templateKey: 'managed' })] },
  { name: 'own_or_assigned', subject: internalSubject, bundleRules: [rule({ id: 'r', templateKey: 'own_or_assigned' })] },
  { name: 'same_team', subject: internalSubject, bundleRules: [rule({ id: 'r', templateKey: 'same_team' })] },
  { name: 'client_portfolio', subject: internalSubject, bundleRules: [rule({ id: 'r', templateKey: 'client_portfolio' })] },
  { name: 'selected_clients (rule-scoped)', subject: internalSubject, bundleRules: [rule({ id: 'r', templateKey: 'selected_clients', selectedClientIds: [C2] })] },
  { name: 'two rules ANDed (own + same_team)', subject: internalSubject, bundleRules: [rule({ id: 'r1', templateKey: 'own' }), rule({ id: 'r2', templateKey: 'same_team' })] },
  { name: 'client_visible_only denies all', subject: internalSubject, bundleRules: [rule({ id: 'r', constraintKey: 'client_visible_only' })] },
  { name: 'no rules ⇒ allow all', subject: internalSubject, bundleRules: [] },
  {
    name: 'client portal: selected_boards builtin + same_client bundle',
    subject: clientSubject,
    selectedBoardIds: [B1],
    bundleRules: [rule({ id: 'r', templateKey: 'same_client' })],
  },
  {
    name: 'client portal: selected_boards builtin only',
    subject: clientSubject,
    selectedBoardIds: [B1],
    bundleRules: [],
  },
];

let db: Knex | undefined;
try {
  db = knexFactory({
    client: 'pg',
    connection: {
      host: process.env.RELSQL_DB_HOST || 'localhost',
      port: Number(process.env.RELSQL_DB_PORT || 5432),
      user: 'postgres',
      password: readPassword(),
      database: process.env.RELSQL_DB_NAME || 'server',
    },
    // TEMP tables are connection-local; pin to a single connection so every
    // query in the suite sees them.
    pool: { min: 1, max: 1 },
  });
  await db.raw('select 1');
} catch {
  if (db) await db.destroy().catch(() => undefined);
  db = undefined;
}

const parityIt = db ? it : it.skip;
if (!db) {
  // eslint-disable-next-line no-console
  console.warn('[relationshipSqlParity] no local Postgres on :5432 — parity tests skipped');
}

function toRecord(row: TicketRow): AuthorizationRecord {
  const assignees = new Set<string>();
  if (row.assigned_to) assignees.add(row.assigned_to);
  for (const id of ADDITIONAL[row.ticket_id] ?? []) assignees.add(id);
  return {
    id: row.ticket_id,
    ownerUserId: row.entered_by,
    assignedUserIds: Array.from(assignees),
    clientId: row.client_id,
    boardId: row.board_id,
    teamIds: row.assigned_team_id ? [row.assigned_team_id] : [],
  };
}

async function jsKernelAllowedIds(scenario: Scenario): Promise<Set<string>> {
  const builtinRules: RelationshipRule[] =
    scenario.selectedBoardIds === undefined ? [] : [{ template: 'selected_boards' }];
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: builtinRules }),
    bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: async () => scenario.bundleRules }),
    rbacEvaluator: async () => true,
  });
  const requestCache = new RequestLocalAuthorizationCache();
  const allowed = new Set<string>();
  for (const row of TICKETS) {
    const decision = await kernel.authorizeResource({
      subject: scenario.subject,
      resource: { type: 'ticket', action: 'read', id: row.ticket_id },
      record: toRecord(row),
      selectedBoardIds: scenario.selectedBoardIds,
      requestCache,
    });
    if (decision.allowed) allowed.add(row.ticket_id);
  }
  return allowed;
}

function sqlAdapter(connection: Knex): RelationshipSqlAdapter {
  return {
    ownerColumn: 't.entered_by',
    clientColumn: 't.client_id',
    boardColumn: 't.board_id',
    teamColumn: 't.assigned_team_id',
    applyAssignedUsers(builder, userIds) {
      const ids = Array.from(new Set(userIds.filter((v): v is string => typeof v === 'string' && v.length > 0)));
      if (ids.length === 0) {
        builder.whereRaw('1 = 0');
        return;
      }
      builder.whereIn('t.assigned_to', ids).orWhereExists(function exists(this: Knex.QueryBuilder) {
        this.select(connection.raw('1'))
          .from('relsql_ticket_resources as tr')
          .whereRaw('tr.tenant = t.tenant')
          .whereRaw('tr.ticket_id = t.ticket_id')
          .whereNotNull('tr.additional_user_id')
          .whereIn('tr.additional_user_id', ids);
      });
    },
  };
}

async function sqlAllowedIds(connection: Knex, scenario: Scenario): Promise<Set<string> | null> {
  const builtinRules: RelationshipRule[] =
    scenario.selectedBoardIds === undefined ? [] : [{ template: 'selected_boards' }];
  const query = connection('relsql_tickets as t').where('t.tenant', TENANT);
  const result = compileResourceReadAuthorizationSql(query, {
    resourceType: 'ticket',
    action: 'read',
    builtinRules,
    bundleRules: scenario.bundleRules,
    ctx: { subject: scenario.subject, selectedBoardIds: scenario.selectedBoardIds, adapter: sqlAdapter(connection) },
  });
  if (!result.supported) return null;
  const rows = await query.clearSelect().select('t.ticket_id');
  return new Set(rows.map((r: { ticket_id: string }) => r.ticket_id));
}

describe('relationship SQL ↔ JS kernel parity', () => {
  beforeAll(async () => {
    if (!db) return;
    await db.raw('CREATE TEMP TABLE relsql_tickets (tenant uuid, ticket_id text, entered_by uuid, assigned_to uuid, client_id uuid, board_id uuid, assigned_team_id uuid) ON COMMIT PRESERVE ROWS');
    await db.raw('CREATE TEMP TABLE relsql_ticket_resources (tenant uuid, ticket_id text, additional_user_id uuid) ON COMMIT PRESERVE ROWS');
    await db('relsql_tickets').insert(TICKETS.map((t) => ({ ...t, tenant: TENANT })));
    const resources = Object.entries(ADDITIONAL).flatMap(([ticketId, userIds]) =>
      userIds.map((additional_user_id) => ({ tenant: TENANT, ticket_id: ticketId, additional_user_id }))
    );
    if (resources.length > 0) await db('relsql_ticket_resources').insert(resources);

    // Cross-tenant co-assignee: U1 is an additional agent on ticket-9 but under
    // OTHER_TENANT. The tenant-scoped EXISTS must ignore it. Intentionally NOT
    // mirrored into ADDITIONAL, so the JS record context excludes it too — if the
    // SQL adapter dropped its tenant filter, the two paths would diverge here.
    await db('relsql_ticket_resources').insert({
      tenant: OTHER_TENANT,
      ticket_id: 'ticket-9',
      additional_user_id: U1,
    });
  }, 60000);

  afterAll(async () => {
    if (db) await db.destroy();
  });

  parityIt('every scenario selects identical rows in SQL and the JS kernel', async () => {
    const connection = db as Knex;
    const mismatches: string[] = [];
    for (const scenario of SCENARIOS) {
      const jsIds = await jsKernelAllowedIds(scenario);
      const sqlIds = await sqlAllowedIds(connection, scenario);
      expect(sqlIds, `${scenario.name}: SQL path should be supported`).not.toBeNull();
      const js = [...jsIds].sort();
      const sql = [...(sqlIds as Set<string>)].sort();
      if (JSON.stringify(js) !== JSON.stringify(sql)) {
        mismatches.push(`${scenario.name}\n  js : ${js.join(', ') || '∅'}\n  sql: ${sql.join(', ') || '∅'}`);
      }
    }
    expect(mismatches, `parity mismatches:\n${mismatches.join('\n')}`).toHaveLength(0);
  });

  parityIt('discriminates (own selects only u1-entered tickets, not everything/nothing)', async () => {
    const ids = await sqlAllowedIds(db as Knex, { name: 'own', subject: internalSubject, bundleRules: [rule({ id: 'r', templateKey: 'own' })] });
    expect(ids).not.toBeNull();
    expect([...(ids as Set<string>)].sort()).toEqual(['ticket-1', 'ticket-7']);
  });

  parityIt('co-assignee path: includes a pure co-assignee, excludes a cross-tenant one', async () => {
    const scenario: Scenario = {
      name: 'assigned',
      subject: internalSubject,
      bundleRules: [rule({ id: 'r', templateKey: 'assigned' })],
    };
    const sqlIds = await sqlAllowedIds(db as Knex, scenario);
    expect(sqlIds).not.toBeNull();
    const set = sqlIds as Set<string>;
    // ticket-2 / ticket-7: U1 is the primary assignee. ticket-6: U1 only via a
    // same-tenant ticket_resources co-assignee. ticket-9: U1 co-assignee under a
    // different tenant ⇒ must NOT appear.
    expect(set.has('ticket-6')).toBe(true);
    expect(set.has('ticket-9')).toBe(false);
    expect([...set].sort()).toEqual(['ticket-2', 'ticket-6', 'ticket-7']);
    // And the JS kernel agrees exactly.
    expect([...(await jsKernelAllowedIds(scenario))].sort()).toEqual(['ticket-2', 'ticket-6', 'ticket-7']);
  });
});
