import { describe, expect, it } from 'vitest';
import { mapUniqueViolation as mapUniqueViolationTyped, uniqueViolationIndex } from './externalMappingUniqueViolation';

describe('uniqueViolationIndex', () => {
  it('strips the Citus shard suffix', () => {
    expect(
      uniqueViolationIndex({ code: '23505', constraint: 'idx_unique_external_mapping_102345' })
    ).toBe('idx_unique_external_mapping');
  });
  it('leaves unsuffixed names unchanged', () => {
    expect(uniqueViolationIndex({ code: '23505', constraint: 'idx_unique_alga_mapping' })).toBe(
      'idx_unique_alga_mapping'
    );
  });
  it('returns null for non-23505 errors', () => {
    expect(uniqueViolationIndex({ code: '23503', constraint: 'idx_unique_external_mapping' })).toBeNull();
    expect(uniqueViolationIndex(new Error('x'))).toBeNull();
    expect(uniqueViolationIndex(null)).toBeNull();
  });
});

const mapUniqueViolation = (e: unknown, r: { integration_type?: string; alga_entity_type?: string }) =>
  mapUniqueViolationTyped(e, r) as unknown as { actionError: string; messageKey?: string } | null;

describe('mapUniqueViolation', () => {
  const err = { code: '23505', constraint: 'idx_unique_external_mapping_9' };
  it('uses the Xero item message for xero service/discount', () => {
    expect(mapUniqueViolation(err, { integration_type: 'xero', alga_entity_type: 'service' })?.messageKey).toBe(
      'msp/integrations:errors.mappings.duplicateXeroItem'
    );
  });
  it('uses the generic target message otherwise', () => {
    expect(
      mapUniqueViolation(err, { integration_type: 'quickbooks_online', alga_entity_type: 'service' })?.messageKey
    ).toBe('msp/integrations:errors.mappings.duplicateTarget');
  });
  it('keeps the alga-mapping duplicate message', () => {
    expect(
      mapUniqueViolation({ code: '23505', constraint: 'idx_unique_alga_mapping' }, {})?.messageKey
    ).toBe('msp/integrations:errors.mappings.duplicate');
  });
});
