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
vi.mock('@alga-psa/tickets/lib/nativeTicketDataSource', async () => {
  const real = await vi.importActual<any>('@alga-psa/tickets/lib/ticketDataSource');
  return { nativeTicketDataSource: { kind: 'native', capabilities: real.NATIVE_TICKET_CAPABILITIES, screen: { backHref: '/msp/tickets' }, conversation: {}, comments: h.native } };
});
vi.mock('@/lib/actions/coManagedLocalTicketActions', () => ({ getCoManagedLocalTicketResourceAction: h.resource }));
vi.mock('@/components/co-managed/sharedConversationSession', () => ({ createSharedConversationSession: () => h.session }));

import { useTicketDataSource } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';
import { NATIVE_TICKET_CAPABILITIES, TICKET_WRITE_ACTION_CAPABILITIES, TICKET_SCREEN_FIELDS, resolveTicketFrozenFields } from '@alga-psa/tickets/lib/ticketDataSource';
import { CoManagedLocalTicketDataSourceProvider } from '@/components/co-managed/CoManagedLocalTicketDataSourceProvider';

let source: any;
function Probe() { source = useTicketDataSource(); return <span data-testid="audiences">{(source.conversation.audiences ?? []).join(',')}</span>; }

async function mount(readOnly = false) {
  h.resource.mockResolvedValue({ tenant: 'cust', relationshipId: 'r', kind: 'ticket', id: 'tk1' });
  h.session.load.mockResolvedValue(undefined);
  h.session.writeAudiences.mockReturnValue(['requester', 'shared_it', 'organization_private']);
  h.session.comments.mockReturnValue([{ comment_id: 's1', audience: 'shared_it', note: 'from MSP', created_at: '2026-01-02' }]);
  h.session.audienceOf.mockImplementation((id: string) => (id === 's1' ? 'shared_it' : undefined));
  h.session.write.mockResolvedValue({ comment_id: 'new' });
  h.native.findCommentsByTicketId.mockResolvedValue([{ comment_id: 'l1', audience: 'organization_private', created_at: '2026-01-01' }]);
  h.native.addTicketCommentWithCacheForCurrentUser.mockResolvedValue({ comment_id: 'native' });
  h.native.createComment.mockResolvedValue('native-reply');
  render(<CoManagedLocalTicketDataSourceProvider ticketId="tk1" readOnly={readOnly}><Probe /></CoManagedLocalTicketDataSourceProvider>);
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

  it('read-only: freezes the screen and removes every pure-write action, keeping the native screen fields', async () => {
    h.resource.mockResolvedValue(null);
    render(<CoManagedLocalTicketDataSourceProvider ticketId="tk1" readOnly><Probe /></CoManagedLocalTicketDataSourceProvider>);
    await waitFor(() => expect(h.resource).toHaveBeenCalled());
    expect(source.screen.readOnly).toBe(true);
    expect(source.screen.backHref).toBe('/msp/tickets');
    for (const key of TICKET_WRITE_ACTION_CAPABILITIES) expect(source.capabilities[key]).toBe(false);
    expect(resolveTicketFrozenFields(source.screen)).toEqual(expect.arrayContaining([...TICKET_SCREEN_FIELDS]));
    expect(screen.getByTestId('audiences')).toHaveTextContent('');
    // Display-only sections are untouched.
    expect(source.capabilities.documents).toBe(true);
  });

  it('writable: screen and capabilities are identical to native', async () => {
    await mount(false);
    expect(source.screen).toEqual({ backHref: '/msp/tickets' });
    expect(source.capabilities).toEqual(NATIVE_TICKET_CAPABILITIES);
  });

  it('read-only: the rendered surface offers no field edit and no delete / duplicate control', async () => {
    h.resource.mockResolvedValue(null);
    function Surface() {
      const ds = useTicketDataSource();
      const frozen = resolveTicketFrozenFields(ds.screen);
      return (
        <div>
          {!frozen.includes('title') && <input data-testid="edit-title" />}
          {ds.capabilities.delete && <button data-testid="delete">Delete</button>}
          {ds.capabilities.duplicate && <button data-testid="duplicate">Duplicate</button>}
        </div>
      );
    }
    render(<CoManagedLocalTicketDataSourceProvider ticketId="tk1" readOnly><Surface /></CoManagedLocalTicketDataSourceProvider>);
    await waitFor(() => expect(h.resource).toHaveBeenCalled());
    expect(screen.queryByTestId('edit-title')).toBeNull();
    expect(screen.queryByTestId('delete')).toBeNull();
    expect(screen.queryByTestId('duplicate')).toBeNull();
    cleanup();
    render(<CoManagedLocalTicketDataSourceProvider ticketId="tk1"><Surface /></CoManagedLocalTicketDataSourceProvider>);
    await waitFor(() => expect(screen.getByTestId('delete')).toBeInTheDocument());
    expect(screen.getByTestId('edit-title')).toBeInTheDocument();
  });
});
