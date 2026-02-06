import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IComment } from '@alga-psa/types';
import { COMMENT_RESPONSE_SOURCES } from '@alga-psa/types';
import ResponseSourceBadge from './ResponseSourceBadge';
import { getCommentResponseSource } from '../lib/responseSource';

const labels = {
  clientPortal: 'Received via Client Portal',
  inboundEmail: 'Received via Inbound Email',
};

function renderIndicatorForComment(comment: IComment): string {
  const source = getCommentResponseSource(comment);
  if (!source) {
    return '';
  }

  return renderToStaticMarkup(
    <ResponseSourceBadge source={source} labels={labels} />
  );
}

describe('per-comment response source badge rendering contract', () => {
  it('T011: renders client_portal badge on a portal-sourced comment', () => {
    const html = renderIndicatorForComment({
      author_type: 'client',
      metadata: { responseSource: COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL },
    } as IComment);

    expect(html).toContain('Received via Client Portal');
  });

  it('T012: renders inbound_email badge on an email-sourced comment', () => {
    const html = renderIndicatorForComment({
      author_type: 'client',
      metadata: { responseSource: COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL },
    } as IComment);

    expect(html).toContain('Received via Inbound Email');
  });

  it('T013: renders client_portal badge via legacy fallback (client with user_id)', () => {
    const html = renderIndicatorForComment({
      author_type: 'client',
      user_id: 'portal-user-1',
    } as IComment);

    expect(html).toContain('Received via Client Portal');
  });

  it('T014: renders inbound_email badge via legacy fallback (metadata.email present)', () => {
    const html = renderIndicatorForComment({
      author_type: 'client',
      metadata: { email: { messageId: 'legacy-email' } },
    } as IComment);

    expect(html).toContain('Received via Inbound Email');
  });

  it('T015: hides badge when source is unresolved (internal comment)', () => {
    const html = renderIndicatorForComment({
      author_type: 'internal',
      is_internal: true,
    } as IComment);

    expect(html).toBe('');
  });

  it('T021: new portal comment renders client_portal badge immediately', () => {
    const comment = {
      author_type: 'client',
      user_id: 'portal-user-2',
    } as IComment;

    const html = renderIndicatorForComment(comment);
    expect(html).toContain('Received via Client Portal');
  });

  it('T022: new inbound email comment renders inbound_email badge immediately', () => {
    const comment = {
      author_type: 'client',
      metadata: {
        responseSource: COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL,
      },
    } as IComment;

    const html = renderIndicatorForComment(comment);
    expect(html).toContain('Received via Inbound Email');
  });
});
