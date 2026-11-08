/** @vitest-environment jsdom */

/**
 * The composer's Cancel tells the host (screen.onComposerCancel) only when the discard really happens;
 * a pending pasted-images dialog ('keep editing') leaves the host's staged state alone.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/msp/tickets/ticket-2',
}));

// Only the translation default is needed; the UnsavedChangesProvider dialog text is hard-coded.
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

// The real editor is far too heavy for jsdom: a contenteditable that reports its text the
// way TextEditor's onContentChange does. TicketConversation loads it through next/dynamic,
// InlineReplyComposer imports it directly; both end up at this module.
vi.mock('@alga-psa/ui/editor', () => ({
  TextEditor: ({ onContentChange }: { onContentChange?: (content: unknown[]) => void }) => (
    <div
      className="ProseMirror"
      contentEditable
      suppressContentEditableWarning
      tabIndex={0}
      role="textbox"
      aria-label="Comment editor"
      onInput={(event) =>
        onContentChange?.([
          { type: 'paragraph', content: [{ type: 'text', text: event.currentTarget.textContent ?? '', styles: {} }] },
        ])
      }
    />
  ),
}));

vi.mock('next/dynamic', async () => {
  const react = await import('react');
  return {
    default: (loader: () => Promise<React.ComponentType<any>>) =>
      react.lazy(async () => ({ default: await loader() })),
  };
});

vi.mock('@alga-psa/user-composition/actions', () => ({
  getContactAvatarUrlAction: vi.fn(async () => null),
  getUserContactId: vi.fn(async () => null),
  searchUsersForMentions: vi.fn(async () => []),
}));

vi.mock('../../../actions/comment-actions/commentReactionActions', () => ({
  toggleCommentReaction: vi.fn(),
  getCommentsReactionsBatch: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ deleteDocument: vi.fn() }),
}));

const upload = vi.hoisted(() => ({ dialogOpen: false, onDiscard: undefined as undefined | (() => void) }));
vi.mock('../useTicketRichTextUploadSession', () => ({
  useTicketRichTextUploadSession: (options: { onDiscard: () => void }) => {
    upload.onDiscard ??= options.onDiscard; // the first call per mount is the compose session
    return {
      draftClipboardImages: [], isUploading: false, isDeletingDraftImages: false,
      keepDraftClipboardImages: () => options.onDiscard(),
      // With pasted images the real hook opens a dialog and discards nothing yet.
      requestDiscard: () => { if (!upload.dialogOpen) options.onDiscard(); },
      resetDraftTracking: vi.fn(), showDraftCancelDialog: false, setShowDraftCancelDialog: vi.fn(),
      uploadFile: vi.fn(), deleteTrackedDraftClipboardImages: vi.fn(),
    };
  },
}));

vi.mock('../CommentItem', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/CommentThreadDrawer', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components', () => ({
  CommentThreadList: () => null,
  HybridThreadNode: () => null,
  buildCommentThreadGroups: () => [],
}));

import TicketConversation from '../TicketConversation';
import { TicketDataSourceProvider } from '../TicketDataSourceContext';
import { composeTicketDataSource } from '../../../lib/ticketDataSource';
import { nativeTicketDataSource } from '../../../lib/nativeTicketDataSource';

const ticket = { ticket_id: 'ticket-2', ticket_number: 'T-2', title: 'Printer down' } as any;
const onComposerCancel = vi.fn();

function Page({ hooked }: { hooked: boolean }) {
  const dataSource = React.useMemo(() => hooked ? composeTicketDataSource(nativeTicketDataSource, { screen: { onComposerCancel } }) : nativeTicketDataSource, [hooked]);
  return (
    <TicketDataSourceProvider dataSource={dataSource}>
      <TicketConversation id="ticket-conversation" ticket={ticket} conversations={[]} documents={[]} userMap={{}} contactMap={{}}
        currentUser={{ id: 'user-1', name: 'Test User' }} activeTab="all-comments" isEditing={false} currentComment={null} editorKey={0}
        onNewCommentContentChange={vi.fn()} onAddNewComment={vi.fn(async () => true)} onTabChange={vi.fn()} onEdit={vi.fn()} onSave={vi.fn()}
        onClose={vi.fn()} onDelete={vi.fn()} onContentChange={vi.fn()} />
    </TicketDataSourceProvider>
  );
}
const openComposer = async () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Add Comment' })[0]);
  await screen.findByRole('textbox', { name: 'Comment editor' });
};
const cancel = () => fireEvent.click(document.getElementById('ticket-conversation-cancel-comment-btn')!);

describe('composer Cancel and screen.onComposerCancel', () => {
  beforeEach(() => { upload.dialogOpen = false; upload.onDiscard = undefined; onComposerCancel.mockClear(); });
  afterEach(() => cleanup());

  it('fires when Cancel discards the composer', async () => {
    render(<Page hooked />);
    await openComposer();
    cancel();
    expect(onComposerCancel).toHaveBeenCalledTimes(1);
  });

  it('does not fire while the pasted-images dialog is pending (keep editing), and fires once the discard happens', async () => {
    render(<Page hooked />);
    await openComposer();
    upload.dialogOpen = true;
    cancel();
    expect(onComposerCancel).not.toHaveBeenCalled();
    await act(async () => { upload.onDiscard?.(); });
    expect(onComposerCancel).toHaveBeenCalledTimes(1);
  });

  it('a native screen (no hook) cancels exactly as before', async () => {
    render(<Page hooked={false} />);
    await openComposer();
    expect(() => cancel()).not.toThrow();
    expect(onComposerCancel).not.toHaveBeenCalled();
  });
});
