import { describe, expect, it } from 'vitest';
import { RMM_ALERT_PREDICATE_FIELDS } from './rmmAlertPredicateFields';
import { formatPredicateSummary } from './predicateSummary';

describe('predicate summary labels', () => {
  it('uses translated field and operator labels recursively', () => {
    const labels: Record<string, string> = {
      'integrations.rmm.alertAutomation.predicate.fields.deviceName': 'Nom de l’appareil',
      'integrations.rmm.alertAutomation.predicate.operators.equals': 'est',
      'integrations.rmm.alertAutomation.predicate.fields.text': 'Message et détails',
      'integrations.rmm.alertAutomation.predicate.operators.contains_ci': 'contient sans tenir compte de la casse',
      'integrations.rmm.alertAutomation.predicate.and': 'et',
      'integrations.rmm.alertAutomation.predicate.or': 'ou',
    };
    const summary = formatPredicateSummary({ join: 'and', clauses: [
      { path: 'deviceName', operator: 'equals', value: 'GLICK-PC7' },
      { join: 'or', clauses: [{ path: 'text', operator: 'contains_ci', value: 'Sentinel' }] },
    ] }, RMM_ALERT_PREDICATE_FIELDS, (key, fallback) => labels[key] ?? fallback);
    expect(summary).toBe('Nom de l’appareil est GLICK-PC7 et (Message et détails contient sans tenir compte de la casse Sentinel)');
  });
});
