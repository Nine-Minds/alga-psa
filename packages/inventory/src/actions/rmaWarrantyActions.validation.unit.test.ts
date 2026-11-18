/**
 * C5: invalid warranty input is a refusal returned as a value (`{actionError}`), never a thrown ZodError (whose
 * `issues` do not survive the server-action boundary), and it is refused before any database work.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ createTenantKnex: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: any[]) => unknown) => (...args: unknown[]) => fn({ user_id: 'u1' }, { tenant: 't1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', async (orig) => ({ ...(await orig<Record<string, unknown>>()), ...db }));

import { denyWarrantyClaim, openWarrantyClaim, shipToVendor, receiveVendorReplacement, approveWarrantyClaim } from './rmaWarrantyActions';

const RMA = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';

beforeEach(() => { db.createTenantKnex.mockClear(); db.withTransaction.mockClear(); });

const expectRefusal = (result: any, message: string, key: string) => {
  expect(result).toEqual({ actionError: message, messageKey: key });
  expect(db.createTenantKnex).not.toHaveBeenCalled();
  expect(db.withTransaction).not.toHaveBeenCalled();
};

describe('warranty actions return validation refusals as values', () => {
  it('deny with an empty reason', async () => {
    expectRefusal(await denyWarrantyClaim(RMA, { denial_reason: '   ' }), 'Give the reason the claim is not covered', 'features/inventory:errors.rma.warrantyDenialReasonRequired');
  });

  it('ship with an empty carrier', async () => {
    expectRefusal(
      await shipToVendor(RMA, { carrier: '', tracking_number: '1Z999', return_by: '2026-11-10' }),
      'Enter the carrier', 'features/inventory:errors.rma.warrantyCarrierRequired',
    );
  });

  it('ship with an empty tracking number', async () => {
    expectRefusal(
      await shipToVendor(RMA, { carrier: 'UPS', tracking_number: ' ', return_by: '2026-11-10' }),
      'Enter the tracking number', 'features/inventory:errors.rma.warrantyTrackingRequired',
    );
  });

  it('receive replacement without a serial number', async () => {
    expectRefusal(await receiveVendorReplacement(RMA, { replacement_serial_number: '' }), 'Enter the replacement serial number', 'features/inventory:errors.rma.warrantyReplacementSerialRequired');
  });

  it('open a claim without a reason', async () => {
    expectRefusal(await openWarrantyClaim({ asset_id: ASSET, reason: '' }), 'Describe what is wrong with the device', 'features/inventory:errors.rma.warrantyReasonRequired');
  });

  it('a malformed value without a curated message gets the generic refusal', async () => {
    expectRefusal(
      await approveWarrantyClaim(RMA, { track: 'standard', vendor_id: 'not-a-uuid' }),
      'Some of the details are not valid. Check them and try again.', 'features/inventory:errors.rma.warrantyInputInvalid',
    );
  });
});
