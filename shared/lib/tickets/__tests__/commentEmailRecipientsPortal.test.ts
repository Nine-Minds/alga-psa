import { describe, expect, it } from 'vitest';
import {
  readCommentEmailRecipients,
  stripCommentBccFromMetadata,
} from '../commentEmailRecipientsCore';

describe('stripCommentBccFromMetadata', () => {
  it('T060: drops bcc while keeping cc and the other metadata keys', () => {
    const stripped = stripCommentBccFromMetadata({
      responseSource: 'client_portal',
      email_recipients: {
        cc: [{ email: 'jane@client.com', name: 'Jane Doe' }],
        bcc: [{ email: 'boss@msp.test' }],
      },
    });

    expect(JSON.stringify(stripped)).not.toContain('boss@msp.test');
    expect(readCommentEmailRecipients(stripped)).toEqual({
      cc: [{ email: 'jane@client.com', name: 'Jane Doe' }],
      bcc: [],
    });
    expect((stripped as Record<string, unknown>).responseSource).toBe('client_portal');
  });

  it('T060: a jsonb string is returned as a stripped object, never the original text', () => {
    const stripped = stripCommentBccFromMetadata(JSON.stringify({
      email_recipients: { cc: [], bcc: [{ email: 'boss@msp.test' }] },
    }));
    expect(typeof stripped).toBe('object');
    expect(JSON.stringify(stripped)).not.toContain('boss@msp.test');
  });

  it('T060: metadata without email_recipients is passed through untouched', () => {
    const metadata = { closes_ticket: true };
    expect(stripCommentBccFromMetadata(metadata)).toBe(metadata);
    expect(stripCommentBccFromMetadata(null)).toBeNull();
  });
});
