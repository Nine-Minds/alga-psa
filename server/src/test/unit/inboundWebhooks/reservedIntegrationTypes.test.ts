import { describe, expect, it } from 'vitest';

import {
  RESERVED_INBOUND_WEBHOOK_INTEGRATION_TYPES,
  normalizeInboundWebhookIntegrationType,
  isReservedInboundWebhookIntegrationType,
  assertInboundWebhookSlugIsNotReserved,
} from '@/lib/inboundWebhooks/reservedIntegrationTypes';

describe('reserved inbound webhook integration types', () => {
  describe('normalizeInboundWebhookIntegrationType', () => {
    it('should trim whitespace and lowercase the value', () => {
      expect(normalizeInboundWebhookIntegrationType('  NinjaOne  ')).toBe('ninjaone');
      expect(normalizeInboundWebhookIntegrationType('QBO')).toBe('qbo');
    });
  });

  describe('isReservedInboundWebhookIntegrationType', () => {
    it('should flag every documented reserved type, regardless of casing', () => {
      for (const type of RESERVED_INBOUND_WEBHOOK_INTEGRATION_TYPES) {
        expect(isReservedInboundWebhookIntegrationType(type)).toBe(true);
        expect(isReservedInboundWebhookIntegrationType(type.toUpperCase())).toBe(true);
      }
    });

    it('should not flag tenant-defined integration types', () => {
      expect(isReservedInboundWebhookIntegrationType('my-custom-hook')).toBe(false);
      expect(isReservedInboundWebhookIntegrationType('rmm-alerts')).toBe(false);
      expect(isReservedInboundWebhookIntegrationType('')).toBe(false);
    });
  });

  describe('assertInboundWebhookSlugIsNotReserved', () => {
    it('should throw for slugs that collide with bundled integrations', () => {
      expect(() => assertInboundWebhookSlugIsNotReserved('xero')).toThrow(
        'Inbound webhook slug "xero" is reserved for a bundled integration',
      );
      expect(() => assertInboundWebhookSlugIsNotReserved(' TacticalRMM ')).toThrow(/reserved/);
    });

    it('should allow non-reserved slugs', () => {
      expect(() => assertInboundWebhookSlugIsNotReserved('billing-events')).not.toThrow();
    });
  });
});
