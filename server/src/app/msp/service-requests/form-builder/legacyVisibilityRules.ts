/**
 * Legacy visibility rules, adopted onto the elements they govern.
 *
 * Before the builder, a conditional field was configured as a `visibilityRules` entry in the EE
 * advanced form-behavior provider's config: `{ fieldKey, source, operator, value }`. The builder
 * writes conditions on the element itself (`visibleWhen`), and both lists feed the one evaluator
 * in `formVisibility.ts`, so the two forms behave identically.
 *
 * Opening such a definition therefore adopts every rule whose `fieldKey` names an element in the
 * schema: the author sees and edits it like any other condition, and saving writes it as the
 * element's `visibleWhen` and drops it from the config. A rule naming no element cannot be said
 * as an element condition, so it stays in the config and keeps being evaluated — the inspector
 * marks the form so the author knows a rule exists outside the builder.
 */
import {
  parseVisibilityRules,
  type ElementVisibilityRule,
  type VisibilityRule,
} from '../../../../lib/service-requests/formVisibility';
import type { BasicFormField } from '../../../../lib/service-requests/formSchema';

export interface LegacyVisibilityAdoption {
  /** The elements, with every adopted rule appended to their own conditions. */
  elements: BasicFormField[];
  /**
   * The config to save, with the adopted rules removed — `null` when nothing was adopted, so
   * the builder leaves an untouched config alone.
   */
  remainingConfig: Record<string, unknown> | null;
  /** Rules that no element could express; they stay in the config and keep being evaluated. */
  unadoptedRules: VisibilityRule[];
}

const sameRule = (left: ElementVisibilityRule, right: ElementVisibilityRule): boolean =>
  left.source === right.source &&
  left.operator === right.operator &&
  JSON.stringify(left.value ?? null) === JSON.stringify(right.value ?? null);

export function adoptLegacyVisibilityRules(
  elements: readonly BasicFormField[],
  config: Record<string, unknown> | undefined
): LegacyVisibilityAdoption {
  const legacyRules = config ? (parseVisibilityRules(config) ?? []) : [];
  if (legacyRules.length === 0) {
    return { elements: [...elements], remainingConfig: null, unadoptedRules: [] };
  }

  const elementKeys = new Set(elements.map((element) => element.key));
  const adoptedByKey = new Map<string, ElementVisibilityRule[]>();
  const unadoptedRules: VisibilityRule[] = [];

  for (const rule of legacyRules) {
    if (!elementKeys.has(rule.fieldKey)) {
      unadoptedRules.push(rule);
      continue;
    }
    const { fieldKey, ...condition } = rule;
    const existing = adoptedByKey.get(fieldKey) ?? [];
    existing.push(condition);
    adoptedByKey.set(fieldKey, existing);
  }

  if (adoptedByKey.size === 0) {
    return { elements: [...elements], remainingConfig: null, unadoptedRules };
  }

  const nextElements = elements.map((element) => {
    const adopted = adoptedByKey.get(element.key);
    if (!adopted) return element;
    const own = element.visibleWhen ?? [];
    // A rule the author already wrote on the element wins; the legacy copy is not duplicated.
    const added = adopted.filter((rule) => !own.some((mine) => sameRule(mine, rule)));
    return added.length > 0 ? { ...element, visibleWhen: [...own, ...added] } : element;
  });

  const { visibilityRules: _adopted, ...rest } = config ?? {};
  const remainingConfig =
    unadoptedRules.length > 0 ? { ...rest, visibilityRules: unadoptedRules } : { ...rest };

  return { elements: nextElements, remainingConfig, unadoptedRules };
}
