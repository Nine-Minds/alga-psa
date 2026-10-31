/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: { findCommentsByTicketId: vi.fn(), createComment: vi.fn(), addTicketCommentWithCache: vi.fn(), addTicketCommentWithCacheForCurrentUser: vi.fn() },
  session: { load: vi.fn(), comments: vi.fn(), writeAudiences: vi.fn(), write: vi.fn(), audienceOf: vi.fn() },
  resource: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_k: string, o?: any) => o?.defaultValue ?? _k }) }));
vi.mock('@alga-psa/tickets/lib/nativeTicketDataSource', () => ({ nativeTicketDataSource: { kind: 'native', conversation: {}, comments: h.native } }));
vi.mock('@/lib/actions/coManagedLocalTicketActions', () => ({ getCoManagedLocalTicketResourceAction: h.resource }));
vi.mock('@/components/co-managed/sharedConversationSession', () => ({ createSharedConversationSession: () => h.session }));

import { useTicketDataSource } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';
import { CoManagedLocalTicketDataSourceProvider } from '@/components/co-managed/CoManagedLocalTicketDataSourceProvider';

let source: any;
function Probe() { source = useTicketDataSource(); return <span data-testid="audiences">{(source.conversation.audiences ?? []).join(',')}</span>; }

async function mount() {
  h.resource.mockResolvedValue({ tenant: 'cust', relationshipId: 'r', kind: 'ticket', id: 'tk1' });
  h.session.load.mockResolvedValue(undefined);
  h.session.writeAudiences.mockReturnValue(['requester', 'shared_it', 'organization_private']);
  h.session.comments.mockReturnValue([{ comment_id: 's1', audience: 'shared_it', note: 'from MSP', created_at: '2026-01-02' }]);
  h.session.audienceOf.mockImplementation((id: string) => (id === 's1' ? 'shared_it' : undefined));
  h.session.write.mockResolvedValue({ comment_id: 'new' });
  h.native.findCommentsByTicketId.mockResolvedValue([{ comment_id: 'l1', audience: 'organization_private', created_at: '2026-01-01' }]);
  h.native.addTicketCommentWithCacheForCurrentUser.mockResolvedValue({ comment_id: 'native' });
  h.native.createComment.mockResolvedValue('native-reply');
  render(<CoManagedLocalTicketDataSourceProvider ticketId="tk1"><Probe /></CoManagedLocalTicketDataSourceProvider>);
  await waitFor(() => expect(screen.getByTestId('audiences')).toHaveTextContent('requester,organization_private,shared_it'));
}

describe('CoManagedLocalTicketDataSourceProvider', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());
  it('starts native-audience only and upgrades to the server-resolved audiences with the editor restricted', async () => {
    await mount();
    expect(source.conversation.editor).toEqual({ disallowImages: true, disallowFiles: true, disallowMentions: true });
  });

  it('loads the shared thread alongside local comments', async () => {
    await mount();
    const comments = await source.comments.findCommentsByTicketId('tk1');
    expect(comments.map((c: any) => c.comment_id)).toEqual(['l1', 's1']);
  });

  it('posts Shared IT through the writer and requester / organization_private natively', async () => {
    await mount();
    await source.comments.addTicketCommentWithCacheForCurrentUser('tk1', 'hi', true, false, false, undefined, undefined, undefined, 'shared_it');
    expect(h.session.write).toHaveBeenCalledWith({ content: 'hi', audience: 'shared_it' });
    expect(h.native.addTicketCommentWithCacheForCurrentUser).not.toHaveBeenCalled();

    await source.comments.addTicketCommentWithCacheForCurrentUser('tk1', 'hi', false, false, false, undefined, undefined, undefined, 'requester');
    await source.comments.addTicketCommentWithCacheForCurrentUser('tk1', 'hi', true, false, false, undefined, undefined, undefined, 'organization_private');
    expect(h.native.addTicketCommentWithCacheForCurrentUser).toHaveBeenCalledTimes(2);
    expect(h.session.write).toHaveBeenCalledTimes(1);
  });

  it('routes a reply into a shared thread through the writer, a local reply natively', async () => {
    await mount();
    await source.comments.createComment({ note: 'r', parent_comment_id: 's1' });
    expect(h.session.write).toHaveBeenCalledWith({ content: 'r', audience: 'shared_it', parentCommentId: 's1' });
    await source.comments.createComment({ note: 'r2', parent_comment_id: 'l1', collaboration_audience: 'organization_private' });
    expect(h.native.createComment).toHaveBeenCalledTimes(1);
  });

  it('keeps native audiences when the workspace has no relationship', async () => {
    h.resource.mockResolvedValue(null);
    render(<CoManagedLocalTicketDataSourceProvider ticketId="tk1"><Probe /></CoManagedLocalTicketDataSourceProvider>);
    await waitFor(() => expect(h.resource).toHaveBeenCalled());
    expect(screen.getByTestId('audiences')).toHaveTextContent('requester,organization_private');
    expect(screen.getByTestId('audiences')).not.toHaveTextContent('shared_it');
  });
});
