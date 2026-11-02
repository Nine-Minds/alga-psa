import { describe, expect, it } from 'vitest';
import type { RmaStatus } from '@alga-psa/types';
import { RMA_STATUSES } from '@alga-psa/types';
import {
  WARRANTY_ACTIONS,
  WARRANTY_TRANSITIONS,
  RmaTransitionError,
  allowedWarrantyActions,
  assertWarrantyTransition,
  isAssetTracked,
  nextWarrantyStatus,
} from './stateMachine';

describe('warranty state machine', () => {
  it('approve leads from warranty_review to the chosen track', () => {
    expect(nextWarrantyStatus('warranty_review', 'approve_standard')).toBe('awaiting_return');
    expect(nextWarrantyStatus('warranty_review', 'approve_advance')).toBe('open');
  });

  it('deny closes with warranty_denied and cancel closes; both only from warranty_review', () => {
    const deny = assertWarrantyTransition('warranty_review', 'deny');
    expect(deny).toMatchObject({ to: 'closed', closes: true, fixedClosedReason: 'warranty_denied', eventType: 'warranty_denied' });
    expect(assertWarrantyTransition('warranty_review', 'cancel').to).toBe('closed');
    for (const s of RMA_STATUSES.filter((s) => s !== 'warranty_review')) {
      expect(nextWarrantyStatus(s, 'deny')).toBeNull();
      expect(nextWarrantyStatus(s, 'cancel')).toBeNull();
    }
  });

  it('the Dell path walks standard track to closed', () => {
    let s: RmaStatus = 'warranty_review';
    for (const a of ['approve_standard', 'mark_device_received', 'ship_to_vendor', 'receive_replacement', 'return_to_client'] as const) {
      s = assertWarrantyTransition(s, a).to;
    }
    expect(s).toBe('closed');
  });

  it('the advance track takes the replacement straight from open', () => {
    expect(assertWarrantyTransition('open', 'receive_replacement').to).toBe('replaced');
    expect(assertWarrantyTransition('open', 'record_credit').to).toBe('credited');
  });

  it('refuses out-of-order steps with a status message', () => {
    expect(() => assertWarrantyTransition('warranty_review', 'ship_to_vendor')).toThrow(/expected one of: returned/);
    expect(() => assertWarrantyTransition('closed', 'close')).toThrow(RmaTransitionError);
    expect(() => assertWarrantyTransition('returned', 'receive_replacement')).toThrow(RmaTransitionError);
  });

  it('the generic close cannot bypass the warranty decision', () => {
    try {
      assertWarrantyTransition('warranty_review', 'close');
      throw new Error('should have refused');
    } catch (e) {
      expect(e).toBeInstanceOf(RmaTransitionError);
      expect((e as RmaTransitionError).code).toBe('warranty_review_close');
    }
  });

  it('close is allowed from replaced, repaired, credited and returned', () => {
    for (const s of ['replaced', 'repaired', 'credited', 'returned'] as const) expect(nextWarrantyStatus(s, 'close')).toBe('closed');
  });

  it('every transition names statuses the DB CHECK knows about', () => {
    for (const a of WARRANTY_ACTIONS) {
      const t = WARRANTY_TRANSITIONS[a];
      expect(RMA_STATUSES).toContain(t.to);
      for (const f of t.from) expect(RMA_STATUSES).toContain(f);
    }
  });

  it('closed is terminal and allowedWarrantyActions agrees with the table', () => {
    expect(allowedWarrantyActions('closed')).toEqual([]);
    expect(allowedWarrantyActions('warranty_review').sort()).toEqual(['approve_advance', 'approve_standard', 'cancel', 'deny']);
    expect(allowedWarrantyActions('sent_to_vendor').sort()).toEqual(['receive_replacement', 'record_credit', 'record_repair']);
  });

  it('asset-writing steps are flagged so permissions can require asset:update', () => {
    expect(WARRANTY_TRANSITIONS.ship_to_vendor.writesAsset).toBe(true);
    expect(WARRANTY_TRANSITIONS.approve_standard.writesAsset).toBe(false);
  });

  it('ownership discriminator is returned_unit_id only', () => {
    expect(isAssetTracked({ returned_unit_id: null })).toBe(true);
    expect(isAssetTracked({})).toBe(true);
    expect(isAssetTracked({ returned_unit_id: 'u1' })).toBe(false);
  });
});
