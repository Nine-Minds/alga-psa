import { describe, expect, it } from 'vitest';
import { getDocumentItemFields } from './documentBindingCatalog';

describe('quote designer item-field catalog', () => {
  it('exposes item name, catalog description, and line description as distinct quote fields', () => {
    const fields = getDocumentItemFields('quote');

    const byName = new Map(fields.map((field) => [field.name, field]));
    expect(byName.get('service_name')?.valueType).toBe('string');
    expect(byName.get('catalog_description')?.valueType).toBe('string');
    expect(byName.get('description')?.valueType).toBe('string');
  });

  it('keeps the legacy line description meaning unchanged', () => {
    const fields = getDocumentItemFields('quote');
    const description = fields.find((field) => field.name === 'description');
    expect(description?.description).toContain('editable line text');
  });
});
