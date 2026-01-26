import { describe, expect, it } from 'vitest';
import { parseEmailReplyBody } from '@alga-psa/shared/workflow/actions/emailWorkflowActions';

describe('Inbound email body parsing', () => {
  it('Body parsing: sanitizer returns non-empty text for plain-text emails', async () => {
    const parsed = await parseEmailReplyBody({ text: 'Hello from plain text email' });
    expect(typeof parsed?.sanitizedText).toBe('string');
    expect(parsed.sanitizedText.trim().length).toBeGreaterThan(0);
    expect(parsed.sanitizedText).toContain('Hello');
  });

  it('Body parsing: sanitizer returns HTML-derived content when HTML is present', async () => {
    const parsed = await parseEmailReplyBody({
      text: 'Fallback text',
      html: '<p>Hello from <strong>HTML</strong></p>',
    });
    expect(typeof parsed?.sanitizedHtml).toBe('string');
    expect(parsed.sanitizedHtml?.trim().length).toBeGreaterThan(0);
    expect(parsed.sanitizedHtml).toContain('<p>');
  });
});
