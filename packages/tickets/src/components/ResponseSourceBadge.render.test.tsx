import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IComment } from '@alga-psa/types';
import { COMMENT_RESPONSE_SOURCES } from '@alga-psa/types';
import ResponseSourceBadge from './ResponseSourceBadge';
import { getLatestCustomerResponseSource } from '../lib/responseSource';

const labels = {
  clientPortal: 'Received via Client Portal',
  inboundEmail: 'Received via Inbound Email',
};

function renderIndicatorForConversations(conversations: IComment[]): string {
  const source = getLatestCustomerResponseSource(conversations);
  if (!source) {
    return '';
  }

  return renderToStaticMarkup(
    <ResponseSourceBadge source={source} labels={labels} />
  );
}

describe('response source indicator rendering contract', () => {
  it('T011: MSP TicketDetails label contract renders for client_portal source', () => {
    const html = renderIndicatorForConversations([
      {
        author_type: 'client',
        metadata: { responseSource: COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL },
      } as IComment,
    ]);

    expect(html).toContain('Received via Client Portal');
  });

  it('T012: MSP TicketDetails label contract renders for inbound_email source', () => {
    const html = renderIndicatorForConversations([
      {
        author_type: 'client',
        metadata: { responseSource: COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL },
      } as IComment,
    ]);

    expect(html).toContain('Received via Inbound Email');
  });

  it('T013: Client Portal TicketDetails label contract renders for client_portal source', () => {
    const html = renderIndicatorForConversations([
      {
        author_type: 'client',
        user_id: 'portal-user-1',
      } as IComment,
    ]);

    expect(html).toContain('Received via Client Portal');
  });

  it('T014: Client Portal TicketDetails label contract renders for inbound_email source', () => {
    const html = renderIndicatorForConversations([
      {
        author_type: 'client',
        metadata: { email: { messageId: 'legacy-email' } },
      } as IComment,
    ]);

    expect(html).toContain('Received via Inbound Email');
  });

  it('T015: both surfaces hide source indicator when source is unresolved', () => {
    const html = renderIndicatorForConversations([
      {
        author_type: 'internal',
        is_internal: true,
      } as IComment,
    ]);

    expect(html).toBe('');
  });

  it('T021: source indicator updates to client_portal after new portal comment', () => {
    const conversations: IComment[] = [];
    const initial = renderIndicatorForConversations(conversations);
    expect(initial).toBe('');

    conversations.push({
      author_type: 'client',
      user_id: 'portal-user-2',
    } as IComment);

    const updated = renderIndicatorForConversations(conversations);
    expect(updated).toContain('Received via Client Portal');
  });

  it('T022: source indicator updates to inbound_email after inbound reply refresh', () => {
    const conversations: IComment[] = [];
    const initial = renderIndicatorForConversations(conversations);
    expect(initial).toBe('');

    conversations.push({
      author_type: 'client',
      metadata: {
        responseSource: COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL,
      },
    } as IComment);

    const updated = renderIndicatorForConversations(conversations);
    expect(updated).toContain('Received via Inbound Email');
  });
});
