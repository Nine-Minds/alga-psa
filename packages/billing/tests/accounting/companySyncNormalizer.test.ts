/**
 * Unit tests for buildNormalizedCompanyPayload
 * (packages/billing/src/services/companySync/companySyncNormalizer.ts).
 *
 * This is the data-in/data-out mapping used before pushing companies to
 * accounting systems: field passthrough, null defaulting, and contact
 * normalization.
 */
import { describe, expect, it } from 'vitest';
import {
  buildNormalizedCompanyPayload,
  type RawCompanyRecord,
} from '../../src/services/companySync/companySyncNormalizer';

describe('buildNormalizedCompanyPayload', () => {
  it('maps a fully populated record through unchanged', () => {
    const raw: RawCompanyRecord = {
      companyId: 'co-1',
      name: 'Acme Co',
      primaryEmail: 'billing@acme.test',
      primaryPhone: '+1-555-0100',
      billingAddress: { line1: '1 Main St', city: 'Springfield', postalCode: '12345', country: 'US' },
      shippingAddress: { line1: '2 Dock Rd', city: 'Springfield' },
      contacts: [{ type: 'billing', name: 'Pat', email: 'pat@acme.test', phone: '+1-555-0101' }],
      taxNumber: 'TAX-99',
      notes: 'VIP customer',
      metadata: { sourceSystem: 'crm' },
    };

    expect(buildNormalizedCompanyPayload(raw)).toEqual({
      companyId: 'co-1',
      name: 'Acme Co',
      primaryEmail: 'billing@acme.test',
      primaryPhone: '+1-555-0100',
      billingAddress: { line1: '1 Main St', city: 'Springfield', postalCode: '12345', country: 'US' },
      shippingAddress: { line1: '2 Dock Rd', city: 'Springfield' },
      contacts: [{ type: 'billing', name: 'Pat', email: 'pat@acme.test', phone: '+1-555-0101' }],
      taxNumber: 'TAX-99',
      notes: 'VIP customer',
      metadata: { sourceSystem: 'crm' },
    });
  });

  it('defaults all optional fields to null/empty for a minimal record', () => {
    const payload = buildNormalizedCompanyPayload({ companyId: 'co-2', name: 'Bare Co' });

    expect(payload).toEqual({
      companyId: 'co-2',
      name: 'Bare Co',
      primaryEmail: null,
      primaryPhone: null,
      billingAddress: null,
      shippingAddress: null,
      contacts: [],
      taxNumber: null,
      notes: null,
      metadata: {},
    });
  });

  it('normalizes undefined optional values to explicit nulls (stable adapter contract)', () => {
    const payload = buildNormalizedCompanyPayload({
      companyId: 'co-3',
      name: 'Null Co',
      primaryEmail: undefined,
      billingAddress: null,
      contacts: undefined,
      metadata: undefined,
    });

    expect(payload.primaryEmail).toBeNull();
    expect(payload.billingAddress).toBeNull();
    expect(payload.contacts).toEqual([]);
    expect(payload.metadata).toEqual({});
  });

  it('fills contact defaults: type falls back to primary, missing fields become null', () => {
    const payload = buildNormalizedCompanyPayload({
      companyId: 'co-4',
      name: 'Contact Co',
      contacts: [
        {},
        { name: 'Sam' },
        { type: 'shipping', email: 'ship@co.test' },
      ],
    });

    expect(payload.contacts).toEqual([
      { type: 'primary', name: null, email: null, phone: null },
      { type: 'primary', name: 'Sam', email: null, phone: null },
      { type: 'shipping', name: null, email: 'ship@co.test', phone: null },
    ]);
  });
});
