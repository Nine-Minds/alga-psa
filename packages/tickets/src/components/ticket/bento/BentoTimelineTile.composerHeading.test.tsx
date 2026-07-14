/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BentoTimelineTile } from './BentoTimelineTile';

type BentoTimelineTileProps = React.ComponentProps<typeof BentoTimelineTile>;

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="composer-editor" />,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
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
  Label: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
  return render(<BentoTimelineTile {...defaultProps} {...overrides} />);
}

describe('BentoTimelineTile composer heading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
