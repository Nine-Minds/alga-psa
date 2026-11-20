import { describe, expect, it } from 'vitest';
import { BUNDLE_RULE_RESOURCE_TYPES } from '../../bundles/catalog';
import { computeClosedBundleDenialPreview } from '../../bundles/closedBundlePreview';
import { closedBundlesNotNaming, type BundleNarrowingRule } from '../../kernel';

const rule = (resourceType: string, action: string) => ({ resourceType, action });

describe('closed bundle denial preview', () => {
  it('denies every catalog type the bundle does not name at all', () => {
    const preview = computeClosedBundleDenialPreview([rule('ticket', 'read'), rule('ticket', 'create'), rule('ticket', 'update')]);
    expect(preview.deniedResourceTypes).toEqual(BUNDLE_RULE_RESOURCE_TYPES.filter((type) => type !== 'ticket'));
    expect(preview.deniedResourceTypes).not.toContain('ticket');
  });

  it('lists the actions a partially named type still denies; delete is covered by an update rule', () => {
    const preview = computeClosedBundleDenialPreview([rule('ticket', 'read'), rule('asset', 'read'), rule('asset', 'update')]);
    expect(preview.partiallyDeniedResourceTypes).toEqual([
      { resourceType: 'ticket', deniedActions: ['create', 'update', 'delete'], fullyDenied: false },
      { resourceType: 'asset', deniedActions: ['create'], fullyDenied: false },
    ]);
  });

  it('is derived from the catalog it is given, not a fixed list', () => {
    const preview = computeClosedBundleDenialPreview([rule('ticket', 'read')], ['ticket', 'future_type']);
    expect(preview.deniedResourceTypes).toEqual(['future_type']);
  });

  it('agrees with the kernel rule for every catalog type and preview action', () => {
    const rules = [rule('ticket', 'read'), rule('client', 'update'), rule('tag', 'read'), rule('tag', 'create')];
    const kernelRules: BundleNarrowingRule[] = rules.map((r, i) => ({
      id: `r${i}`, resource: r.resourceType, action: r.action, templateKey: 'client_portfolio', bundleId: 'b', baseline: 'closed',
    }));
    const preview = computeClosedBundleDenialPreview(rules);
    for (const type of BUNDLE_RULE_RESOURCE_TYPES) {
      const entry = preview.entries.find((e) => e.resourceType === type);
      for (const action of ['read', 'create', 'update', 'delete'] as const) {
        const kernelDenies = closedBundlesNotNaming(kernelRules, type, action).length > 0;
        expect(entry?.deniedActions.includes(action) ?? false).toBe(kernelDenies);
      }
    }
  });
});
