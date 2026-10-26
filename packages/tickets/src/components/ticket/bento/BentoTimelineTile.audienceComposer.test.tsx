/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BentoTimelineTile } from './BentoTimelineTile';
import { TicketDataSourceProvider } from '../TicketDataSourceContext';
import { composeTicketDataSource } from '../../../lib/ticketDataSource';
import { nativeTicketDataSource } from '../../../lib/nativeTicketDataSource';

/**
 * The bento composer has its own audience lanes and submit path, so the async
 * audience resolution is pinned here separately from the classic conversation.
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

const audienceSource = composeTicketDataSource(nativeTicketDataSource, {
  conversation: {
    audiences: {
      options: [
        { id: 'requester', label: 'Requester and IT teams', internal: false },
        { id: 'shared_it', label: 'Shared IT teams', internal: true },
        { id: 'organization_private', label: 'Private to Customer A', internal: true },
      ],
      defaultId: 'shared_it',
      getCommentAudience: () => ({ id: 'shared_it', label: 'Shared IT teams' }),
    },
  },
});
const withSource = (source: typeof audienceSource, props: Partial<BentoTimelineTileProps>) =>
  <TicketDataSourceProvider dataSource={source}><BentoTimelineTile {...defaultProps} {...props} /></TicketDataSourceProvider>;

describe('BentoTimelineTile audience lanes (co-managed P0 privacy regression)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('submits the default audience it highlights when the options load after the composer opened', async () => {
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    const view = render(withSource(composeTicketDataSource(nativeTicketDataSource, {}), { onAddNewComment }));
    fireEvent.click(document.getElementById('ticket-timeline-add-comment-btn')!);
    view.rerender(withSource(audienceSource, { onAddNewComment }));
    expect(screen.getByRole('button', { name: 'Shared IT teams' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('composer-editor'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await vi.waitFor(() => expect(onAddNewComment).toHaveBeenCalledTimes(1));
    const args = onAddNewComment.mock.calls[0];
    expect(args[0]).toBe(true);
    expect(args.at(-1)).toBe('shared_it');
  });

  it('submits an explicit pick', async () => {
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    render(withSource(audienceSource, { onAddNewComment }));
    fireEvent.click(document.getElementById('ticket-timeline-add-comment-btn')!);
    fireEvent.click(screen.getByRole('button', { name: 'Requester and IT teams' }));
    fireEvent.click(screen.getByTestId('composer-editor'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await vi.waitFor(() => expect(onAddNewComment).toHaveBeenCalledTimes(1));
    expect(onAddNewComment.mock.calls[0][0]).toBe(false);
    expect(onAddNewComment.mock.calls[0].at(-1)).toBe('requester');
  });

  it('cannot send while no offered audience resolves', () => {
    const loading = composeTicketDataSource(nativeTicketDataSource, { conversation: { audiences: { ...audienceSource.conversation.audiences!, options: [] } } });
    render(withSource(loading, {}));
    fireEvent.click(document.getElementById('ticket-timeline-add-comment-btn')!);
    fireEvent.click(screen.getByTestId('composer-editor'));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
