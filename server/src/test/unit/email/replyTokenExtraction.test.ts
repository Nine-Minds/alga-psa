import { describe, it, expect } from 'vitest';
import { parseEmailReply } from '@alga-psa/shared/lib/email/replyParser';

describe('Email Reply Token Extraction', () => {
  describe('HTML Token Extraction', () => {
    it('should extract reply token from HTML data attributes', () => {
      const html = `
        <div data-alga-reply-token="test-token-123" data-alga-ticket-id="TICKET-456" style="display:none;max-height:0;overflow:hidden;">[ALGA-REPLY-TOKEN test-token-123 ticketId=TICKET-456]</div>
        <div data-alga-reply-boundary="true" style="display:none;max-height:0;overflow:hidden;">--- Please reply above this line ---</div>
        <p style="margin:0 0 12px 0;color:#666;text-transform:uppercase;font-size:12px;letter-spacing:0.08em;">--- Please reply above this line ---</p>
        <div>This is the user's actual reply content</div>
        <div>Original notification content...</div>
      `;

      const text = `
This is the user's actual reply content

--- Please reply above this line ---

[ALGA-REPLY-TOKEN test-token-123 ticketId=TICKET-456]
ALGA-TICKET-ID:TICKET-456
      `.trim();

      const result = parseEmailReply({ text, html });

      expect(result).toBeDefined();
      expect(result.tokens).toBeDefined();
      expect(result.tokens?.conversationToken).toBe('test-token-123');
      expect(result.tokens?.ticketId).toBe('TICKET-456');
      expect(result.sanitizedText).toContain('This is the user\'s actual reply content');
      expect(result.sanitizedText).not.toContain('ALGA-REPLY-TOKEN');
    });

    it('should extract token with comment ID', () => {
      const html = `
        <div data-alga-reply-token="token-789" data-alga-ticket-id="TICKET-100" data-alga-comment-id="COMMENT-200" style="display:none;">[ALGA-REPLY-TOKEN token-789 ticketId=TICKET-100 commentId=COMMENT-200]</div>
        <div data-alga-reply-boundary="true" style="display:none;">--- Please reply above this line ---</div>
        <p>--- Please reply above this line ---</p>
        <div>Reply to specific comment</div>
      `;

      const text = `Reply to specific comment

--- Please reply above this line ---

[ALGA-REPLY-TOKEN token-789 ticketId=TICKET-100 commentId=COMMENT-200]
ALGA-TICKET-ID:TICKET-100
ALGA-COMMENT-ID:COMMENT-200`;

      const result = parseEmailReply({ text, html });

      expect(result).toBeDefined();
      expect(result.tokens?.conversationToken).toBe('token-789');
      expect(result.tokens?.ticketId).toBe('TICKET-100');
      expect(result.tokens?.commentId).toBe('COMMENT-200');
    });

    it('should extract token with thread ID', () => {
      const html = `
        <div data-alga-reply-token="thread-token" data-alga-thread-id="THREAD-999" style="display:none;">[ALGA-REPLY-TOKEN thread-token threadId=THREAD-999]</div>
        <div>Thread reply content</div>
      `;

      const text = `Thread reply content

[ALGA-REPLY-TOKEN thread-token threadId=THREAD-999]
ALGA-THREAD-ID:THREAD-999`;

      const result = parseEmailReply({ text, html });

      expect(result).toBeDefined();
      expect(result.tokens?.conversationToken).toBe('thread-token');
      expect(result.tokens?.threadId).toBe('THREAD-999');
    });

    it('should extract token with project ID', () => {
      const html = `
        <div data-alga-reply-token="proj-token" data-alga-project-id="PROJECT-777" style="display:none;">[ALGA-REPLY-TOKEN proj-token projectId=PROJECT-777]</div>
        <div>Project update</div>
      `;

      const text = `Project update

[ALGA-REPLY-TOKEN proj-token projectId=PROJECT-777]
ALGA-PROJECT-ID:PROJECT-777`;

      const result = parseEmailReply({ text, html });

      expect(result).toBeDefined();
      expect(result.tokens?.conversationToken).toBe('proj-token');
      expect(result.tokens?.projectId).toBe('PROJECT-777');
    });
  });

  describe('Text-Only Token Extraction', () => {
    it('should extract reply token from plain text emails', () => {
      const text = `This is the user's reply.

--- Please reply above this line ---

[ALGA-REPLY-TOKEN plain-text-token ticketId=TICKET-999]
ALGA-TICKET-ID:TICKET-999

Original message below...`;

      const result = parseEmailReply({ text });

      expect(result).toBeDefined();
      expect(result.tokens).toBeDefined();
      expect(result.tokens?.conversationToken).toBe('plain-text-token');
      expect(result.tokens?.ticketId).toBe('TICKET-999');
      expect(result.sanitizedText).toContain('This is the user\'s reply');
      expect(result.sanitizedText).not.toContain('ALGA-REPLY-TOKEN');
      expect(result.sanitizedText).not.toContain('ALGA-TICKET-ID');
    });

    it('should handle token with all metadata fields in text', () => {
      const ticketId = '00000000-0000-0000-0000-000000000001';
      const commentId = '00000000-0000-0000-0000-000000000002';
      const threadId = '00000000-0000-0000-0000-000000000003';
      const projectId = '00000000-0000-0000-0000-000000000004';

      const text = `Complete reply

--- Please reply above this line ---

[ALGA-REPLY-TOKEN full-token ticketId=${ticketId} projectId=${projectId} commentId=${commentId} threadId=${threadId}]
ALGA-TICKET-ID:${ticketId}
ALGA-COMMENT-ID:${commentId}
ALGA-THREAD-ID:${threadId}
ALGA-PROJECT-ID:${projectId}`;

      const result = parseEmailReply({ text });

      expect(result).toBeDefined();
      expect(result.tokens?.conversationToken).toBe('full-token');
      expect(result.tokens?.ticketId).toBe(ticketId);
      expect(result.tokens?.commentId).toBe(commentId);
      expect(result.tokens?.threadId).toBe(threadId);
      expect(result.tokens?.projectId).toBe(projectId);
    });
  });

  describe('Token Sanitization', () => {
    it('should remove all token artifacts from sanitized content', () => {
      const text = `User's actual message here

--- Please reply above this line ---

[ALGA-REPLY-TOKEN sanitize-test ticketId=TICKET-CLEAN]
ALGA-TICKET-ID:TICKET-CLEAN

Old conversation...`;

      const result = parseEmailReply({ text });

      expect(result).toBeDefined();
      const sanitized = result.sanitizedText;

      // Should contain the actual reply
      expect(sanitized).toContain('User\'s actual message here');

      // Should not contain any token artifacts
      expect(sanitized).not.toContain('ALGA-REPLY-TOKEN');
      expect(sanitized).not.toContain('ALGA-TICKET-ID');
      expect(sanitized).not.toContain('[ALGA-REPLY-TOKEN');
      expect(sanitized).not.toContain('ticketId=');

      // Should not contain the delimiter in the user-facing content
      expect(sanitized).not.toContain('Please reply above this line');
    });
  });

  describe('Edge Cases', () => {
    it('should handle email with no token gracefully', () => {
      const text = 'Just a regular email with no special markers.';

      const result = parseEmailReply({ text });

      expect(result).toBeDefined();
      expect(result.tokens).toBeNull();
      expect(result.sanitizedText).toBe(text);
    });

    it('should handle malformed token gracefully', () => {
      const text = `User reply

[ALGA-REPLY-TOKEN-MALFORMED no-proper-format]

Old content`;

      const result = parseEmailReply({ text });

      expect(result).toBeDefined();
      // Should still parse but may not extract token
      expect(result.sanitizedText).toBeDefined();
    });

    it('should handle Gmail-style top posting with token', () => {
      const html = `<div dir="ltr">This is my reply at the top</div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Mon, Dec 9, 2024 at 10:30 AM Support &lt;support@example.com&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"><div data-alga-reply-token="gmail-token" data-alga-ticket-id="TICKET-GMAIL" style="display:none;">[ALGA-REPLY-TOKEN gmail-token ticketId=TICKET-GMAIL]</div><div>Original message</div></blockquote></div>`;

      const text = `This is my reply at the top

On Mon, Dec 9, 2024 at 10:30 AM Support <support@example.com> wrote:

[ALGA-REPLY-TOKEN gmail-token ticketId=TICKET-GMAIL]
ALGA-TICKET-ID:TICKET-GMAIL

Original message`;

      const result = parseEmailReply({ text, html });

      expect(result).toBeDefined();
      expect(result.tokens).toBeDefined();
      expect(result.tokens?.conversationToken).toBe('gmail-token');
      expect(result.tokens?.ticketId).toBe('TICKET-GMAIL');
      expect(result.sanitizedText).toContain('This is my reply at the top');
      // Gmail quote should be removed by the quoted-block strategy
      expect(result.confidence).toBeTruthy();
    });
  });
});