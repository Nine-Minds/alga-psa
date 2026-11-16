/**
 * Legacy visibility rules, adopted onto the elements they govern.
 *
 * Before the builder, a conditional field was configured as a `visibilityRules` entry in the EE
 * advanced form-behavior provider's config: `{ fieldKey, source, operator, value }`. The builder
 * writes conditions on the element itself (`visibleWhen`), and both lists feed the one evaluator
 * in `formVisibility.ts`, so the two forms behave identically.
 *
 * Opening such a definition therefore adopts every rule the builder's condition editor can say:
 * the author sees and edits it like any other condition, and saving writes it as the element's
 * `visibleWhen` and drops it from the config. A rule the editor cannot say stays in the config
 * and keeps being evaluated. Four shapes cannot be said:
 * - the `fieldKey` names no element, so there is no element to carry the condition;
 * - the `source` is neither an answer-carrying element of this schema nor a context source, so
 *   the editor has nothing to point the sentence at;
 * - the `operator` is not one the source's type offers (an `is-true` stored against a text
 *   field, say), so the editor would show a blank operator and lose the rule on the next edit;
 * - the `source` sits below the element it governs. The config evaluator does not mind, but an
 *   element condition may only read an answer above it, so adopting one would turn a definition
 *   that publishes today into one that cannot be published.
 *
 * The last three name a real element, and `unadoptedRules` carries them so the inspector can
 * mark that element: the author then knows a rule on it lives outside the builder.
 */
import {
  parseVisibilityRules,
  type ElementVisibilityRule,
  type VisibilityRule,
} from '../../../../lib/service-requests/formVisibility';
import type { BasicFormField } from '../../../../lib/service-requests/formSchema';
import {
  VISIBILITY_CONTEXT_SOURCES,
  getVisibilityOperatorsForType,
  getVisibilitySourceFields,
} from '../fieldVisibilityModel';

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

/**
 * Whether the "Only show this when …" sentence can hold this rule: a source it can point at,
 * an operator that source's type actually offers, and a source the element is allowed to read.
 */
function canEditorSay(
  rule: VisibilityRule,
  sourceFields: ReadonlyMap<string, BasicFormField>,
  contextSources: ReadonlySet<string>,
  indexByKey: ReadonlyMap<string, number>
): boolean {
  if (contextSources.has(rule.source)) {
    return true;
  }
  const source = sourceFields.get(rule.source);
  if (!source) {
    return false;
  }
  if (!getVisibilityOperatorsForType(source.type).includes(rule.operator)) {
    return false;
  }
  // An element condition reads answers above it and nothing else — both the editor and
  // `validateBasicFormSchema` say so. A rule pointing downwards stays where it is.
  const sourceIndex = indexByKey.get(rule.source);
  const targetIndex = indexByKey.get(rule.fieldKey);
  return sourceIndex !== undefined && targetIndex !== undefined && sourceIndex < targetIndex;
}

export function adoptLegacyVisibilityRules(
  elements: readonly BasicFormField[],
  config: Record<string, unknown> | undefined
): LegacyVisibilityAdoption {
  const legacyRules = config ? (parseVisibilityRules(config) ?? []) : [];
  if (legacyRules.length === 0) {
    return { elements: [...elements], remainingConfig: null, unadoptedRules: [] };
  }

  const elementKeys = new Set(elements.map((element) => element.key));
  const sourceFields = new Map(
    getVisibilitySourceFields(elements).map((field) => [field.key, field])
  );
  const contextSources = new Set<string>(VISIBILITY_CONTEXT_SOURCES);
  const indexByKey = new Map(elements.map((element, index) => [element.key, index]));
  const adoptedByKey = new Map<string, ElementVisibilityRule[]>();
  const unadoptedRules: VisibilityRule[] = [];

  for (const rule of legacyRules) {
    if (
      !elementKeys.has(rule.fieldKey) ||
      !canEditorSay(rule, sourceFields, contextSources, indexByKey)
    ) {
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
