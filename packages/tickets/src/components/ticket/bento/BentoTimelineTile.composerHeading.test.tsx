/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BentoTimelineTile } from './BentoTimelineTile';

type BentoTimelineTileProps = React.ComponentProps<typeof BentoTimelineTile>;

vi.mock('next/dynamic', () => ({
  default: () => ({ onContentChange }: { onContentChange: (content: unknown[]) => void }) => (
    <button data-testid="composer-editor" type="button" onClick={() => onContentChange([])} />
  ),
}));

vi.mock('@alga-psa/core', () => ({
  getUserTimeZone: () => 'America/New_York',
  zonedWallTimeToUtc: () => new Date('2026-08-23T13:30:00.000Z'),
  dateToWallTimeString: () => '2026-08-23T09:30',
}));

// The design-system DateTimePicker (calendar + time-rail panel) has its own
// suite; here we stub it to a labeled input so this test stays focused on the
// composer's lane isolation and schedule-param plumbing, and can drive a Date.
vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: ({ id, label, value, onChange }: {
    id?: string;
    label?: string;
    value?: Date;
    onChange: (date: Date | undefined) => void;
  }) => (
    <input
      id={id}
      data-testid="datetimepicker"
      aria-label={label}
      value={value ? value.toISOString() : ''}
      onChange={(event) => onChange(event.target.value ? new Date(event.target.value) : undefined)}
    />
  ),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  // Components under test format dates through useFormatters; the real hook
  // reads the locale off the provider this test does not mount.
  useFormatters: () => ({
    locale: 'en',
    formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en', options).format(typeof date === 'string' ? new Date(date) : date),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', options).format(value),
    formatCurrency: (value: number, currency: string, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', { style: 'currency', currency, ...options }).format(value),
    formatRelativeTime: (date: Date | string) => String(date),
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
  Button: ({
    children,
    id,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    id: string;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button id={id} type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange }: { id: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} />
  ),
}));

vi.mock('@alga-psa/ui/components/bento/BentoTile', () => ({
  BentoTile: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  BentoTileEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components', () => ({
  buildCommentThreadGroups: () => [],
  HybridThreadNode: () => null,
}));

vi.mock('@alga-psa/ui/components/InlineReplyComposer', () => ({
  default: () => null,
}));

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

vi.mock('@alga-psa/user-composition/actions', () => ({
  searchUsersForMentions: vi.fn(),
}));

vi.mock('../../../actions/ticketActivityActions', () => ({
  getTicketTimelineEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../actions/ticketLayoutPreference', () => ({
  setTicketLayoutPreference: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../actions/comment-actions/commentReactionActions', () => ({
  getCommentsReactionsBatch: vi.fn().mockResolvedValue({ reactions: {}, userNames: {} }),
  toggleCommentReaction: vi.fn(),
}));

vi.mock('../CommentItem', () => ({
  default: () => null,
}));

vi.mock('../TicketConversation', () => ({
  DEFAULT_BLOCK: [],
}));

vi.mock('../TicketNotificationSuppressionControl', () => ({
  default: () => null,
}));

vi.mock('../useTicketRichTextUploadSession', () => ({
  useTicketRichTextUploadSession: () => ({
    uploadFile: vi.fn(),
    resetDraftTracking: vi.fn(),
  }),
}));

const defaultProps: BentoTimelineTileProps = {
  id: 'ticket-timeline',
  ticketId: 'ticket-1',
  conversations: [],
  userMap: {},
  contactMap: {},
  contactFirstName: 'Andrew',
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

function renderTimeline(overrides: Partial<BentoTimelineTileProps> = {}) {
  const result = render(<BentoTimelineTile {...defaultProps} {...overrides} />);
  // The composer is collapsed behind the header button until asked for.
  fireEvent.click(document.getElementById('ticket-timeline-add-comment-btn')!);
  return result;
}

describe('BentoTimelineTile composer heading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The schedule composer only renders the resolved instant while it is still
    // in the future (scheduleIsValid checks scheduledInstant > Date.now()), and
    // the zonedWallTimeToUtc mock always resolves to 2026-08-23T13:30:00Z. Pin
    // the clock before that instant so the assertion is deterministic instead of
    // silently failing forever once real time passes that date. Fake only Date
    // so setTimeout-based helpers (waitFor) keep working.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the contact heading only in the client lane', () => {
    renderTimeline();

    expect(screen.getByText('Reply to Andrew')).toBeInTheDocument();

    fireEvent.click(document.getElementById('ticket-timeline-composer-lane-internal')!);
    expect(screen.queryByText('Reply to Andrew')).not.toBeInTheDocument();

    fireEvent.click(document.getElementById('ticket-timeline-composer-lane-resolution')!);
    expect(screen.queryByText('Reply to Andrew')).not.toBeInTheDocument();

    fireEvent.click(document.getElementById('ticket-timeline-composer-lane-client')!);
    expect(screen.getByText('Reply to Andrew')).toBeInTheDocument();
  });

  it('shows the no-contact fallback only in the client lane', () => {
    renderTimeline({ contactFirstName: null });

    expect(screen.getByText('Write a reply')).toBeInTheDocument();

    fireEvent.click(document.getElementById('ticket-timeline-composer-lane-internal')!);
    expect(screen.queryByText('Write a reply')).not.toBeInTheDocument();

    fireEvent.click(document.getElementById('ticket-timeline-composer-lane-resolution')!);
    expect(screen.queryByText('Write a reply')).not.toBeInTheDocument();
  });

  it('schedules a client-visible comment with the resolved instant and user time zone', async () => {
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    renderTimeline({ onAddNewComment });

    fireEvent.click(screen.getByRole('switch', { name: 'Schedule' }));
    const publishAt = screen.getByLabelText('Publish at (America/New_York)');
    fireEvent.change(publishAt, { target: { value: '2026-08-23T09:30' } });
    expect(screen.getByText(/Resolved instant: 2026-08-23T13:30:00.000Z/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('composer-editor'));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));

    await vi.waitFor(() => {
      expect(onAddNewComment).toHaveBeenCalledWith(
        false,
        false,
        null,
        undefined,
        { publishAt: '2026-08-23T13:30:00.000Z', timeZone: 'America/New_York' },
      );
      expect(document.getElementById('ticket-timeline-composer')).toBeNull();
    });
  });

  it('does not expose scheduling controls in the internal lane', () => {
    renderTimeline();

    expect(document.getElementById('ticket-timeline-composer-schedule-toggle')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Internal' }));
    expect(document.getElementById('ticket-timeline-composer-schedule-toggle')).toBeNull();
  });

  it.each([
    { lane: 'Internal', isInternal: true, isResolution: false },
    { lane: 'Resolution', isInternal: false, isResolution: true },
  ])('allows an ordinary $lane comment after leaving an invalid client schedule', async ({ lane, isInternal, isResolution }) => {
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    renderTimeline({ onAddNewComment });

    fireEvent.click(screen.getByRole('switch', { name: 'Schedule' }));
    fireEvent.click(screen.getByTestId('composer-editor'));
    fireEvent.click(screen.getByRole('button', { name: lane }));

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    await vi.waitFor(() => {
      expect(onAddNewComment).toHaveBeenCalledWith(isInternal, isResolution, null, undefined, null);
    });
  });

  it('clears a scheduled draft when cancelled before reopening the composer', () => {
    renderTimeline();

    fireEvent.click(screen.getByRole('switch', { name: 'Schedule' }));
    expect(screen.getByLabelText('Publish at (America/New_York)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Comment' }));

    expect(screen.getByRole('switch', { name: 'Schedule' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByLabelText('Publish at (America/New_York)')).not.toBeInTheDocument();
  });
});
