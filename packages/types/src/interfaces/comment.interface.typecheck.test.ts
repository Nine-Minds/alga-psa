import { describe, expect, it } from 'vitest';
import type { IComment } from './comment.interface';

describe('IComment metadata typing', () => {
  it('T004: accepts metadata and normalized response source fields', () => {
    const comment: IComment = {
      comment_id: 'comment-1',
      author_type: 'client',
      metadata: {
        responseSource: 'client_portal',
        email: {
          provider: 'google',
          messageId: 'message-1',
        },
        parser: {
          confidence: 'high',
        },
      },
      response_source: 'inbound_email',
    };

    expect(comment.metadata?.responseSource).toBe('client_portal');
    expect(comment.response_source).toBe('inbound_email');
  });
});
