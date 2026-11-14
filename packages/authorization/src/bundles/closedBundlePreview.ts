import { closedSourcesNotNaming } from '../kernel/closedBaseline';
import { BUNDLE_RULE_RESOURCE_TYPES } from './catalog';

/**
 * What a closed bundle will deny, for the editor's pre-publish preview.
 *
 * A closed bundle denies every (resource, action) it does not name. This asks the question the kernel asks —
 * `closedSourcesNotNaming`, the same alias-aware rule the bundle provider and the SQL compiler use — once per
 * catalog resource type and action, so the preview cannot drift from enforcement (a `delete` is named by an
 * `update` rule, for instance).
 */

/** The actions a closed bundle is previewed over. `approve` is excluded: it exists only where a rule names it. */
export const CLOSED_PREVIEW_ACTIONS = ['read', 'create', 'update', 'delete'] as const;
export type ClosedPreviewAction = (typeof CLOSED_PREVIEW_ACTIONS)[number];

export interface ClosedBundleDenialPreviewEntry {
  resourceType: string;
  /** The previewed actions the bundle does not name for this resource type, so denies. */
  deniedActions: ClosedPreviewAction[];
  /** True when the bundle names none of the resource type's actions: the type is denied outright. */
  fullyDenied: boolean;
}

export interface ClosedBundleDenialPreview {
  /** Catalog types the bundle does not name at all. */
  deniedResourceTypes: string[];
  /** Catalog types the bundle names for some actions only, with the actions it leaves denied. */
  partiallyDeniedResourceTypes: ClosedBundleDenialPreviewEntry[];
  entries: ClosedBundleDenialPreviewEntry[];
}

export function computeClosedBundleDenialPreview(
  rules: ReadonlyArray<{ resourceType: string; action: string }>,
  catalog: readonly string[] = BUNDLE_RULE_RESOURCE_TYPES
): ClosedBundleDenialPreview {
  const source = {
    id: 'preview',
    rules: rules.map((rule) => ({ resource: rule.resourceType, action: rule.action })),
  };

  const entries: ClosedBundleDenialPreviewEntry[] = [];
  for (const resourceType of catalog) {
    const deniedActions = CLOSED_PREVIEW_ACTIONS.filter(
      (action) => closedSourcesNotNaming([source], resourceType, action).length > 0
    );
    if (deniedActions.length === 0) continue;
    entries.push({
      resourceType,
      deniedActions,
      fullyDenied: !source.rules.some((rule) => rule.resource === resourceType),
    });
  }

  return {
    deniedResourceTypes: entries.filter((entry) => entry.fullyDenied).map((entry) => entry.resourceType),
    partiallyDeniedResourceTypes: entries.filter((entry) => !entry.fullyDenied),
    entries,
  };
}
