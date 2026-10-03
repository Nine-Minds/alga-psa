import { afterAll, describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import {
  applyTicketVisibilityFilter,
  extractActiveWatcherContactIds,
  ticketMatchesVisibility,
  type TicketVisibilityScope,
} from './visibility';
import {
  compileRelationshipTemplateSql,
  evaluateRelationshipTemplate,
  type RelationshipSqlAdapter,
} from '../kernel';

const db = knexFactory({ client: 'pg' });
afterAll(async () => {
  await db.destroy();
});

const base: TicketVisibilityScope = {
  effectiveTicketScope: 'contact',
  contactId: 'c1',
  clientId: 'cl1',
  visibleBoardIds: ['b1', 'b2'],
};
const columns = { boardColumn: 't.board_id', contactColumn: 't.contact_name_id' };
const profileColumns = { ...columns, billingProfileColumn: 't.billing_profile_id' };
const allColumns = { ...profileColumns, watchListColumn: 't.attributes' };

const sqlFor = (scope: TicketVisibilityScope, cols = columns) =>
  applyTicketVisibilityFilter(db('tickets as t').select('*'), scope, cols).toString();

describe('applyTicketVisibilityFilter: no-grant SQL is byte-identical to the pre-extraction filter', () => {
  // Expected strings were captured from the implementation in
  // packages/tickets/src/lib/clientPortalVisibility.ts before it moved.
  it('contact scope, no grants', () => {
    const expected =
      `select * from "tickets" as "t" where "t"."board_id" in ('b1', 'b2') and "t"."contact_name_id" = 'c1'`;
    expect(sqlFor(base)).toBe(expected);
    // A call site that knows about profiles but the contact has no grant.
    expect(sqlFor(base, profileColumns)).toBe(expected);
    // A watch-capable call site where the resolver granted nothing.
    expect(sqlFor({ ...base, watchGrant: false }, allColumns)).toBe(expected);
    // visibleContactIds that is just the contact itself is not a grant.
    expect(sqlFor({ ...base, visibleContactIds: ['c1'] }, allColumns)).toBe(expected);
  });

  it('a call site that omits the adapter columns narrows, never widens', () => {
    const expected =
      `select * from "tickets" as "t" where "t"."board_id" in ('b1', 'b2') and "t"."contact_name_id" = 'c1'`;
    const granted: TicketVisibilityScope = {
      ...base,
      grantedTicketProfileIds: ['p1'],
      watchGrant: true,
    };
    expect(sqlFor(granted, columns)).toBe(expected);
    expect(sqlFor(granted, { ...columns, billingProfileColumn: 't.billing_profile_id' })).not.toBe(expected);
    expect(sqlFor(granted, { ...columns, watchListColumn: 't.attributes' })).not.toBe(expected);
  });

  it('billing-profile grants', () => {
    expect(
      sqlFor({ ...base, grantedTicketProfileIds: ['p1', 'p2'], defaultBillingProfileId: 'p9' }, profileColumns)
    ).toBe(
      `select * from "tickets" as "t" where "t"."board_id" in ('b1', 'b2') and ("t"."contact_name_id" = 'c1' or "t"."billing_profile_id" in ('p1', 'p2'))`
    );
    expect(
      sqlFor({ ...base, grantedTicketProfileIds: ['p1', 'p9'], defaultBillingProfileId: 'p9' }, profileColumns)
    ).toBe(
      `select * from "tickets" as "t" where "t"."board_id" in ('b1', 'b2') and ("t"."contact_name_id" = 'c1' or "t"."billing_profile_id" in ('p1', 'p9') or "t"."billing_profile_id" is null)`
    );
  });

  it('board edge cases and client scope', () => {
    expect(sqlFor({ ...base, visibleBoardIds: null })).toBe(
      `select * from "tickets" as "t" where "t"."contact_name_id" = 'c1'`
    );
    expect(sqlFor({ ...base, visibleBoardIds: [] })).toBe(`select * from "tickets" as "t" where 1 = 0`);
    expect(sqlFor({ ...base, effectiveTicketScope: 'client' })).toBe(
      `select * from "tickets" as "t" where "t"."board_id" in ('b1', 'b2')`
    );
  });

  it('hierarchy and watcher grants widen the contact predicate', () => {
    expect(sqlFor({ ...base, visibleContactIds: ['c1', 'c2', 'c3'] })).toBe(
      `select * from "tickets" as "t" where "t"."board_id" in ('b1', 'b2') and "t"."contact_name_id" in ('c1', 'c2', 'c3')`
    );
    expect(sqlFor({ ...base, watchGrant: true }, allColumns)).toBe(
      `select * from "tickets" as "t" where "t"."board_id" in ('b1', 'b2') and ("t"."contact_name_id" = 'c1' or ("t"."attributes" -> 'watch_list') @> '[{"entity_type":"contact","entity_id":"c1","active":true}]'::jsonb)`
    );
  });

  it('rejects an unusable context', () => {
    expect(() => sqlFor({ ...base, effectiveTicketScope: 'bogus' as never })).toThrow(/invalid effective scope/);
    expect(() => sqlFor({ ...base, contactId: '' })).toThrow(/requires a contact/);
  });
});

describe('ticketMatchesVisibility', () => {
  const record = { clientId: 'cl1', boardId: 'b1', contactId: 'c1' };

  it('requires the same client and an allowed board', () => {
    expect(ticketMatchesVisibility(record, base)).toBe(true);
    expect(ticketMatchesVisibility({ ...record, clientId: 'other' }, base)).toBe(false);
    expect(ticketMatchesVisibility({ ...record, boardId: 'b9' }, base)).toBe(false);
    expect(ticketMatchesVisibility({ ...record, boardId: null }, base)).toBe(false);
    expect(ticketMatchesVisibility(record, { ...base, visibleBoardIds: null })).toBe(true);
    expect(ticketMatchesVisibility(record, { ...base, visibleBoardIds: [] })).toBe(false);
    expect(ticketMatchesVisibility(null, base)).toBe(false);
    expect(ticketMatchesVisibility(record, null)).toBe(false);
  });

  it('client scope sees contact-less tickets, contact scope does not', () => {
    const noContact = { ...record, contactId: null };
    expect(ticketMatchesVisibility(noContact, { ...base, effectiveTicketScope: 'client' })).toBe(true);
    expect(ticketMatchesVisibility(noContact, base)).toBe(false);
  });

  it('reports are visible only through visibleContactIds', () => {
    const report = { ...record, contactId: 'c2' };
    expect(ticketMatchesVisibility(report, base)).toBe(false);
    expect(ticketMatchesVisibility(report, { ...base, visibleContactIds: ['c1', 'c2'] })).toBe(true);
  });

  it('billing-profile grants, including the NULL-profile rule', () => {
    const scope = { ...base, grantedTicketProfileIds: ['p1'], defaultBillingProfileId: 'p1' };
    const other = { ...record, contactId: 'c9' };
    expect(ticketMatchesVisibility({ ...other, billingProfileId: 'p1' }, scope)).toBe(true);
    expect(ticketMatchesVisibility({ ...other, billingProfileId: 'p2' }, scope)).toBe(false);
    expect(ticketMatchesVisibility({ ...other, billingProfileId: null }, scope)).toBe(true);
    // Column not loaded: never widens.
    expect(ticketMatchesVisibility({ ...other }, scope)).toBe(false);
    // NULL profile only counts when the default profile is the granted one.
    expect(
      ticketMatchesVisibility({ ...other, billingProfileId: null }, { ...scope, defaultBillingProfileId: 'p9' })
    ).toBe(false);
  });

  it('watchers see a ticket only with the grant and an own entry', () => {
    const other = { ...record, contactId: 'c9', watcherContactIds: ['c1'] };
    expect(ticketMatchesVisibility(other, base)).toBe(false);
    expect(ticketMatchesVisibility(other, { ...base, watchGrant: true })).toBe(true);
    expect(
      ticketMatchesVisibility({ ...other, watcherContactIds: ['c2'] }, { ...base, watchGrant: true })
    ).toBe(false);
  });
});

describe('extractActiveWatcherContactIds', () => {
  it('keeps only active contact entries with a resolved entity_id', () => {
    expect(
      extractActiveWatcherContactIds({
        watch_list: [
          { email: 'a@x.com', active: true, entity_type: 'contact', entity_id: 'c1' },
          { email: 'b@x.com', active: false, entity_type: 'contact', entity_id: 'c2' },
          { email: 'c@x.com', active: true, entity_type: 'user', entity_id: 'u1' },
          { email: 'd@x.com', active: true },
          { email: 'e@x.com', active: true, entity_type: 'contact' },
        ],
      })
    ).toEqual(['c1']);
    expect(extractActiveWatcherContactIds(null)).toEqual([]);
    expect(extractActiveWatcherContactIds({ watch_list: 'nope' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Parity: the SQL filter, the kernel `matches` and the kernel `compileSql`
// must agree. SQL cannot be executed here (the DB-backed suite does that), so
// the kernel SQL is pinned to be exactly the client restriction plus the shared
// filter's output, and `matches` is pinned against the same decision table.
// ---------------------------------------------------------------------------
describe('kernel contact_visibility parity with the shared predicate', () => {
  const adapter: RelationshipSqlAdapter = {
    ownerColumn: 't.entered_by',
    clientColumn: 't.client_id',
    boardColumn: 't.board_id',
    contactColumn: 't.contact_name_id',
    billingProfileColumn: 't.billing_profile_id',
    watchListColumn: 't.attributes',
    teamColumn: 't.assigned_team_id',
    applyAssignedUsers() {
      /* not used by contact_visibility */
    },
  };
  const subject = { tenant: 'tenant-1', userId: 'u1', userType: 'client' as const };

  const kernelSql = (scope: TicketVisibilityScope | null, ad = adapter) => {
    const query = db('tickets as t').select('*');
    query.where(function (this: typeof query) {
      compileRelationshipTemplateSql(this, 'contact_visibility', { subject, contactVisibility: scope, adapter: ad });
    });
    return query.toString();
  };

  const scopes: Array<[string, TicketVisibilityScope]> = [
    ['contact, no grants', base],
    ['contact, boards unrestricted', { ...base, visibleBoardIds: null }],
    ['client scope', { ...base, effectiveTicketScope: 'client' }],
    ['contact, profile grant', { ...base, grantedTicketProfileIds: ['p1'], defaultBillingProfileId: 'p1' }],
    ['contact, hierarchy', { ...base, visibleContactIds: ['c1', 'c2'] }],
    ['contact, watcher', { ...base, watchGrant: true }],
    [
      'contact, everything',
      {
        ...base,
        visibleContactIds: ['c1', 'c2'],
        grantedTicketProfileIds: ['p1'],
        defaultBillingProfileId: 'p1',
        watchGrant: true,
      },
    ],
  ];

  it.each(scopes)('compileSql = client restriction + shared filter (%s)', (_name, scope) => {
    const shared = applyTicketVisibilityFilter(db('tickets as t').select('*'), scope, allColumns).toString();
    const wherePart = shared.slice(shared.indexOf(' where ') + ' where '.length);
    expect(kernelSql(scope)).toBe(
      `select * from "tickets" as "t" where ("t"."client_id" = 'cl1' and ${wherePart})`
    );
  });

  it('compileSql fails closed when the context is missing or the adapter is incomplete', () => {
    expect(kernelSql(null)).toBe(`select * from "tickets" as "t" where (1 = 0)`);
    expect(kernelSql(base, { ...adapter, contactColumn: undefined })).toBe(
      `select * from "tickets" as "t" where ("t"."client_id" = 'cl1' and "t"."board_id" in ('b1', 'b2') and 1 = 0)`
    );
    // No billing/watch columns on the adapter: grants cannot widen.
    const granted = { ...base, grantedTicketProfileIds: ['p1'], watchGrant: true };
    expect(kernelSql(granted, { ...adapter, billingProfileColumn: undefined, watchListColumn: undefined })).toBe(
      kernelSql(base)
    );
  });

  const records = [
    { name: 'own', record: { clientId: 'cl1', boardId: 'b1', contactId: 'c1' } },
    { name: 'report', record: { clientId: 'cl1', boardId: 'b1', contactId: 'c2' } },
    { name: 'peer', record: { clientId: 'cl1', boardId: 'b1', contactId: 'c3' } },
    { name: 'no contact', record: { clientId: 'cl1', boardId: 'b1', contactId: null } },
    { name: 'wrong board', record: { clientId: 'cl1', boardId: 'b9', contactId: 'c1' } },
    { name: 'other client', record: { clientId: 'cl2', boardId: 'b1', contactId: 'c1' } },
    { name: 'profile p1', record: { clientId: 'cl1', boardId: 'b1', contactId: 'c3', billingProfileId: 'p1' } },
    { name: 'no profile', record: { clientId: 'cl1', boardId: 'b1', contactId: 'c3', billingProfileId: null } },
    { name: 'watched', record: { clientId: 'cl1', boardId: 'b1', contactId: 'c3', watcherContactIds: ['c1'] } },
  ];

  it.each(scopes)('kernel matches = shared predicate (%s)', (_name, scope) => {
    for (const { name, record } of records) {
      expect(
        evaluateRelationshipTemplate('contact_visibility', {
          subject,
          resource: { type: 'ticket', action: 'read' },
          record,
          contactVisibility: scope,
        }),
        name
      ).toBe(ticketMatchesVisibility(record, scope));
    }
  });
});
