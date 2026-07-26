import { describe, expect, it } from 'vitest';

import { parseEmailReply } from '../replyParser';

describe('replyParser provider-header heuristics', () => {
  it('preserves header-like fields in an authored Ninja support request', () => {
    const text = `New support request from

First Name: Ada
Last Name: Example
Email: nick@example.com
Phone: 5550100
Subject: Test
Problem Description: Test Support ticket after update
Device: WORKSTATION-01
Ninja URL: https://example.rmmservice.com/#/deviceDashboard/38/overview
Device Role: WINDOWS_WORKSTATION
Organization: Example Office

Environment Variables
COMPUTERNAME: WORKSTATION-01
OS: Microsoft Windows 11 Pro Edition`;

    const result = parseEmailReply({ text });

    expect(result.strategy).toBe('fallback');
    expect(result.sanitizedText).toBe(text);
    expect(result.sanitizedText).toContain('Problem Description: Test Support ticket after update');
    expect(result.sanitizedText).toContain('OS: Microsoft Windows 11 Pro Edition');
  });

  it('trims a coherent Outlook quoted-message header block', () => {
    const result = parseEmailReply({
      text: `The restart fixed the issue. Thank you.

From: Alga Support <support@example.com>
Sent: Sunday, July 26, 2026 9:15 AM
To: Nick Green <nick@example.com>
Subject: Server offline

Previous ticket content that should not be copied.`,
    });

    expect(result.strategy).toBe('provider-header');
    expect(result.appliedHeuristics).toContain('provider-header');
    expect(result.sanitizedText).toBe('The restart fixed the issue. Thank you.');
  });
});
