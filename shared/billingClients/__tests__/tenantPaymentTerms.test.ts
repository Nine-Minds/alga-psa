import { describe, expect, it, vi } from 'vitest';

const row = vi.hoisted(() => ({ current: undefined as { default_payment_terms?: unknown } | undefined }));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => ({ first: async () => row.current }),
  }),
}));

import {
  readTenantDefaultPaymentTerms,
  resolveTenantDefaultPaymentTerms,
} from '../tenantPaymentTerms';

const knex = {} as any;

describe('tenantPaymentTerms', () => {
  it('returns a recognised stored term', async () => {
    row.current = { default_payment_terms: 'net_14' };
    expect(await readTenantDefaultPaymentTerms(knex, 't')).toBe('net_14');
    expect(await resolveTenantDefaultPaymentTerms(knex, 't')).toBe('net_14');
  });

  it.each([
    ['missing row', undefined],
    ['NULL column', { default_payment_terms: null }],
    ['empty string', { default_payment_terms: '' }],
    ['unknown value', { default_payment_terms: 'net_45' }],
  ])('treats %s as unset and falls back to Net 30', async (_name, value) => {
    row.current = value as any;
    expect(await readTenantDefaultPaymentTerms(knex, 't')).toBeNull();
    expect(await resolveTenantDefaultPaymentTerms(knex, 't')).toBe('net_30');
  });
});
