import { describe, expect, it } from 'vitest';
import { isDefaultLayerName, planSubtreeRename, suggestLayerName } from './structureEditing';

describe('layer name suggestions', () => {
  it('recognises names the designer generated and nothing else', () => {
    expect(isDefaultLayerName('Data Field 3', 'Data Field')).toBe(true);
    expect(isDefaultLayerName('Data Field', 'Data Field')).toBe(true);
    expect(isDefaultLayerName('Data Field 3b', 'Data Field')).toBe(false);
    expect(isDefaultLayerName('issue-date', 'Data Field')).toBe(false);
  });

  it('names a block after its binding, standard label or lone token', () => {
    expect(suggestLayerName({ bindingKey: 'invoice.issueDate' })).toBe('issue-date');
    expect(suggestLayerName({ bindingKey: 'invoice.number' })).toBe('invoice-number');
    expect(suggestLayerName({ bindingKey: 'customer.name' })).toBe('customer-name');
    expect(suggestLayerName({ i18nKey: 'labels.invoiceTitle' })).toBe('invoice-title');
    expect(suggestLayerName({ text: '{{tenant.address}}' })).toBe('tenant-address');
    expect(suggestLayerName({ text: 'Thanks for your business' })).toBeNull();
  });
});

describe('planSubtreeRename', () => {
  it('carries a copied card\'s new name onto its inner layers', () => {
    expect(planSubtreeRename('from-card-2', 'bill-to-card', ['from-label-2', 'from-name-2', 'from-address-2'])).toEqual([
      { from: 'from-label-2', to: 'bill-to-label' },
      { from: 'from-name-2', to: 'bill-to-name' },
      { from: 'from-address-2', to: 'bill-to-address' },
    ]);
  });

  it('offers nothing when the names share no prefix or suffix, or the new name keeps no common core', () => {
    expect(planSubtreeRename('card', 'panel', ['title', 'body'])).toBeNull();
    expect(planSubtreeRename('from-card-2', 'summary', ['from-label-2'])).toBeNull();
    expect(planSubtreeRename('from-card', 'bill-to-card', [])).toBeNull();
  });
});
