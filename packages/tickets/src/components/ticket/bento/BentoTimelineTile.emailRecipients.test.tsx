/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BentoTimelineTile } from './BentoTimelineTile';

/**
 * The bento composer has its own editor and its own submit path, so the Cc/Bcc
 * control has to be wired there separately from the classic conversation.
 */
type BentoTimelineTileProps = React.ComponentProps<typeof BentoTimelineTile>;

vi.mock('next/dynamic', () => ({
  // Render the editor's footer slot: the Cc/Bcc toggle lives there.
  default: () => ({ onContentChange, footerActions }: {
    onContentChange: (content: unknown[]) => void;
    footerActions?: React.ReactNode;
  }) => (
    <>
      <button data-testid="composer-editor" type="button" onClick={() => onContentChange([])} />
      {footerActions}
    </>
  ),
}));

vi.mock('../../../actions/clientLookupActions', () => ({ getContactsByClient: vi.fn(async () => []) }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getAllUsers: vi.fn(async () => []) }));

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
  // The Cc/Bcc control pulls in ReflectionContainer, which needs this HOC.
  withUIReflectionId: (Component: unknown) => Component,
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
  useTicketRichTextUploadSession: (options: { onDiscard?: () => void }) => ({
    uploadFile: vi.fn(),
    resetDraftTracking: vi.fn(),
    // Cancel withdraws draft uploads and then hands control back to the composer.
    requestDiscard: vi.fn(async () => { options.onDiscard?.(); }),
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
  const result = render(<BentoTimelineTile {...defaultProps} allowEmailRecipients {...overrides} />);
  fireEvent.click(document.getElementById('ticket-timeline-add-comment-btn')!);
  return result;
}

const byId = (id: string) => document.getElementById(id);
const TOGGLE = 'ticket-timeline-composer-ticket-comment-cc-bcc-toggle';
const CC = 'ticket-timeline-composer-ticket-comment-cc-input-input';
const BCC = 'ticket-timeline-composer-ticket-comment-bcc-input-input';

function typeChip(inputId: string, address: string) {
  const input = byId(inputId)!;
  fireEvent.change(input, { target: { value: address } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('BentoTimelineTile Cc/Bcc wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('T068: the toggle sits in the bento composer footer and its recipients reach onAddNewComment', async () => {
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    renderTimeline({ onAddNewComment });

    fireEvent.click(byId(TOGGLE)!);
    typeChip(CC, 'vendor@acme.com');
    typeChip(BCC, 'boss@msp.test');

    fireEvent.click(screen.getByTestId('composer-editor'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await vi.waitFor(() => {
      expect(onAddNewComment).toHaveBeenCalledWith(
        false,
        false,
        null,
        undefined,
        null,
        { cc: ['vendor@acme.com'], bcc: ['boss@msp.test'] },
      );
    });
  });

  it('T068: the internal lane keeps the draft but never sends it, and Send is blocked by a bad address', async () => {
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    renderTimeline({ onAddNewComment });

    fireEvent.click(byId(TOGGLE)!);
    typeChip(CC, 'not-an-address');
    fireEvent.click(screen.getByTestId('composer-editor'));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    // Switching to the internal lane hides the control and unblocks Send; the
    // typed recipients stay in the draft but are not sent.
    fireEvent.click(screen.getByRole('button', { name: 'Internal' }));
    expect(byId(TOGGLE)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await vi.waitFor(() => {
      expect(onAddNewComment).toHaveBeenCalledWith(true, false, null, undefined, null, undefined);
    });
  });

  it('T068: the control is opt-in — without the prop the bento composer has no toggle', () => {
    renderTimeline({ allowEmailRecipients: false });
    expect(byId(TOGGLE)).toBeNull();
  });
});
