import { describe, expect, it } from 'vitest';
import { createClientSchema, updateClientSchema } from '@/lib/api/schemas/client';
import { normalizeLegacyClientTaxId, replaceClientPropertiesPreservingLegacyTaxId } from '@/lib/api/services/ClientService';

describe('client Tax ID legacy API compatibility', () => {
  it('maps legacy properties.tax_id for create and update and removes it from properties', () => {
    const create = createClientSchema.parse({ client_name: 'Acme', billing_cycle: 'monthly', properties: { tax_id: ' legacy ', industry: 'IT' } });
    const update = updateClientSchema.parse({ properties: { tax_id: ' legacy ', industry: 'IT' } });
    expect(normalizeLegacyClientTaxId(create as any)).toMatchObject({ tax_id_number: 'legacy', properties: { industry: 'IT' } });
    expect(normalizeLegacyClientTaxId(update as any)).toEqual({ tax_id_number: 'legacy', properties: { industry: 'IT' } });
  });

  it('preserves canonical-only input', () => {
    expect(normalizeLegacyClientTaxId({ tax_id_number: 'canonical' })).toEqual({ tax_id_number: 'canonical' });
  });

  it('accepts agreeing canonical and legacy values', () => {
    expect(normalizeLegacyClientTaxId({ tax_id_number: 'same', properties: { tax_id: 'same', industry: 'IT' } })).toEqual({ tax_id_number: 'same', properties: { industry: 'IT' } });
  });

  it('gives canonical input precedence when the values conflict', () => {
    expect(normalizeLegacyClientTaxId({ tax_id_number: 'canonical', properties: { tax_id: 'legacy' } })).toEqual({ tax_id_number: 'canonical', properties: {} });
  });

  it('replaces properties while carrying forward the audit value and never saving tax_id', () => {
    const normalized = normalizeLegacyClientTaxId({ properties: { tax_id: ' legacy ', industry: 'IT' } });
    expect(normalized).toEqual({ tax_id_number: 'legacy', properties: { industry: 'IT' } });
    expect(replaceClientPropertiesPreservingLegacyTaxId(normalized.properties, { retained: true, legacy_tax_id: ['older'] })).toEqual({ industry: 'IT', legacy_tax_id: ['older'] });
    expect(replaceClientPropertiesPreservingLegacyTaxId(normalized.properties, { legacy_tax_id: 'older' })).not.toHaveProperty('tax_id');
    expect(replaceClientPropertiesPreservingLegacyTaxId({ industry: 'new', legacy_tax_id: 'caller-value' }, { legacy_tax_id: 'older' })).toEqual({ industry: 'new', legacy_tax_id: 'caller-value' });
  });
});
