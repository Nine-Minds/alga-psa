import type { NormalizedRmmAlertEvent, RmmAlertRuleRow } from './contracts';

export interface RuleEvaluationResult {
  rule: RmmAlertRuleRow | null;
  /** Non-fatal problems encountered while evaluating (bad stored regex etc.). */
  warnings: string[];
}

/**
 * First-match rule selection. Callers pass active rules for the integration
 * ordered by priority_order ascending. Every condition field present on a rule
 * must match; a rule with no conditions is a catch-all. A rule that cannot be
 * evaluated (e.g. an invalid stored regex) is skipped with a warning and never
 * aborts evaluation.
 */
export function evaluateAlertRules(
  rules: RmmAlertRuleRow[],
  event: NormalizedRmmAlertEvent
): RuleEvaluationResult {
  const warnings: string[] = [];

  for (const rule of rules) {
    try {
      if (ruleMatches(rule, event)) {
        return { rule, warnings };
      }
    } catch (error) {
      warnings.push(
        `Rule ${rule.rule_id} (${rule.name}) skipped: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { rule: null, warnings };
}

function ruleMatches(rule: RmmAlertRuleRow, event: NormalizedRmmAlertEvent): boolean {
  const conditions = typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions ?? {};

  if (conditions.severities?.length && !conditions.severities.includes(event.severity)) {
    return false;
  }
  if (conditions.activityTypes?.length && !includesValue(conditions.activityTypes, event.activityType)) {
    return false;
  }
  if (conditions.alertClasses?.length && !includesValue(conditions.alertClasses, event.alertClass)) {
    return false;
  }
  if (conditions.sourceTypes?.length && !includesValue(conditions.sourceTypes, event.sourceType)) {
    return false;
  }
  if (
    conditions.organizationIds?.length &&
    !includesValue(conditions.organizationIds, event.externalOrganizationId)
  ) {
    return false;
  }
  if (conditions.keywords?.length) {
    const message = (event.message ?? '').toLowerCase();
    const hasKeyword = conditions.keywords.some((keyword: string) => message.includes(keyword.toLowerCase()));
    if (!hasKeyword) return false;
  }
  if (conditions.messagePattern) {
    // May throw on an invalid stored pattern; caught by the caller as a skip.
    const pattern = new RegExp(conditions.messagePattern);
    if (!pattern.test(event.message ?? '')) return false;
  }
  return true;
}

function includesValue(haystack: string[], value: string | null | undefined): boolean {
  return value != null && haystack.includes(value);
}
