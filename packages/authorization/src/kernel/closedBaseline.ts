import { matchRulesForAction } from './actionAliases';
import type { BundleNarrowingRule } from './providers/bundleProvider';

/**
 * The single derivation of the closed baseline, shared by the JS provider and the SQL compiler so the two
 * cannot drift.
 *
 * Closed bundles are the bundles whose rules carry baseline 'closed'. They are derived from the rule list the
 * caller already holds: publishBundleRevision refuses an empty revision, so a published closed revision always
 * has at least one rule and therefore always shows up here. A rule with no bundleId cannot be attributed to a
 * bundle and is never treated as closed.
 *
 * Consequently a caller must pass the subject's full assigned rule set, unfiltered; filtering rules out makes a
 * closed bundle look like it does not name a resource (false deny) or hides it (false allow). To neutralise a
 * rule, keep it and change it (e.g. `templateKey: null`) instead of dropping it.
 */
export interface ClosedBundleDenial {
  bundleId: string;
  revisionId: string | null;
}

/** Closed bundles with no rule (alias-aware, via matchRulesForAction) for this resource and action. */
export function closedBundlesNotNaming(
  rules: BundleNarrowingRule[],
  resource: string,
  action: string
): ClosedBundleDenial[] {
  const closed = new Map<string, BundleNarrowingRule[]>();
  for (const rule of rules) {
    if (rule.baseline !== 'closed' || !rule.bundleId) continue;
    const group = closed.get(rule.bundleId);
    if (group) group.push(rule);
    else closed.set(rule.bundleId, [rule]);
  }

  const denials: ClosedBundleDenial[] = [];
  for (const [bundleId, bundleRules] of closed) {
    if (matchRulesForAction(bundleRules, resource, action).length > 0) continue;
    denials.push({ bundleId, revisionId: bundleRules.find((rule) => rule.revisionId)?.revisionId ?? null });
  }
  return denials;
}

/**
 * Whether the bundle rules restrict this resource and action at all: a rule names it (alias-aware), or a closed
 * bundle does not. Callers that skip per-record authorization for unrestricted subjects must ask this, not
 * whether a rule names the resource — a closed bundle restricts precisely what it does not name.
 */
export function bundleRulesRestrict(rules: BundleNarrowingRule[], resource: string, action: string): boolean {
  return matchRulesForAction(rules, resource, action).length > 0 || closedBundlesNotNaming(rules, resource, action).length > 0;
}
