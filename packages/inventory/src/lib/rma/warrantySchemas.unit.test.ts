import { describe, expect, it } from 'vitest';
import {
  approveWarrantyClaimSchema, cancelWarrantyClaimSchema, closeWarrantyRmaSchema, denyWarrantyClaimSchema,
  openWarrantyClaimSchema, receiveVendorReplacementSchema, shipToVendorSchema,
} from './warrantySchemas';

const id = '3f1c6a1e-8f0e-4a0b-9d3a-2f5b0c1d2e3f';

describe('warranty schemas', () => {
  it('open requires a reason and defaults the provisional track to standard', () => {
    expect(openWarrantyClaimSchema.safeParse({ asset_id: id, reason: '  ' }).success).toBe(false);
    expect(openWarrantyClaimSchema.parse({ asset_id: id, reason: ' dock dead ' })).toMatchObject({ reason: 'dock dead', rma_type: 'standard', vendor_id: null });
  });
  it('deny requires a non-empty reason', () => {
    expect(denyWarrantyClaimSchema.safeParse({}).success).toBe(false);
    expect(denyWarrantyClaimSchema.safeParse({ denial_reason: '  ' }).success).toBe(false);
    expect(denyWarrantyClaimSchema.parse({ denial_reason: ' liquid damage ' }).denial_reason).toBe('liquid damage');
  });
  it('cancel only accepts cancelled or duplicate', () => {
    expect(cancelWarrantyClaimSchema.safeParse({ reason: 'duplicate' }).success).toBe(true);
    expect(cancelWarrantyClaimSchema.safeParse({ reason: 'warranty_denied' }).success).toBe(false);
  });
  it('approve needs a track and a vendor', () => {
    expect(approveWarrantyClaimSchema.safeParse({ track: 'standard' }).success).toBe(false);
    expect(approveWarrantyClaimSchema.safeParse({ track: 'bogus', vendor_id: id }).success).toBe(false);
    expect(approveWarrantyClaimSchema.parse({ track: 'advance_replacement', vendor_id: id, rma_reference: ' 123456789 ' }).rma_reference).toBe('123456789');
  });
  it('ship requires carrier, tracking and a real return-by date', () => {
    const base = { carrier: 'UPS', tracking_number: '1Z999', return_by: '2026-11-30' };
    expect(shipToVendorSchema.safeParse(base).success).toBe(true);
    expect(shipToVendorSchema.safeParse({ ...base, carrier: '' }).success).toBe(false);
    expect(shipToVendorSchema.safeParse({ ...base, tracking_number: ' ' }).success).toBe(false);
    expect(shipToVendorSchema.safeParse({ ...base, return_by: '2026-02-31' }).success).toBe(false);
    expect(shipToVendorSchema.safeParse({ carrier: 'UPS', tracking_number: 'x' }).success).toBe(false);
  });
  it('replacement requires the new serial; blank optional text becomes null', () => {
    expect(receiveVendorReplacementSchema.safeParse({}).success).toBe(false);
    expect(receiveVendorReplacementSchema.parse({ replacement_serial_number: 'NEW1', inbound_carrier: ' ' })).toMatchObject({ inbound_carrier: null, warranty_end_date: null });
  });
  it('close leaves the reason to the status default and refuses warranty_denied', () => {
    expect(closeWarrantyRmaSchema.parse({}).reason).toBeUndefined();
    expect(closeWarrantyRmaSchema.safeParse({ reason: 'warranty_denied' }).success).toBe(false);
  });
});
