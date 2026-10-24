/**
 * Shared, dependency-free evaluator for service-request conditional field visibility.
 *
 * This module is imported by the client portal form (a Next client component), the EE
 * advanced form-behavior provider, and the submission service. It therefore must not import
 * knex, `@alga-psa/db`, the provider registry, `server-only`, or anything from `contracts.ts`.
 *
 * Evaluation order: `computeVisibleFieldKeys` walks the fields ONCE, top to bottom in form
 * order. A field that has been decided hidden counts as empty (`undefined`) when later rules
 * read it, so "controller hidden => dependent hidden" holds automatically. Because a rule can
 * only observe fields decided before it (plus raw values of non-field keys), cycles are
 * structurally impossible and the browser and the server always agree.
 * Do NOT replace this with a repeat-until-stable loop unless both sides change together.
 */

export type VisibilityRuleOperator =
  | 'equals'
  | 'not-equals'
  | 'is-true'
  | 'is-false'
  | 'has-value'
  | 'is-empty';

export interface VisibilityRule {
  fieldKey: string;
  source: string;
  operator: VisibilityRuleOperator;
  value?: unknown;
}

export interface VisibilityContext {
  requesterUserId: string;
  clientId: string;
  contactId?: string | null;
}

// LEVERAGE: pattern visibility-operator-list — the six operators are spelled out here (parse, validate) and in fieldVisibilityModel.ts; a single exported operator table would remove the copies. Moved verbatim to keep validation messages byte-identical.
export function parseVisibilityRules(config: Record<string, unknown>): VisibilityRule[] | undefined {
  return Array.isArray(config.visibilityRules)
    ? config.visibilityRules
        .map((candidate) => {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            return null;
          }

          const rule = candidate as Record<string, unknown>;
          if (
            typeof rule.fieldKey !== 'string' ||
            typeof rule.source !== 'string' ||
            (rule.operator !== 'equals' &&
              rule.operator !== 'not-equals' &&
              rule.operator !== 'is-true' &&
              rule.operator !== 'is-false' &&
              rule.operator !== 'has-value' &&
              rule.operator !== 'is-empty')
          ) {
            return null;
          }

          return {
            fieldKey: rule.fieldKey.trim(),
            source: rule.source.trim(),
            operator: rule.operator,
            value: rule.value,
          } as VisibilityRule;
        })
        .filter((rule): rule is VisibilityRule => !!rule)
    : undefined;
}

export function validateVisibilityRules(config: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if ('visibilityRules' in config) {
    if (!Array.isArray(config.visibilityRules)) {
      errors.push('visibilityRules must be an array');
    } else {
      for (const [index, rule] of config.visibilityRules.entries()) {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
          errors.push(`visibilityRules[${index}] must be an object`);
          continue;
        }

        const candidate = rule as Record<string, unknown>;
        if (typeof candidate.fieldKey !== 'string' || candidate.fieldKey.trim().length === 0) {
          errors.push(`visibilityRules[${index}].fieldKey is required`);
        }
        if (typeof candidate.source !== 'string' || candidate.source.trim().length === 0) {
          errors.push(`visibilityRules[${index}].source is required`);
        }

        const operator = candidate.operator;
        if (
          operator !== 'equals' &&
          operator !== 'not-equals' &&
          operator !== 'is-true' &&
          operator !== 'is-false' &&
          operator !== 'has-value' &&
          operator !== 'is-empty'
        ) {
          errors.push(
            `visibilityRules[${index}].operator must be one of equals, not-equals, is-true, is-false, has-value, is-empty`
          );
        }

        if (
          (operator === 'equals' || operator === 'not-equals') &&
          candidate.value === undefined
        ) {
          errors.push(`visibilityRules[${index}].value is required for ${operator}`);
        }
      }
    }
  }

  return errors;
}

export function resolveVisibilitySourceValue(
  source: string,
  values: Record<string, unknown>,
  context: VisibilityContext
): unknown {
  if (source === 'context.requesterUserId') {
    return context.requesterUserId;
  }
  if (source === 'context.clientId') {
    return context.clientId;
  }
  if (source === 'context.contactId') {
    return context.contactId ?? null;
  }
  if (source.startsWith('payload.')) {
    return values[source.slice('payload.'.length)];
  }
  return values[source];
}

export function evaluateVisibilityRule(rule: VisibilityRule, sourceValue: unknown): boolean {
  switch (rule.operator) {
    case 'equals':
      return sourceValue === rule.value;
    case 'not-equals':
      return sourceValue !== rule.value;
    case 'is-true':
      return sourceValue === true || sourceValue === 'true' || sourceValue === 'on' || sourceValue === '1';
    case 'is-false':
      return (
        sourceValue === false ||
        sourceValue === 'false' ||
        sourceValue === 'off' ||
        sourceValue === '0' ||
        sourceValue === null ||
        sourceValue === undefined ||
        sourceValue === ''
      );
    case 'has-value':
      return sourceValue !== null && sourceValue !== undefined && String(sourceValue).trim().length > 0;
    case 'is-empty':
      return sourceValue === null || sourceValue === undefined || String(sourceValue).trim().length === 0;
    default:
      return true;
  }
}

/**
 * Returns the keys of visible fields, in form order. See the module header for the
 * single-pass, top-down semantics.
 */
export function computeVisibleFieldKeys(
  fields: ReadonlyArray<{ key?: unknown }>,
  rules: ReadonlyArray<VisibilityRule>,
  values: Record<string, unknown>,
  context: VisibilityContext
): string[] {
  const fieldKeys = fields
    .map((field) => (typeof field?.key === 'string' ? field.key : null))
    .filter((fieldKey): fieldKey is string => !!fieldKey);

  if (rules.length === 0) {
    return fieldKeys;
  }

  const rulesByField = new Map<string, VisibilityRule[]>();
  for (const rule of rules) {
    const existing = rulesByField.get(rule.fieldKey) ?? [];
    existing.push(rule);
    rulesByField.set(rule.fieldKey, existing);
  }

  const effectiveValues: Record<string, unknown> = { ...values };
  const visible: string[] = [];
  for (const fieldKey of fieldKeys) {
    const fieldRules = rulesByField.get(fieldKey);
    const isVisible =
      !fieldRules ||
      fieldRules.every((rule) =>
        evaluateVisibilityRule(rule, resolveVisibilitySourceValue(rule.source, effectiveValues, context))
      );
    if (isVisible) {
      visible.push(fieldKey);
    } else {
      // A hidden field counts as empty for every rule evaluated after it.
      delete effectiveValues[fieldKey];
    }
  }
  return visible;
}

/**
 * Whether a required (non-file) field's submitted value counts as missing. Shared so the
 * browser blocks exactly the submissions the server would reject. An unchecked checkbox
 * (`false`) is a value, not a missing answer.
 */
export function isMissingRequiredValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  return false;
}
