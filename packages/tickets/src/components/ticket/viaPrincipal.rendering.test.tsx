/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * T033: ticket activity and time-entry detail render "<human> via <principal>", and a
 * service-authored comment renders the Service badge. CE resolves @enterprise/* to render-nothing
 * stubs, so the EE components are mounted here via vi.mock to exercise the real slots.
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IComment, TicketTimeEntriesSummary } from '@alga-psa/types';
import CommentItem from './CommentItem';
import TicketActivityTimeline from './TicketActivityTimeline';
import TicketTimeEntries from './TicketTimeEntries';

const m = vi.hoisted(() => ({ fetchTimeEntriesForTicket: vi.fn(), getTimeline: vi.fn() }));

vi.mock('@enterprise/components/service-principals/ViaPrincipalLabel', () => import('../../../../../ee/server/src/components/service-principals/ViaPrincipalLabel'));
vi.mock('@enterprise/components/service-principals/ServiceAuthorBadge', () => import('../../../../../ee/server/src/components/service-principals/ServiceAuthorBadge'));

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
  TextEditor: () => <div data-testid="text-editor" />,
}));
vi.mock('@alga-psa/ui/components/ReactionDisplay', () => ({ ReactionDisplay: () => <div /> }));
vi.mock('@alga-psa/user-composition/actions', () => ({ searchUsersForMentions: vi.fn() }));
vi.mock('@alga-psa/ui/context', () => ({
  useSchedulingCallbacks: () => ({ fetchTimeEntriesForTicket: m.fetchTimeEntriesForTicket }),
}));
vi.mock('@alga-psa/ui/components', () => ({ useContentCardVariant: () => 'default' }));
vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ 'data-testid': id }),
}));
vi.mock('../../actions/ticketActivityActions', () => ({ getTicketTimelineEntries: m.getTimeline }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const fill = (text: string, values?: Record<string, unknown>) =>
    text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(values?.[name] ?? ''));
  return {
    useFormatters: () => ({
      locale: 'en',
      dateFormat: 'MM/DD/YYYY',
      formatDate: (d: Date | string) => String(d),
      formatNumber: (v: number) => String(v),
      formatCurrency: (v: number) => String(v),
      formatRelativeTime: (d: Date | string) => String(d),
    }),
    useTranslation: () => ({
      t: (key: string, second?: string | Record<string, unknown>, third?: Record<string, unknown>) => {
        if (typeof second === 'string') return fill(second, third);
        return fill((second?.defaultValue as string | undefined) ?? key, second);
      },
    }),
  };
});

afterEach(cleanup);

describe('T033 time entry detail', () => {
  beforeEach(() => {
    const summary: TicketTimeEntriesSummary = {
      entries: [
        {
          entry_id: 'e1',
          user_id: 'user-other',
          user_name: 'Ada Admin',
          via_principal_name: 'Billing sync',
          start_time: '2026-09-21T10:00:00.000Z',
          end_time: '2026-09-21T10:30:00.000Z',
          work_date: '2026-09-21',
          billable_duration: 30,
          notes: null,
          approval_status: 'DRAFT',
          service_id: null,
          service_name: null,
          is_own: false,
        },
        {
          entry_id: 'e2',
          user_id: 'user-human',
          user_name: 'Grace Hopper',
          start_time: '2026-09-21T11:00:00.000Z',
          end_time: '2026-09-21T11:30:00.000Z',
          work_date: '2026-09-21',
          billable_duration: 30,
          notes: null,
          approval_status: 'DRAFT',
          service_id: null,
          service_name: null,
          is_own: false,
        },
      ],
      ownTotalMinutes: 0,
      ownEntryCount: 0,
      othersTotalMinutes: 60,
      othersEntryCount: 2,
      othersVisibleMinutes: 60,
      othersVisibleCount: 2,
      othersHiddenMinutes: 0,
      othersHiddenCount: 0,
      totalMinutes: 60,
    } as TicketTimeEntriesSummary;
    m.fetchTimeEntriesForTicket.mockResolvedValue(summary);
  });

  it('renders "<human> via <principal>" only for entries made through a principal', async () => {
    render(<TicketTimeEntries id="tte" ticketId="t1" currentUserId="me" />);
    const via = await screen.findAllByTestId('via-principal-label');
    expect(via).toHaveLength(1);
    expect(via[0].textContent).toBe('via Billing sync');
    expect(via[0].parentElement?.textContent).toContain('Ada Admin');
  });
});

describe('T033 ticket activity', () => {
  it('renders "<human> via <principal>" in the Actor cell', async () => {
    m.getTimeline.mockResolvedValue([
      {
        type: 'activity',
        sortId: 'a1',
        occurredAt: '2026-10-01T10:00:00.000Z',
        activity: {
          activity_id: 'a1',
          event_type: 'TICKET_CLOSED',
          source: 'api',
          actor_type: 'user',
          actor_display_name: 'Ada Admin',
          via_principal_name: 'Billing sync',
          details: {},
        },
      },
    ]);
    render(<TicketActivityTimeline ticketId="t1" />);
    const via = await screen.findByTestId('via-principal-label');
    expect(via.textContent).toBe('via Billing sync');
    expect(via.parentElement?.textContent).toContain('Ada Admin');
  });
});

describe('T033 comments', () => {
  const NOTE = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'hi', styles: {} }] }]);
  const userMap = {
    svc: { user_id: 'svc', first_name: 'Billing sync', last_name: '', email: '', user_type: 'service', avatarUrl: null },
    human: { user_id: 'human', first_name: 'Ada', last_name: 'Admin', email: 'a@x.com', user_type: 'internal', avatarUrl: null },
  };
  const renderComment = (overrides: Partial<IComment>) =>
    render(
      <CommentItem
        conversation={{
          tenant: 't',
          author_type: 'internal',
          comment_id: 'c1',
          user_id: 'human',
          note: NOTE,
          created_at: new Date().toISOString(),
          ...overrides,
        } as IComment}
        currentUserId="me"
        isEditing={false}
        currentComment={null}
        ticketId="t1"
        userMap={userMap as never}
        contactMap={{}}
        onContentChange={() => {}}
        onSave={() => {}}
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

  it('shows the Service badge on a service-authored comment', async () => {
    renderComment({ user_id: 'svc' });
    expect((await screen.findByTestId('service-author-badge')).textContent).toBe('Service');
    expect(screen.getByText('Billing sync')).toBeInTheDocument();
  });

  it('shows "via <principal>" on a human comment created through a principal, and no badge', async () => {
    renderComment({ user_id: 'human', via_principal_name: 'Billing sync' } as Partial<IComment>);
    await waitFor(() => expect(screen.getByTestId('via-principal-label').textContent).toBe('via Billing sync'));
    expect(screen.queryByTestId('service-author-badge')).toBeNull();
  });
});
