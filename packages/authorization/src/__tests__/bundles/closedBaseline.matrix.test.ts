import { describe, expect, it } from 'vitest';
import {
  BUNDLE_CLOSED_BASELINE_DENIED_CODE,
  BUNDLE_PORTFOLIO_DENIED_CODE,
  BUNDLE_TEMPLATE_DENIED_CODE,
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  createAuthorizationKernel,
  type AuthorizationEvaluationInput,
  type BundleNarrowingRule,
} from '../../kernel';
import { bundleNarrowingRuleFromRow } from '../../bundles/service';

// T007: closed bundles deny what they do not name. Subject kind x resource x action, through the provider and
// through the kernel (so the scope intersection is exercised end to end).

const OPEN = 'bundle-open';
const CLOSED = 'bundle-closed';
const CLOSED_2 = 'bundle-closed-2';

const rule = (
  id: string,
  bundleId: string,
  baseline: 'open' | 'closed',
  resource: string,
  action: string,
  extra: Partial<BundleNarrowingRule> = {}
): BundleNarrowingRule => ({
  id,
  bundleId,
  revisionId: `${bundleId}-rev`,
  baseline,
  resource,
  action,
  templateKey: 'same_client',
  ...extra,
});

const subject = {
  tenant: 't1',
  userId: 'u1',
  userType: 'internal' as const,
  roleIds: [],
  teamIds: [],
  managedUserIds: [],
  clientId: 'c1',
  portfolioClientIds: ['c1'],
};

const inputFor = (resource: string, action: string, record: Record<string, unknown> = { id: 'x', clientId: 'c1' }) =>
  ({ subject, resource: { type: resource, action }, record } as AuthorizationEvaluationInput);

const kernelFor = (rules: BundleNarrowingRule[]) =>
  createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: async () => rules }),
    rbacEvaluator: async () => true,
  });

const closedRules = [rule('rc1', CLOSED, 'closed', 'ticket', 'read'), rule('rc2', CLOSED, 'closed', 'ticket', 'update')];
const openRules = [rule('ro1', OPEN, 'open', 'asset', 'read')];

const kinds: Record<string, BundleNarrowingRule[]> = {
  none: [],
  'open only': openRules,
  'closed only': closedRules,
  'open + closed': [...openRules, ...closedRules],
};

type Cell = { kind: string; resource: string; action: string; denied: boolean; closedDenied: boolean };
const cells: Cell[] = [];
for (const kind of Object.keys(kinds)) {
  const hasClosed = kind.includes('closed');
  for (const [resource, resourceNamed] of [['ticket', true], ['project', false]] as const) {
    for (const [action, actionNamed] of [['read', true], ['update', true], ['create', false]] as const) {
      // 'ticket:create' is a named resource with an unnamed action; 'project:*' is an unnamed resource.
      const named = resourceNamed && actionNamed;
      cells.push({ kind, resource, action, denied: hasClosed && !named, closedDenied: hasClosed && !named });
    }
  }
}

describe('T007 closed baseline matrix', () => {
  describe.each(cells)('$kind / $resource:$action', (cell) => {
    const rules = kinds[cell.kind];

    it('provider', async () => {
      const result = await new BundleAuthorizationKernelProvider({ resolveRules: async () => rules }).evaluateNarrowing(
        inputFor(cell.resource, cell.action)
      );
      const codes = result.reasons.map((r) => r.code);
      expect(result.scope.denied).toBe(cell.denied);
      if (cell.closedDenied) {
        const reason = result.reasons.find((r) => r.code === BUNDLE_CLOSED_BASELINE_DENIED_CODE)!;
        expect(reason).toMatchObject({
          stage: 'bundle',
          sourceType: 'bundle',
          sourceId: CLOSED,
          metadata: { bundleId: CLOSED, revisionId: `${CLOSED}-rev`, resource: cell.resource, action: cell.action },
        });
      } else {
        expect(codes).not.toContain(BUNDLE_CLOSED_BASELINE_DENIED_CODE);
      }
      if (cell.kind === 'none' || (cell.kind === 'open only' )) {
        // open bundles are unchanged: nothing matches ticket/project, so allow-all with no reasons
        expect(result.scope).toEqual({ allowAll: true, denied: false, constraints: [] });
        expect(result.reasons).toEqual([]);
      }
    });

    it('kernel (authorizeResource / explainDecision)', async () => {
      const kernel = kernelFor(rules);
      const decision = await kernel.authorizeResource(inputFor(cell.resource, cell.action));
      expect(decision.allowed).toBe(!cell.denied);
      const explained = await kernel.explainDecision(inputFor(cell.resource, cell.action));
      expect(explained.some((r) => r.code === BUNDLE_CLOSED_BASELINE_DENIED_CODE)).toBe(cell.closedDenied);
    });
  });

  it('honours the delete -> update alias: a closed bundle that names update allows delete', async () => {
    const provider = new BundleAuthorizationKernelProvider({ resolveRules: async () => closedRules });
    const del = await provider.evaluateNarrowing(inputFor('ticket', 'delete'));
    expect(del.scope.denied).toBe(false);
    expect(del.reasons.map((r) => r.code)).not.toContain(BUNDLE_CLOSED_BASELINE_DENIED_CODE);

    const onlyRead = new BundleAuthorizationKernelProvider({
      resolveRules: async () => [rule('r', CLOSED, 'closed', 'ticket', 'read')],
    });
    const denied = await onlyRead.evaluateNarrowing(inputFor('ticket', 'delete'));
    expect(denied.scope.denied).toBe(true);
    expect(denied.reasons[0].code).toBe(BUNDLE_CLOSED_BASELINE_DENIED_CODE);
  });

  it('a closed bundle that names the resource but whose template denies the record gives the rule reason, not the baseline reason', async () => {
    const kernel = kernelFor(closedRules);
    const input = inputFor('ticket', 'read', { id: 'x', clientId: 'other-client' });
    const decision = await kernel.authorizeResource(input);
    expect(decision.allowed).toBe(false);
    const codes = decision.reasons.map((r) => r.code);
    expect(codes).toContain(BUNDLE_TEMPLATE_DENIED_CODE);
    expect(codes).not.toContain(BUNDLE_CLOSED_BASELINE_DENIED_CODE);
    const reason = decision.reasons.find((r) => r.code === BUNDLE_TEMPLATE_DENIED_CODE)!;
    expect(reason.sourceId).toBe('rc1');
    expect(reason.metadata).toMatchObject({ ruleIds: ['rc1'], bundleIds: [CLOSED] });
  });

  it('client_portfolio template deny names the portfolio, and keeps the template reason', async () => {
    const rules = [rule('rp', CLOSED, 'closed', 'ticket', 'read', { templateKey: 'client_portfolio' })];
    const kernel = kernelFor(rules);
    const decision = await kernel.authorizeResource(inputFor('ticket', 'read', { id: 'x', clientId: 'not-in-portfolio' }));
    expect(decision.allowed).toBe(false);
    const portfolio = decision.reasons.find((r) => r.code === BUNDLE_PORTFOLIO_DENIED_CODE)!;
    expect(portfolio).toMatchObject({ sourceType: 'bundle', sourceId: 'rp', metadata: { ruleIds: ['rp'], bundleIds: [CLOSED] } });
    expect(decision.reasons.map((r) => r.code)).toContain(BUNDLE_TEMPLATE_DENIED_CODE);

    const allowed = await kernel.authorizeResource(inputFor('ticket', 'read', { id: 'x', clientId: 'c1' }));
    expect(allowed.allowed).toBe(true);
  });

  it('a non-portfolio template deny does not emit the portfolio reason', async () => {
    const decision = await kernelFor([rule('r', OPEN, 'open', 'ticket', 'read')]).authorizeResource(
      inputFor('ticket', 'read', { id: 'x', clientId: 'zzz' })
    );
    expect(decision.reasons.map((r) => r.code)).not.toContain(BUNDLE_PORTFOLIO_DENIED_CODE);
  });

  it('client_visible_only deny names the rule', async () => {
    const decision = await kernelFor([
      rule('rv', OPEN, 'open', 'ticket', 'read', { templateKey: null, constraintKey: 'client_visible_only' }),
    ]).authorizeResource(inputFor('ticket', 'read', { id: 'x', clientId: 'c1', is_client_visible: false }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.find((r) => r.code === 'client_visible_only_denied')).toMatchObject({
      sourceId: 'rv',
      metadata: { ruleIds: ['rv'] },
    });
  });

  it('two closed bundles where only one names the resource still deny, naming the other bundle', async () => {
    const rules = [rule('a', CLOSED, 'closed', 'ticket', 'read'), rule('b', CLOSED_2, 'closed', 'project', 'read')];
    const decision = await kernelFor(rules).authorizeResource(inputFor('ticket', 'read'));
    expect(decision.allowed).toBe(false);
    const reasons = decision.reasons.filter((r) => r.code === BUNDLE_CLOSED_BASELINE_DENIED_CODE);
    expect(reasons).toHaveLength(1);
    expect(reasons[0].sourceId).toBe(CLOSED_2);
  });

  it('open + closed: the closed denial stands even when the open bundle has a matching, satisfied rule', async () => {
    const rules = [rule('ro', OPEN, 'open', 'project', 'read'), rule('rc', CLOSED, 'closed', 'ticket', 'read')];
    const decision = await kernelFor(rules).authorizeResource(inputFor('project', 'read'));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(['bundle_narrowing_applied', BUNDLE_CLOSED_BASELINE_DENIED_CODE])
    );
  });

  it('rules without a baseline or bundle identity behave as open (existing call sites)', async () => {
    const provider = new BundleAuthorizationKernelProvider({
      resolveRules: async () => [{ id: 'legacy', resource: 'asset', action: 'read', templateKey: 'same_client' }],
    });
    const unmatched = await provider.evaluateNarrowing(inputFor('ticket', 'read'));
    expect(unmatched.scope.allowAll).toBe(true);
    // a closed rule that cannot be attributed to a bundle is not treated as a closed bundle
    const noBundle = new BundleAuthorizationKernelProvider({
      resolveRules: async () => [{ id: 'x', resource: 'asset', action: 'read', baseline: 'closed' }],
    });
    expect((await noBundle.evaluateNarrowing(inputFor('ticket', 'read'))).scope.allowAll).toBe(true);
  });

  it('invariant: a closed revision is visible to the provider only through its rules (publish refuses an empty revision)', async () => {
    // With zero rules a closed bundle is invisible to the provider; the guard is publishBundleRevision's
    // empty-draft refusal (pinned in bundleRevisionPublishing.integration.test.ts).
    const provider = new BundleAuthorizationKernelProvider({ resolveRules: async () => [] });
    expect((await provider.evaluateNarrowing(inputFor('ticket', 'read'))).scope.allowAll).toBe(true);
  });

  it('bundleNarrowingRuleFromRow maps baseline, bundle and revision; a missing baseline is open', () => {
    const base = { rule_id: 'r', resource_type: 'ticket', action: 'read', template_key: 'own', constraint_key: null, config: {} };
    expect(bundleNarrowingRuleFromRow({ ...base, bundle_id: 'b', revision_id: 'v', baseline: 'closed' })).toMatchObject({
      bundleId: 'b', revisionId: 'v', baseline: 'closed',
    });
    expect(bundleNarrowingRuleFromRow(base).baseline).toBe('open');
    expect(bundleNarrowingRuleFromRow({ ...base, baseline: 'garbage' }).baseline).toBe('open');
  });
});
