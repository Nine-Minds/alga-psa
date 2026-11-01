/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BentoTimelineTile } from './BentoTimelineTile';
import { TicketDataSourceProvider } from '../TicketDataSourceContext';
import { nativeTicketDataSource } from '../../../lib/nativeTicketDataSource';
import { composeTicketDataSource, type TicketConversationConfig } from '../../../lib/ticketDataSource';

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

const capability = vi.hoisted(() => ({ enabled: false }));
vi.mock('@alga-psa/ui/hooks/useCapability', () => ({
  useCapability: () => ({ enabled: capability.enabled, admitted: capability.enabled, resolved: true }),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, placeholder }: any) => (
    <select id={id} value={value ?? ''} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
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

vi.mock('@alga-psa/ui/components/bento/BentoTile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/ui/components/bento/BentoTile')>()),
  BentoTile: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  BentoTileEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components', () => ({
  buildCommentThreadGroups: ({ comments }: { comments: any[] }) =>
    comments.map((comment) => ({ root: comment, comments: [comment], replies: [] })),
  HybridThreadNode: ({ group, renderComment }: any) => <>{renderComment(group.root)}</>,
}));

vi.mock('@alga-psa/ui/components/InlineReplyComposer', () => ({
  default: ({ parentCommentId, initialInternal, showInternalToggle, onSubmit }: any) => (
    <div>
      <span data-testid="reply-internal-toggle">{String(showInternalToggle)}</span>
      <button type="button" data-testid="reply-send" onClick={() => onSubmit({ content: [], parentCommentId, isInternal: initialInternal })} />
    </div>
  ),
}));

vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({
  useDialogSubmitShortcut: () => undefined,
  usePageCreateShortcut: () => undefined,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/ui/ui-reflection/withDataAutomationId')>()),
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
  default: ({ conversation, onReply }: any) => (
    <button type="button" data-testid={`reply-${conversation.comment_id}`} onClick={onReply} />
  ),
}));

vi.mock('../TicketConversation', () => ({
  DEFAULT_BLOCK: [],
}));

vi.mock('../TicketNotificationSuppressionControl', () => ({
  default: () => null,
}));

// Mirrors the real hook: with pasted images Cancel opens a dialog and discards nothing yet.
const upload = vi.hoisted(() => ({ dialogOpen: false, onDiscard: undefined as undefined | (() => void) }));
vi.mock('../useTicketRichTextUploadSession', () => ({
  useTicketRichTextUploadSession: (options: { onDiscard?: () => void; componentLabel?: string }) => {
    if (options.componentLabel === 'BentoTimelineTile-compose') upload.onDiscard = options.onDiscard;
    return {
      uploadFile: vi.fn(),
      resetDraftTracking: vi.fn(),
      requestDiscard: vi.fn(async () => { if (!upload.dialogOpen) options.onDiscard?.(); }),
    };
  },
}));

const defaultProps: BentoTimelineTileProps = {
  id: 'ticket-timeline',
  // Newest-first: the composer entry sits above the history (see composer placement).
  initialOrder: 'desc',
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

const onComposerCancel = vi.fn();

function renderTimeline(hooked: boolean, overrides: Partial<BentoTimelineTileProps> = {}) {
  const dataSource = hooked
    ? composeTicketDataSource(nativeTicketDataSource, { screen: { onComposerCancel } })
    : nativeTicketDataSource;
  const result = render(
    <TicketDataSourceProvider dataSource={dataSource}>
      <BentoTimelineTile {...defaultProps} {...overrides} />
    </TicketDataSourceProvider>,
  );
  fireEvent.click(document.getElementById('ticket-timeline-add-comment-btn')!);
  return result;
}

const cancel = () => fireEvent.click(document.getElementById('ticket-timeline-composer-cancel')!);
const composerOpen = () => screen.queryByTestId('composer-editor') !== null;

/** Bento composer Cancel tells the host (screen.onComposerCancel) only when the discard really happens. */
describe('BentoTimelineTile composer Cancel and screen.onComposerCancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capability.enabled = true;
    upload.dialogOpen = false;
    upload.onDiscard = undefined;
  });

  it('fires once when Cancel discards the composer', async () => {
    renderTimeline(true);
    expect(composerOpen()).toBe(true);
    cancel();
    await waitFor(() => expect(onComposerCancel).toHaveBeenCalledTimes(1));
    expect(composerOpen()).toBe(false);
  });

  it('does not fire while the pasted-images dialog is pending, and fires once the discard is confirmed', async () => {
    renderTimeline(true);
    upload.dialogOpen = true;
    cancel();
    await Promise.resolve();
    expect(onComposerCancel).not.toHaveBeenCalled();
    expect(composerOpen()).toBe(true);
    await act(async () => { upload.onDiscard?.(); });
    expect(onComposerCancel).toHaveBeenCalledTimes(1);
  });

  it('a native data source (no hook) cancels without throwing and closes the composer', async () => {
    renderTimeline(false);
    expect(() => cancel()).not.toThrow();
    await waitFor(() => expect(composerOpen()).toBe(false));
    expect(onComposerCancel).not.toHaveBeenCalled();
  });

  it('a successful submit does not fire it (the send path owns clearing staging)', async () => {
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    renderTimeline(true, { onAddNewComment });
    fireEvent.click(screen.getByTestId('composer-editor'));
    fireEvent.click(document.getElementById('ticket-timeline-composer-send')!);
    await waitFor(() => expect(onAddNewComment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(composerOpen()).toBe(false));
    expect(onComposerCancel).not.toHaveBeenCalled();
  });
});
