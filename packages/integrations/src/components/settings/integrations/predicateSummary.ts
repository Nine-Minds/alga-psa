import type { PredicateGroup } from '@alga-psa/predicates';
import type { PredicateFieldDescriptor } from './RmmAlertPredicateEditor';

export function formatPredicateSummary(
  group: PredicateGroup,
  fields: readonly PredicateFieldDescriptor[],
  translate: (key: string, fallback: string) => string,
): string {
  const summarize = (node: PredicateGroup): string => node.clauses.map(clause => {
    if ('clauses' in clause) return `(${summarize(clause)})`;
    const descriptor = fields.find(field => field.path === clause.path);
    const fieldLabel = descriptor ? translate(descriptor.labelKey, descriptor.label) : clause.path;
    const operatorLabel = translate(`integrations.rmm.alertAutomation.predicate.operators.${clause.operator}`, clause.operator.replaceAll('_', ' '));
    const value = Array.isArray(clause.value) ? clause.value.join(', ') : String(clause.value ?? '');
    return `${fieldLabel} ${operatorLabel} ${value}`;
  }).join(node.join === 'and'
    ? ` ${translate('integrations.rmm.alertAutomation.predicate.and', 'and')} `
    : ` ${translate('integrations.rmm.alertAutomation.predicate.or', 'or')} `);
  return summarize(group);
}
