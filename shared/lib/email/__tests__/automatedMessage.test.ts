import { describe, expect, it } from 'vitest';

import {
  AUTO_GENERATED_MAIL_HEADERS,
  detectAutomatedInboundMessage,
  extractRelevantInboundHeaders,
} from '../automatedMessage';

function withHeaders(headers: Record<string, string>) {
  return { headers };
}

describe('detectAutomatedInboundMessage', () => {
  it('treats a genuine human reply as not automated', () => {
    const result = detectAutomatedInboundMessage(
      withHeaders({
        'From': 'person@example.com',
        'Subject': 'Re: Ticket Closed',
        'Auto-Submitted': 'no',
      })
    );
    expect(result.isAutomated).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('returns not automated when no headers are present', () => {
    expect(detectAutomatedInboundMessage({ headers: undefined }).isAutomated).toBe(false);
    expect(detectAutomatedInboundMessage({}).isAutomated).toBe(false);
  });

  it('flags RFC 3834 Auto-Submitted: auto-replied (case-insensitive, with comment)', () => {
    const result = detectAutomatedInboundMessage(withHeaders({ 'auto-submitted': 'Auto-Replied (vacation)' }));
    expect(result.isAutomated).toBe(true);
    expect(result.reason).toBe('auto-submitted');
  });

  it('flags Auto-Submitted: auto-generated', () => {
    expect(detectAutomatedInboundMessage(withHeaders({ 'Auto-Submitted': 'auto-generated' })).reason).toBe(
      'auto-submitted'
    );
  });

  it('flags a null reverse-path (RFC 5321 bounce)', () => {
    expect(detectAutomatedInboundMessage(withHeaders({ 'Return-Path': '<>' })).reason).toBe('null-return-path');
    expect(detectAutomatedInboundMessage(withHeaders({ 'Return-Path': '< >' })).reason).toBe('null-return-path');
  });

  it('does not flag a normal return-path', () => {
    expect(
      detectAutomatedInboundMessage(withHeaders({ 'Return-Path': '<sender@example.com>' })).isAutomated
    ).toBe(false);
  });

  it('flags a delivery-status report (DSN)', () => {
    expect(
      detectAutomatedInboundMessage(
        withHeaders({ 'Content-Type': 'multipart/report; report-type=delivery-status; boundary="x"' })
      ).reason
    ).toBe('delivery-status-report');
  });

  it('flags list mail via any List-* header (RFC 2919/2369)', () => {
    expect(detectAutomatedInboundMessage(withHeaders({ 'List-Id': '<list.example.com>' })).reason).toBe(
      'list-header'
    );
    expect(
      detectAutomatedInboundMessage(withHeaders({ 'List-Unsubscribe': '<mailto:x@example.com>' })).reason
    ).toBe('list-header');
  });

  it('flags Precedence bulk/junk/auto-reply', () => {
    expect(detectAutomatedInboundMessage(withHeaders({ Precedence: 'bulk' })).reason).toBe('precedence-bulk');
    expect(detectAutomatedInboundMessage(withHeaders({ Precedence: 'auto_reply' })).reason).toBe('precedence-bulk');
  });

  it('does not flag Precedence: list-less normal mail', () => {
    expect(detectAutomatedInboundMessage(withHeaders({ Precedence: 'normal' })).isAutomated).toBe(false);
  });

  it('flags Microsoft X-Auto-Response-Suppress and X-Autoreply', () => {
    expect(
      detectAutomatedInboundMessage(withHeaders({ 'X-Auto-Response-Suppress': 'All' })).reason
    ).toBe('x-auto-response-suppress');
    expect(detectAutomatedInboundMessage(withHeaders({ 'X-Autoreply': 'yes' })).reason).toBe('x-autoreply');
  });
});

describe('extractRelevantInboundHeaders', () => {
  it('projects only standards-relevant headers with lower-cased keys', () => {
    const out = extractRelevantInboundHeaders(
      withHeaders({
        'Auto-Submitted': 'auto-replied',
        'Subject': 'irrelevant',
        'X-Mailer': 'irrelevant',
        'List-Id': '<l.example.com>',
      })
    );
    expect(out).toEqual({ 'auto-submitted': 'auto-replied', 'list-id': '<l.example.com>' });
  });

  it('returns an empty object when no relevant headers exist', () => {
    expect(extractRelevantInboundHeaders(withHeaders({ Subject: 'hi' }))).toEqual({});
    expect(extractRelevantInboundHeaders({ headers: undefined })).toEqual({});
  });
});

describe('AUTO_GENERATED_MAIL_HEADERS', () => {
  it('marks outbound mail as auto-generated per RFC 3834', () => {
    expect(AUTO_GENERATED_MAIL_HEADERS['Auto-Submitted']).toBe('auto-generated');
    expect(AUTO_GENERATED_MAIL_HEADERS['X-Auto-Response-Suppress']).toContain('AutoReply');
  });
});
