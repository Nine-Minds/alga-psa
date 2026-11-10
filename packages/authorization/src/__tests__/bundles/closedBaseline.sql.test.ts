import { describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  bundleRulesRestrict,
  closedBundlesNotNaming,
  compileBundleReadNarrowingSql,
  compileResourceReadAuthorizationSql,
  type BundleNarrowingRule,
} from '../../kernel';

// The SQL twin of the closed baseline: the list path must agree with the provider's decision.
const db = knexFactory({ client: 'pg' });

const subject = {
  tenant: 't1', userId: 'u1', userType: 'internal' as const,
  roleIds: [], teamIds: [], managedUserIds: [], clientId: 'c1', portfolioClientIds: ['c1'],
};
const adapter = { ownerColumn: 'tickets.entered_by', clientColumn: 'tickets.client_id', boardColumn: 'tickets.board_id' };
const ctx = { subject, adapter } as any;

const rule = (id: string, bundleId: string, baseline: 'open' | 'closed', resource: string, action: string, extra: Partial<BundleNarrowingRule> = {}): BundleNarrowingRule => ({
  id, bundleId, revisionId: `${bundleId}-rev`, baseline, resource, action, templateKey: null, ...extra,
});

const cases: Array<{ name: string; rules: BundleNarrowingRule[]; resource: string; action: string; denied: boolean }> = [
  { name: 'no bundles', rules: [], resource: 'ticket', action: 'read', denied: false },
  { name: 'open only, unmatched (allow-all, SQL unchanged)', rules: [rule('o', 'open', 'open', 'asset', 'read')], resource: 'ticket', action: 'read', denied: false },
  { name: 'closed names resource and action', rules: [rule('c', 'closed', 'closed', 'ticket', 'read')], resource: 'ticket', action: 'read', denied: false },
  { name: 'closed names resource, not action', rules: [rule('c', 'closed', 'closed', 'ticket', 'read')], resource: 'ticket', action: 'create', denied: true },
  { name: 'closed does not name resource', rules: [rule('c', 'closed', 'closed', 'ticket', 'read')], resource: 'project', action: 'read', denied: true },
  { name: 'closed names update, delete aliases to it', rules: [rule('c', 'closed', 'closed', 'ticket', 'update')], resource: 'ticket', action: 'delete', denied: false },
  { name: 'open names it, closed does not', rules: [rule('o', 'open', 'open', 'ticket', 'read'), rule('c', 'closed', 'closed', 'project', 'read')], resource: 'ticket', action: 'read', denied: true },
  { name: 'two closed, only one names it', rules: [rule('a', 'c1', 'closed', 'ticket', 'read'), rule('b', 'c2', 'closed', 'project', 'read')], resource: 'ticket', action: 'read', denied: true },
  { name: 'two closed, both name it', rules: [rule('a', 'c1', 'closed', 'ticket', 'read'), rule('b', 'c2', 'closed', 'ticket', 'read')], resource: 'ticket', action: 'read', denied: false },
];

const whereOf = (build: (q: any) => any) => build(db('tickets')).toSQL().sql as string;

describe('closed baseline: SQL parity with the provider', () => {
  describe.each(cases)('$name', (c) => {
    it('compileBundleReadNarrowingSql agrees with the provider', async () => {
      const q = db('tickets');
      const result = compileBundleReadNarrowingSql(q, c.rules, c.resource, c.action, ctx);
      expect(result).toEqual({ supported: true });
      expect(q.toSQL().sql.includes('1 = 0')).toBe(c.denied);

      const decision = await new BundleAuthorizationKernelProvider({ resolveRules: async () => c.rules }).evaluateNarrowing({
        subject, resource: { type: c.resource, action: c.action }, record: { id: 'x', clientId: 'c1' },
      } as any);
      expect(decision.scope.denied).toBe(c.denied);
    });

    it('compileResourceReadAuthorizationSql agrees with the provider', () => {
      const q = db('tickets');
      const result = compileResourceReadAuthorizationSql(q, {
        resourceType: c.resource, action: c.action, builtinRules: [], bundleRules: c.rules, ctx,
      });
      expect(result.supported).toBe(true);
      expect(q.toSQL().sql.includes('1 = 0')).toBe(c.denied);
    });
  });

  it('a closed bundle that names the resource still applies its normal rule predicate', () => {
    const rules = [rule('c', 'closed', 'closed', 'ticket', 'read', { templateKey: 'same_client' })];
    const sql = whereOf((q) => { compileBundleReadNarrowingSql(q, rules, 'ticket', 'read', ctx); return q; });
    expect(sql).toMatch(/"tickets"."client_id"/);
    expect(sql).not.toContain('1 = 0');
  });

  it('open-only rule sets compile exactly as before', () => {
    const open = [rule('o', 'open', 'open', 'ticket', 'read', { templateKey: 'same_client' })];
    const legacy = [{ id: 'o', resource: 'ticket', action: 'read', templateKey: 'same_client' as const }];
    const a = db('tickets'); compileBundleReadNarrowingSql(a, open, 'ticket', 'read', ctx);
    const b = db('tickets'); compileBundleReadNarrowingSql(b, legacy, 'ticket', 'read', ctx);
    expect(a.toSQL().toNative()).toEqual(b.toSQL().toNative());
  });

  it('closedBundlesNotNaming returns bundle and revision ids', () => {
    expect(closedBundlesNotNaming([rule('a', 'c1', 'closed', 'project', 'read')], 'ticket', 'read')).toEqual([
      { bundleId: 'c1', revisionId: 'c1-rev' },
    ]);
  });

  it('bundleRulesRestrict: a rule naming it, or a closed bundle not naming it, restricts; otherwise not', () => {
    expect(bundleRulesRestrict([], 'asset', 'read')).toBe(false);
    expect(bundleRulesRestrict([rule('o', 'open', 'open', 'ticket', 'read')], 'asset', 'read')).toBe(false);
    expect(bundleRulesRestrict([rule('o', 'open', 'open', 'asset', 'read')], 'asset', 'read')).toBe(true);
    expect(bundleRulesRestrict([rule('c', 'closed', 'closed', 'ticket', 'read')], 'asset', 'read')).toBe(true);
    expect(bundleRulesRestrict([rule('c', 'closed', 'closed', 'asset', 'update')], 'asset', 'delete')).toBe(true);
  });
});
