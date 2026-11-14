import knexFactory from 'knex';
import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_AUDIENCES, RECORD_GUARD_KEYS, compileRecordGuardSql, evaluateRecordGuard, isRecordGuardKey,
  type RecordGuardKey, type RecordGuardRule, type RelationshipSqlAdapter,
} from './index';

// The record guards of built-in resolver rules (S31). Each is one definition with a JS facet and a SQL facet:
// every case below asks both, and they must say the same thing.

const knex = knexFactory({ client: 'pg' });
const rule: RecordGuardRule = { selectedClientIds: ['c1'], selectedBoardIds: ['b1', 'b2'] };
const sqlOf = (key: RecordGuardKey, adapter: Partial<RelationshipSqlAdapter>, guardRule: RecordGuardRule = rule) => {
  const builder = knex('records as r');
  compileRecordGuardSql(builder, key, guardRule, {
    subject: { tenant: 't', userId: 'u', userType: 'internal', roleIds: [], teamIds: [], managedUserIds: [], clientId: null, portfolioClientIds: [] },
    adapter: { applyAssignedUsers: () => undefined, ...adapter },
  });
  return builder.toQuery();
};
const ticketsHook: RelationshipSqlAdapter['applyAttachedTickets'] = (builder, scope, quantifier) =>
  builder.whereRaw(`${quantifier}(${scope.clientIds.join(',')}|${scope.boardIds.join(',')})`);
const jsOf = (key: RecordGuardKey, record: Record<string, unknown>, guardRule: RecordGuardRule = rule) =>
  evaluateRecordGuard(key, guardRule, { record });

describe('record guards', () => {
  it('names exactly the guards it defines, and nothing else is one', () => {
    expect(RECORD_GUARD_KEYS.every(isRecordGuardKey)).toBe(true);
    expect(isRecordGuardKey('client_visible_only')).toBe(false);
    expect(isRecordGuardKey(null)).toBe(false);
    expect([...EXTERNAL_AUDIENCES]).toEqual(['client', 'public']);
  });

  describe('external_audience_only', () => {
    it.each([['client', true], ['public', true], ['internal', false], [undefined, false], [null, false], ['CLIENT', false], [7, false]])(
      'JS: audience %s is %s', (audience, expected) => {
        expect(jsOf('external_audience_only', { audience })).toBe(expected);
      });
    it('JS: a record-less check is not judged here (SQL narrows it)', () => {
      expect(evaluateRecordGuard('external_audience_only', rule, {})).toBe(false);
    });
    it('SQL: the audience column in client and public; no mapped column denies every row', () => {
      expect(sqlOf('external_audience_only', { audienceColumn: 'r.audience' }))
        .toBe(`select * from "records" as "r" where "r"."audience" in ('client', 'public')`);
      expect(sqlOf('external_audience_only', {})).toBe('select * from "records" as "r" where 1 = 0');
    });
  });

  describe('attached_tickets_in_scope', () => {
    const ticket = (clientId: string | null, boardId: string | null) => ({ clientId, boardId });
    it.each([
      ['attached to nothing', [], true],
      ['attached to one ticket in scope', [ticket('c1', 'b1')], true],
      ['attached to two tickets in scope', [ticket('c1', 'b1'), ticket('c1', 'b2')], true],
      ['attached to a ticket on another board', [ticket('c1', 'b9')], false],
      ['attached to a ticket of another client', [ticket('c2', 'b1')], false],
      ['attached to a ticket with no board', [ticket('c1', null)], false],
      ['attached to one in scope and one outside', [ticket('c1', 'b1'), ticket('c1', 'b9')], false],
    ])('JS: %s -> %s', (_label, attachedTickets, expected) => {
      expect(jsOf('attached_tickets_in_scope', { attachedTickets })).toBe(expected);
    });
    it('JS: a record that does not say what it is attached to fails closed', () => {
      expect(jsOf('attached_tickets_in_scope', {})).toBe(false);
      expect(jsOf('attached_tickets_in_scope', { attachedTickets: 'x' })).toBe(false);
    });
    it('JS: a rule with no boards admits no ticket', () => {
      expect(jsOf('attached_tickets_in_scope', { attachedTickets: [ticket('c1', 'b1')] }, { selectedClientIds: ['c1'], selectedBoardIds: [] })).toBe(false);
      expect(jsOf('attached_tickets_in_scope', { attachedTickets: [] }, { selectedClientIds: ['c1'], selectedBoardIds: [] })).toBe(true);
    });
    it('SQL: asks the adapter for `every` ticket in scope; no hook denies every row', () => {
      expect(sqlOf('attached_tickets_in_scope', { applyAttachedTickets: ticketsHook }))
        .toBe('select * from "records" as "r" where every(c1|b1,b2)');
      expect(sqlOf('attached_tickets_in_scope', {})).toBe('select * from "records" as "r" where 1 = 0');
    });
  });

  describe('client_visible_or_in_scope_ticket', () => {
    it.each([
      ['client-visible, attached to nothing', { is_client_visible: true, attachedTickets: [] }, true],
      ['not client-visible, attached to nothing', { is_client_visible: false, attachedTickets: [] }, false],
      ['not client-visible, attached to a ticket in scope', { is_client_visible: false, attachedTickets: [{ clientId: 'c1', boardId: 'b2' }] }, true],
      ['not client-visible, attached only outside the scope', { is_client_visible: false, attachedTickets: [{ clientId: 'c1', boardId: 'b9' }] }, false],
      ['visibility not stated', { attachedTickets: [] }, false],
      ['visibility not stated, ticket in scope', { attachedTickets: [{ clientId: 'c1', boardId: 'b1' }] }, true],
    ])('JS: %s -> %s', (_label, record, expected) => {
      expect(jsOf('client_visible_or_in_scope_ticket', record)).toBe(expected);
    });
    it('SQL: the visibility column OR some ticket in scope; each half denies when its mapping is missing', () => {
      expect(sqlOf('client_visible_or_in_scope_ticket', { clientVisibleColumn: 'r.vis', applyAttachedTickets: ticketsHook }))
        .toBe('select * from "records" as "r" where ("r"."vis" = true or (some(c1|b1,b2)))');
      expect(sqlOf('client_visible_or_in_scope_ticket', { applyAttachedTickets: ticketsHook }))
        .toBe('select * from "records" as "r" where (1 = 0 or (some(c1|b1,b2)))');
      expect(sqlOf('client_visible_or_in_scope_ticket', { clientVisibleColumn: 'r.vis' }))
        .toBe('select * from "records" as "r" where ("r"."vis" = true or (1 = 0))');
    });
  });
});
