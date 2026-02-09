import { describe, expect, it } from 'vitest';
import { INVOICE_PREVIEW_SAMPLE_SCENARIOS } from './sampleScenarios';

describe('sampleScenarios', () => {
  it('exports at least three unique scenarios', () => {
    expect(INVOICE_PREVIEW_SAMPLE_SCENARIOS.length).toBeGreaterThanOrEqual(3);
    const ids = INVOICE_PREVIEW_SAMPLE_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('provides required preview fields for each sample', () => {
    INVOICE_PREVIEW_SAMPLE_SCENARIOS.forEach((scenario) => {
      expect(scenario.data.invoiceNumber).toBeTruthy();
      expect(scenario.data.issueDate).toBeTruthy();
      expect(scenario.data.dueDate).toBeTruthy();
      expect(scenario.data.customer.name).toBeTruthy();
      expect(Array.isArray(scenario.data.items)).toBe(true);
      expect(typeof scenario.data.subtotal).toBe('number');
      expect(typeof scenario.data.tax).toBe('number');
      expect(typeof scenario.data.total).toBe('number');
    });
  });
});
