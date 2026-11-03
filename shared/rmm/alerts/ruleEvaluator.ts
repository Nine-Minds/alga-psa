import { evaluatePredicate, validatePredicate } from '@alga-psa/predicates';
import type { PredicateGroup } from '@alga-psa/predicates';
import { normalizeRmmAlertConditions, rmmAlertQuerySchema } from './contracts';
import type { NormalizedRmmAlertEvent, RmmAlertRuleRow } from './contracts';

export interface RuleEvaluationResult {
  rule: RmmAlertRuleRow | null;
  warnings: string[];
}

/** First matching rule wins; an exclusion therefore vetoes only its own rule. */
export function evaluateAlertRules(rules: RmmAlertRuleRow[], event: NormalizedRmmAlertEvent): RuleEvaluationResult {
  const warnings: string[] = [];
  const record = {
    severity: event.severity,
    alertClass: event.alertClass ?? null,
    activityType: event.activityType ?? null,
    sourceType: event.sourceType ?? null,
    organizationId: event.externalOrganizationId ?? null,
    message: event.message ?? null,
    details: event.details ?? null,
    text: [event.message, event.details].filter(Boolean).join('\n'),
    deviceName: event.deviceName ?? null,
    externalDeviceId: event.externalDeviceId ?? null,
  };

  for (const rule of rules) {
    try {
      const conditions = normalizeRmmAlertConditions(typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions);
      // Legacy regex is an isolated top-level AND escape hatch. It cannot be authored
      // as a predicate path and never changes nested user group semantics.
      const regexes = conditions.clauses.flatMap(clause => !('clauses' in clause) && clause.path === '__legacyMessagePattern' && typeof clause.value === 'string' ? [clause.value] : []);
      for (const regex of regexes) {
        try { new RegExp(regex); } catch (error) {
          warnings.push(`Rule ${rule.rule_id} (${rule.name}) skipped: invalid legacy messagePattern: ${error instanceof Error ? error.message : String(error)}`);
          throw new InvalidLegacyRegex();
        }
      }
      const predicate = { ...conditions, clauses: conditions.clauses.filter(clause => 'clauses' in clause || clause.path !== '__legacyMessagePattern') };
      const validationErrors = validatePredicate(rmmAlertQuerySchema, predicate);
      if (validationErrors.length) throw new Error(validationErrors.map(issue => issue.message).join('; '));
      if (evaluatePredicate(predicate, record) && regexes.every(pattern => new RegExp(pattern).test(record.text))) {
        return { rule, warnings };
      }
    } catch (error) {
      if (error instanceof InvalidLegacyRegex) continue;
      warnings.push(`Rule ${rule.rule_id} (${rule.name}) skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { rule: null, warnings };
}

class InvalidLegacyRegex extends Error {}
