import { describe, expect, it } from 'vitest';
import type { CommentAuthorship, IComment } from './comment.interface';

describe('IComment metadata typing', () => {
  it('T001: models contact-only authorship without user linkage', () => {
    const authorship: CommentAuthorship = {
      author_type: 'contact',
      user_id: null,
      contact_id: 'contact-1',
    };

    expect(authorship.author_type).toBe('contact');
    expect(authorship.user_id).toBeNull();
    expect(authorship.contact_id).toBe('contact-1');
  });

  it('T004: accepts metadata and normalized response source fields', () => {
    const comment: IComment = {
      comment_id: 'comment-1',
      author_type: 'client',
      user_id: null,
      contact_id: 'contact-1',
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
