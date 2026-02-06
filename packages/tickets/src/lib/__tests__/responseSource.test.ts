import { describe, expect, it } from 'vitest';
import {
  COMMENT_RESPONSE_SOURCES,
  type IComment,
} from '@alga-psa/types';
import {
  getCommentResponseSource,
  getLatestCustomerResponseSource,
} from '../responseSource';

function buildComment(overrides: Partial<IComment>): IComment {
  return {
    author_type: 'client',
    ...overrides,
  };
}

describe('ticket response source utility', () => {
  it('T005: returns inbound_email for latest explicit inbound source', () => {
    const result = getLatestCustomerResponseSource([
      buildComment({
        comment_id: 'c1',
        metadata: { responseSource: COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL },
      }),
      buildComment({
        comment_id: 'c2',
        metadata: { responseSource: COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL },
      }),
    ]);

    expect(result).toBe(COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL);
  });

  it('T006: returns client_portal for latest explicit client portal source', () => {
    const result = getLatestCustomerResponseSource([
      buildComment({
        comment_id: 'c1',
        metadata: { responseSource: COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL },
      }),
      buildComment({
        comment_id: 'c2',
        metadata: { responseSource: COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL },
      }),
    ]);

    expect(result).toBe(COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL);
  });

  it('T007: ignores internal comments when finding latest customer source', () => {
    const result = getLatestCustomerResponseSource([
      buildComment({
        comment_id: 'c1',
        metadata: { responseSource: COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL },
      }),
      buildComment({
        comment_id: 'c2',
        is_internal: true,
        metadata: { responseSource: COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL },
      }),
    ]);

    expect(result).toBe(COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL);
  });

  it('T008: falls back to inbound_email when metadata.email exists', () => {
    const source = getCommentResponseSource(
      buildComment({
        metadata: {
          email: {
            messageId: 'msg-1',
          },
        },
      })
    );

    expect(source).toBe(COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL);
  });

  it('T009: falls back to client_portal for client comment with user_id', () => {
    const source = getCommentResponseSource(
      buildComment({
        user_id: 'user-1',
      })
    );

    expect(source).toBe(COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL);
  });

  it('T010: returns null when no eligible customer comment source can be resolved', () => {
    const result = getLatestCustomerResponseSource([
      buildComment({
        comment_id: 'c1',
        is_internal: true,
        metadata: { responseSource: COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL },
      }),
      buildComment({
        comment_id: 'c2',
        author_type: 'unknown',
      }),
    ]);

    expect(result).toBeNull();
  });

  it('T024: chooses latest eligible source in legacy mixed comment streams', () => {
    const result = getLatestCustomerResponseSource([
      buildComment({
        comment_id: 'c1',
        metadata: { email: { messageId: 'legacy-email-1' } },
      }),
      buildComment({
        comment_id: 'c2',
        user_id: 'portal-user-1',
      }),
      buildComment({
        comment_id: 'c3',
        author_type: 'internal',
        is_internal: true,
        metadata: { responseSource: COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL },
      }),
      buildComment({
        comment_id: 'c4',
        metadata: { responseSource: COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL },
      }),
    ]);

    expect(result).toBe(COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL);
  });

  it('T016: handles legacy comments without metadata safely', () => {
    const result = getLatestCustomerResponseSource([
      buildComment({
        comment_id: 'c1',
      }),
    ]);

    expect(result).toBeNull();
  });
});
