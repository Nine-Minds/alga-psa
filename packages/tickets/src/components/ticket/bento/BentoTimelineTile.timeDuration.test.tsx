/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BentoTimelineTile } from './BentoTimelineTile';
import type { TicketTimelineEntry } from '@alga-psa/shared/lib/ticketActivity';

type BentoTimelineTileProps = React.ComponentProps<typeof BentoTimelineTile>;

const getTicketTimelineEntries = vi.fn();

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="composer-editor" />,
}));

vi.mock('@alga-psa/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/core')>();
  return {
    ...actual,
    getUserTimeZone: () => 'America/New_York',
    zonedWallTimeToUtc: () => new Date('2026-08-23T13:30:00.000Z'),
    dateToWallTimeString: () => '2026-08-23T09:30',
  };
});

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: () => null,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({
    locale: 'en',
    formatDate: (date: Date | string) =>
      new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(
        typeof date === 'string' ? new Date(date) : date,
      ),
  }),
  useTranslation: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, unknown>) => {
      let result = fallback ?? _key;
      for (const [name, value] of Object.entries(values ?? {})) {
        result = result.replace(`{{${name}}}`, String(value));
      }
      return result;
    },
  }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id }: { children: React.ReactNode; id: string }) => (
    <button id={id} type="button">{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}));
vi.mock('@alga-psa/ui/components/Switch', () => ({ Switch: () => null }));
vi.mock('@alga-psa/ui/components/bento/BentoTile', () => ({
  BentoTile: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  BentoTileEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components', () => ({
  buildCommentThreadGroups: () => [],
  HybridThreadNode: () => null,
}));
vi.mock('@alga-psa/ui/components/InlineReplyComposer', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({
  useDialogSubmitShortcut: () => undefined,
  usePageCreateShortcut: () => undefined,
}));
vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ 'data-testid': id }),
}));
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ deleteDocument: vi.fn() }),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ searchUsersForMentions: vi.fn() }));
vi.mock('../../../actions/ticketActivityActions', () => ({
  getTicketTimelineEntries: (...args: unknown[]) => getTicketTimelineEntries(...args),
}));
vi.mock('../../../actions/ticketLayoutPreference', () => ({
  setTicketLayoutPreference: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../actions/comment-actions/commentReactionActions', () => ({
  getCommentsReactionsBatch: vi.fn().mockResolvedValue({ reactions: {}, userNames: {} }),
  toggleCommentReaction: vi.fn(),
}));
vi.mock('../CommentItem', () => ({ default: () => null }));
vi.mock('../TicketConversation', () => ({ DEFAULT_BLOCK: [] }));
vi.mock('../TicketNotificationSuppressionControl', () => ({ default: () => null }));
vi.mock('../useTicketRichTextUploadSession', () => ({
  useTicketRichTextUploadSession: () => ({
    uploadFile: vi.fn(),
    resetDraftTracking: vi.fn(),
    requestDiscard: vi.fn(),
  }),
}));

function timeEntry(
  overrides: Partial<TicketTimelineEntry['timeEntry']> & { entry_id: string },
): TicketTimelineEntry {
  return {
    type: 'time_entry',
    occurredAt: '2026-09-20T23:59:00.000Z',
    sortId: overrides.entry_id,
    timeEntry: {
      user_id: 'user-1',
      user_display_name: 'Ada Lovelace',
      start_time: '2026-09-20T23:54:00.000Z',
      end_time: '2026-09-20T23:59:00.000Z',
      billable_duration: 0,
      notes: null,
      work_date: '2026-09-20',
      ...overrides,
    },
  };
}

const defaultProps: BentoTimelineTileProps = {
  id: 'ticket-timeline',
  ticketId: 'ticket-1',
  conversations: [],
  userMap: {},
  contactMap: {},
  editorKey: 1,
  onNewCommentContentChange: vi.fn(),
  onAddNewComment: vi.fn().mockResolvedValue(true),
  isEditing: false,
  currentComment: null,
  onContentChange: vi.fn(),
  onSaveComment: vi.fn(),
  onCloseEdit: vi.fn(),
  onEditComment: vi.fn(),
  onDeleteComment: vi.fn(),
};

describe('BentoTimelineTile worked duration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketTimelineEntries.mockResolvedValue([]);
  });

  it('shows worked minutes for a non-billable entry and a separate Non-billable badge', async () => {
    getTicketTimelineEntries.mockResolvedValue([timeEntry({ entry_id: 'non-billable' })]);

    render(<BentoTimelineTile {...defaultProps} />);

    expect(await screen.findByText('5m')).toBeInTheDocument();
    expect(screen.getByText('Non-billable')).toBeInTheDocument();
    expect(screen.queryByText('0m')).not.toBeInTheDocument();
  });

  it('shows timestamp-derived worked time and a Billable badge when billed minutes differ', async () => {
    getTicketTimelineEntries.mockResolvedValue([
      timeEntry({
        entry_id: 'billable',
        start_time: '2026-09-21T10:00:00.000Z',
        end_time: '2026-09-21T10:10:00.000Z',
        billable_duration: 20,
      }),
    ]);

    render(<BentoTimelineTile {...defaultProps} />);

    expect(await screen.findByText('10m')).toBeInTheDocument();
    expect(screen.getByText('Billable')).toBeInTheDocument();
    expect(screen.queryByText('20m')).not.toBeInTheDocument();
  });
});
