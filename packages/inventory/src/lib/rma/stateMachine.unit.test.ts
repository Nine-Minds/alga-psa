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

  describe('advance-replacement dead-unit leg', () => {
    const SHIP_FROM: RmaStatus[] = ['replaced', 'repaired'];

    it('ship_dead_unit_to_vendor is allowed from replaced/repaired only, and lands in dead_unit_owed', () => {
      for (const s of RMA_STATUSES) {
        const allowed = SHIP_FROM.includes(s);
        expect(nextWarrantyStatus(s, 'ship_dead_unit_to_vendor', 'advance_replacement')).toBe(allowed ? 'dead_unit_owed' : null);
      }
      expect(WARRANTY_TRANSITIONS.ship_dead_unit_to_vendor).toMatchObject({ eventType: 'dead_unit_shipped', closes: false, writesAsset: true });
    });

    it('rejects re-shipping from dead_unit_owed and every other non-source state with invalid_transition', () => {
      for (const s of RMA_STATUSES.filter((s) => !SHIP_FROM.includes(s))) {
        expect(() => assertWarrantyTransition(s, 'ship_dead_unit_to_vendor', 'advance_replacement')).toThrow(/expected one of: replaced, repaired/);
      }
    });

    it('refuses the standard track even from replaced', () => {
      try {
        assertWarrantyTransition('replaced', 'ship_dead_unit_to_vendor', 'standard');
        throw new Error('should have refused');
      } catch (e) {
        expect(e).toBeInstanceOf(RmaTransitionError);
        expect((e as RmaTransitionError).code).toBe('wrong_track');
      }
      expect(nextWarrantyStatus('replaced', 'ship_dead_unit_to_vendor', 'standard')).toBeNull();
    });

    it('confirm_vendor_receipt is dead_unit_owed -> closed with a fixed resolved reason', () => {
      for (const s of RMA_STATUSES) {
        expect(nextWarrantyStatus(s, 'confirm_vendor_receipt', 'advance_replacement')).toBe(s === 'dead_unit_owed' ? 'closed' : null);
      }
      expect(WARRANTY_TRANSITIONS.confirm_vendor_receipt).toMatchObject({ closes: true, fixedClosedReason: 'resolved', eventType: 'vendor_receipt_confirmed' });
      expect(() => assertWarrantyTransition('dead_unit_owed', 'confirm_vendor_receipt', 'standard')).toThrow(RmaTransitionError);
    });

    it('generic close accepts dead_unit_owed; return_to_client does not', () => {
      expect(nextWarrantyStatus('dead_unit_owed', 'close')).toBe('closed');
      expect(nextWarrantyStatus('dead_unit_owed', 'return_to_client')).toBeNull();
      expect(WARRANTY_TRANSITIONS.return_to_client.from).toEqual(['replaced', 'repaired']);
    });

    it('allowedWarrantyActions offers the dead-unit steps on the advance track only', () => {
      expect(allowedWarrantyActions('replaced', 'advance_replacement')).toContain('ship_dead_unit_to_vendor');
      expect(allowedWarrantyActions('replaced', 'standard')).not.toContain('ship_dead_unit_to_vendor');
      expect(allowedWarrantyActions('dead_unit_owed', 'advance_replacement').sort()).toEqual(['close', 'confirm_vendor_receipt']);
      expect(allowedWarrantyActions('dead_unit_owed', 'standard')).toEqual(['close']);
    });

    it('the advance Dell path walks to closed through the dead-unit leg', () => {
      let s: RmaStatus = 'warranty_review';
      for (const a of ['approve_advance', 'receive_replacement', 'ship_dead_unit_to_vendor', 'confirm_vendor_receipt'] as const) {
        s = assertWarrantyTransition(s, a, 'advance_replacement').to;
      }
      expect(s).toBe('closed');
    });
  });
});
