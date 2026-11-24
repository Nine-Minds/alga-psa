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

  it('trims a Gmail attribution wrapped over two lines', () => {
    const result = parseEmailReply({
      text: `Thursday afternoon works for us.

On Mon, Nov 17, 2026 at 8:42 AM Jane Client <
jane.client@example.test> wrote:

> Tell us what you need from our side before the install day.
> The laptops are still sealed in their shipping boxes.`,
    });

    expect(result.appliedHeuristics).toContain('provider-header');
    expect(result.sanitizedText).toBe('Thursday afternoon works for us.');
  });

  it('keeps authored text that introduces a quote of its own', () => {
    // The wrapped-attribution heuristic looks for the address Gmail wraps on and the previous
    // message below it. An author who writes "On Friday … He wrote:" above one quoted line has
    // neither, and the text after their quote is theirs to keep.
    const result = parseEmailReply({
      text: `Here is the update you asked for.

On Friday I spoke to the vendor.
He wrote:
> We ship Monday.

Please confirm the Wednesday install.`,
    });

    expect(result.sanitizedText).toContain('Here is the update you asked for.');
    expect(result.sanitizedText).toContain('On Friday I spoke to the vendor.');
    expect(result.sanitizedText).toContain('Please confirm the Wednesday install.');
  });
});
