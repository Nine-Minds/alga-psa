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

describe('mapUniqueViolation: shared QBO item guard index', () => {
  const row = { integration_type: 'quickbooks_online', alga_entity_type: 'client' };
  const pg = (constraint: string) => ({ code: '23505', constraint });

  it.each([
    'idx_unique_external_mapping',
    'idx_unique_external_mapping_102345',
    'idx_unique_external_mapping_qbo_guard',
    'idx_unique_external_mapping_qbo_guard_102345',
  ])('reports %s as a target conflict', (constraint) => {
    expect(mapUniqueViolation(pg(constraint), row)?.messageKey).toBe(
      'msp/integrations:errors.mappings.duplicateTarget'
    );
  });

  it('reports the Alga-side index as an entity conflict and never swallows other 23505s', () => {
    expect(mapUniqueViolation(pg('idx_unique_alga_mapping_102345'), row)?.messageKey).toBe(
      'msp/integrations:errors.mappings.duplicate'
    );
    expect(mapUniqueViolation(pg('some_other_constraint'), row)?.messageKey).toBe(
      'msp/integrations:errors.mappings.duplicate'
    );
    expect(mapUniqueViolation({ code: '23503' }, row)).toBeNull();
  });
});
