import { describe, expect, it } from 'vitest';
import { COMMENT_RESPONSE_SOURCES, type CommentMetadata } from '@alga-psa/types';
import {
  formatCommentMetadataJson,
  hasAdminSettingsViewAccess,
  isNonEmptyCommentMetadata,
  summarizeCommentMetadataForDebug,
} from './commentMetadataDebug';

describe('commentMetadataDebug', () => {
  describe('hasAdminSettingsViewAccess', () => {
    it('returns true when settings:read is present', () => {
      expect(hasAdminSettingsViewAccess(['ticket:read', 'settings:read'])).toBe(true);
    });

    it('returns true when settings:update is present', () => {
      expect(hasAdminSettingsViewAccess(['settings:update'])).toBe(true);
    });

    it('returns false when neither portal settings permission is present', () => {
      expect(hasAdminSettingsViewAccess(['ticket:read', 'system_settings:read'])).toBe(false);
    });
  });

  describe('isNonEmptyCommentMetadata', () => {
    it('returns false for null, undefined, or empty object', () => {
      expect(isNonEmptyCommentMetadata(null)).toBe(false);
      expect(isNonEmptyCommentMetadata(undefined)).toBe(false);
      expect(isNonEmptyCommentMetadata({})).toBe(false);
    });

    it('returns true when at least one key is present', () => {
      expect(isNonEmptyCommentMetadata({ a: 1 })).toBe(true);
    });
  });

  describe('summarizeCommentMetadataForDebug', () => {
    it('returns ordered inbound-email debug rows from representative metadata', () => {
      const metadata: CommentMetadata = {
        responseSource: COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL,
        email: {
          provider: 'google',
          messageId: '<mid@host>',
          inReplyTo: '<prev@host>',
          references: ['<a>', '<b>'],
          threadId: 'thread-1',
          fromAddress: 'user@example.com',
        },
        inboundReopenDecision: {
          action: 'reopen',
          cutoffExceeded: false,
          reopenTargetSource: 'email_headers',
          aiSuppression: { decision: 'allow' },
        },
      };

      const rows = summarizeCommentMetadataForDebug(metadata);

      expect(rows.map((r) => r.label)).toEqual([
        'responseSource',
        'email.provider',
        'email.messageId',
        'email.inReplyTo',
        'email.references',
        'email.threadId',
        'email.fromAddress',
        'inboundReopenDecision.action',
        'inboundReopenDecision.cutoffExceeded',
        'inboundReopenDecision.reopenTargetSource',
        'inboundReopenDecision.aiSuppression.decision',
      ]);

      expect(rows[0].value).toBe('inbound_email');
      expect(rows[1].value).toBe('google');
      expect(rows[4].value).toBe('["<a>","<b>"]');
      expect(rows[10].value).toBe('allow');
    });

    it('omits missing paths without throwing', () => {
      const rows = summarizeCommentMetadataForDebug({
        responseSource: COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL,
        email: { provider: 'microsoft' },
      });

      expect(rows.map((r) => r.label)).toEqual(['responseSource', 'email.provider']);
      expect(rows.find((r) => r.label === 'email.messageId')).toBeUndefined();
    });
  });

  describe('formatCommentMetadataJson', () => {
    it('pretty-prints JSON for the raw block', () => {
      const json = formatCommentMetadataJson({ a: 1, b: { c: true } });
      expect(json).toContain('\n');
      expect(json).toContain('"a": 1');
    });
  });
});
