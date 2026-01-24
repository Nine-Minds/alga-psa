import { describe, expect, it } from 'vitest';
import { parseEmailReplyBody } from '@alga-psa/shared/workflow/actions/emailWorkflowActions';

describe('Inbound email body parsing', () => {
  it('Body parsing: sanitizer returns non-empty text for plain-text emails', async () => {
    const parsed = await parseEmailReplyBody({ text: 'Hello from plain text email' });
    expect(typeof parsed?.sanitizedText).toBe('string');
    expect(parsed.sanitizedText.trim().length).toBeGreaterThan(0);
    expect(parsed.sanitizedText).toContain('Hello');
  });
});

