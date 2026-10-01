/** @vitest-environment jsdom */

/**
 * Full-page ticket view (no Dialog, no Drawer): a comment typed into the compose
 * editor must not be lost by ticket prev/next navigation, reload or a browser
 * history chord. Uses the real TicketConversation, TicketNavigation,
 * UnsavedChangesProvider and KeyboardShortcutsProvider, as TicketDetailsContainer
 * mounts them; only the heavy leaf dependencies are mocked.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KeyboardShortcutsProvider, useShortcutScope } from '@alga-psa/ui/keyboard-shortcuts';
import { UnsavedChangesProvider } from '@alga-psa/ui/context/UnsavedChangesContext';

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

const getAdjacentTicketIds = vi.hoisted(() => vi.fn());
vi.mock('../../../actions/optimizedTicketActions', () => ({ getAdjacentTicketIds }));

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

vi.mock('../useTicketRichTextUploadSession', () => ({
  useTicketRichTextUploadSession: () => ({
    draftClipboardImages: [],
    isUploading: false,
    isDeletingDraftImages: false,
    keepDraftClipboardImages: vi.fn(),
    requestDiscard: vi.fn(),
    resetDraftTracking: vi.fn(),
    showDraftCancelDialog: false,
    setShowDraftCancelDialog: vi.fn(),
    uploadFile: vi.fn(),
    deleteTrackedDraftClipboardImages: vi.fn(),
  }),
}));

vi.mock('../CommentItem', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/CommentThreadDrawer', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components', () => ({
  CommentThreadList: () => null,
  HybridThreadNode: () => null,
  buildCommentThreadGroups: () => [],
}));

import TicketConversation from '../TicketConversation';
import TicketNavigation from '../TicketNavigation';
import InlineReplyComposer from '@alga-psa/ui/components/InlineReplyComposer';

function PageScope({ children }: { children?: React.ReactNode }) {
  useShortcutScope('page');
  return <>{children}</>;
}

const ticket = { ticket_id: 'ticket-2', ticket_number: 'T-2', title: 'Printer down' } as any;

function FullPage({ surface }: { surface: 'compose' | 'reply' }) {
  return (
    <KeyboardShortcutsProvider platform="other">
      <UnsavedChangesProvider>
        <PageScope>
          <button type="button">page chrome</button>
          <TicketNavigation currentTicketId="ticket-2" />
          {surface === 'reply' ? (
            <InlineReplyComposer
              parentCommentId="comment-1"
              roomName="ticket-ticket-2"
              onSubmit={vi.fn()}
              onCancel={vi.fn()}
            />
          ) : (
          <TicketConversation
            id="ticket-conversation"
            ticket={ticket}
            conversations={[]}
            documents={[]}
            userMap={{}}
            contactMap={{}}
            currentUser={{ id: 'user-1', name: 'Test User' }}
            activeTab="all-comments"
            isEditing={false}
            currentComment={null}
            editorKey={0}
            onNewCommentContentChange={vi.fn()}
            onAddNewComment={vi.fn(async () => true)}
            onTabChange={vi.fn()}
            onEdit={vi.fn()}
            onSave={vi.fn()}
            onClose={vi.fn()}
            onDelete={vi.fn()}
            onContentChange={vi.fn()}
          />
          )}
        </PageScope>
      </UnsavedChangesProvider>
    </KeyboardShortcutsProvider>
  );
}

const originalLocation = window.location;
let hrefAssignments: string[];

function press(target: EventTarget, init: KeyboardEventInit & { key: string; code: string }) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

async function renderPage(surface: 'compose' | 'reply' = 'compose') {
  render(<FullPage surface={surface} />);
  // Navigation renders once the adjacent-ticket lookup resolves.
  await screen.findByLabelText('Previous ticket');
}

async function openComposerAndType(text: string, surface: 'compose' | 'reply' = 'compose') {
  if (surface === 'compose') {
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Comment' })[0]);
  }
  const editor = await screen.findByRole('textbox', { name: 'Comment editor' });
  editor.focus();
  editor.textContent = text;
  fireEvent.input(editor);
  return editor;
}

const confirmationTitle = () => screen.queryByText('Unsaved Changes');

beforeEach(() => {
  hrefAssignments = [];
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...originalLocation,
      get href() {
        return 'http://localhost/msp/tickets/ticket-2';
      },
      set href(value: string) {
        hrefAssignments.push(value);
      },
    },
  });
  getAdjacentTicketIds.mockResolvedValue({
    prevTicketId: 'ticket-1',
    nextTicketId: 'ticket-3',
    prevTicketNumber: 'T-1',
    nextTicketNumber: 'T-3',
    currentPosition: 2,
    totalCount: 3,
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  vi.clearAllMocks();
});

describe('full-page ticket view with a typed comment and no Dialog/Drawer', () => {
  it('the record shortcuts stay inert while the compose editor is open, so they cannot navigate away', async () => {
    await renderPage();
    await openComposerAndType('half-written reply');

    // The open composer owns a dialog scope; page-level record shortcuts do not fire under it.
    const chrome = screen.getByRole('button', { name: 'page chrome' });
    chrome.focus();
    press(chrome, { key: '[', code: 'BracketLeft' });
    press(chrome, { key: ']', code: 'BracketRight' });

    expect(hrefAssignments).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'Comment editor' }).textContent).toBe('half-written reply');
  });

  it('the prev/next buttons confirm before leaving', async () => {
    await renderPage();
    await openComposerAndType('half-written reply');

    fireEvent.click(screen.getByLabelText('Next ticket'));

    expect(await screen.findByText('Unsaved Changes')).toBeTruthy();
    expect(hrefAssignments).toEqual([]);

    // Staying keeps the text.
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(confirmationTitle()).toBeNull());
    expect(hrefAssignments).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'Comment editor' }).textContent).toBe('half-written reply');

    // Leaving is an explicit choice and only then navigates.
    fireEvent.click(screen.getByLabelText('Previous ticket'));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave Without Saving' }));
    expect(hrefAssignments).toEqual(['/msp/tickets/ticket-1']);
  });

  it.each([
    ['Cmd+ArrowLeft', { key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true }],
    ['Ctrl+ArrowRight', { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true }],
    ['Alt+ArrowLeft', { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }],
    ['Cmd+[', { key: '[', code: 'BracketLeft', metaKey: true }],
  ])('%s with focus outside the editor is default-prevented so the browser cannot go back', async (_name, init) => {
    await renderPage();
    await openComposerAndType('half-written reply');

    const chrome = screen.getByRole('button', { name: 'page chrome' });
    chrome.focus();

    expect(press(chrome, init).defaultPrevented).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Comment editor' }).textContent).toBe('half-written reply');
  });

  it('the same chords inside the editor stay native caret movement', async () => {
    await renderPage();
    const editor = await openComposerAndType('half-written reply');

    expect(press(editor, { key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true }).defaultPrevented).toBe(false);
    expect(press(editor, { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('reload is guarded by the page-level beforeunload', async () => {
    await renderPage();
    await openComposerAndType('half-written reply');

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('clearing the text again removes the guard', async () => {
    await renderPage();
    const editor = await openComposerAndType('half-written reply');

    editor.textContent = '';
    fireEvent.input(editor);

    const chrome = screen.getByRole('button', { name: 'page chrome' });
    chrome.focus();
    expect(press(chrome, { key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true }).defaultPrevented).toBe(false);
    fireEvent.click(screen.getByLabelText('Previous ticket'));
    expect(confirmationTitle()).toBeNull();
    expect(hrefAssignments).toEqual(['/msp/tickets/ticket-1']);
  });
});

describe('full-page ticket view with a typed inline reply and no Dialog/Drawer', () => {
  it.each([
    ['record.previous', '[', 'BracketLeft', 'ticket-1'],
    ['record.next', ']', 'BracketRight', 'ticket-3'],
  ])('%s asks for confirmation and does not navigate', async (_id, key, code, targetTicket) => {
    await renderPage('reply');
    await openComposerAndType('half-written reply', 'reply');

    // Focus leaves the editor (as after clicking the page), then the shortcut is pressed.
    const chrome = screen.getByRole('button', { name: 'page chrome' });
    chrome.focus();
    press(chrome, { key, code });

    expect(await screen.findByText('Unsaved Changes')).toBeTruthy();
    expect(hrefAssignments).toEqual([]);

    // Staying keeps everything as it was.
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(confirmationTitle()).toBeNull());
    expect(hrefAssignments).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'Comment editor' }).textContent).toBe('half-written reply');

    // Leaving is an explicit choice and only then navigates.
    press(chrome, { key, code });
    fireEvent.click(await screen.findByRole('button', { name: 'Leave Without Saving' }));
    expect(hrefAssignments).toEqual([`/msp/tickets/${targetTicket}`]);
  });

  it('a history chord outside the editor is default-prevented', async () => {
    await renderPage('reply');
    await openComposerAndType('half-written reply', 'reply');

    const chrome = screen.getByRole('button', { name: 'page chrome' });
    chrome.focus();
    expect(press(chrome, { key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true }).defaultPrevented).toBe(true);
  });

  it('an empty reply composer does not prompt', async () => {
    await renderPage('reply');
    await openComposerAndType('', 'reply');

    const chrome = screen.getByRole('button', { name: 'page chrome' });
    chrome.focus();
    press(chrome, { key: ']', code: 'BracketRight' });

    expect(confirmationTitle()).toBeNull();
    expect(hrefAssignments).toEqual(['/msp/tickets/ticket-3']);
  });
});

describe('full-page ticket view with nothing typed', () => {
  it.each([
    ['record.previous', '[', 'BracketLeft', 'ticket-1'],
    ['record.next', ']', 'BracketRight', 'ticket-3'],
  ])('%s navigates immediately without a prompt', async (_id, key, code, targetTicket) => {
    await renderPage();

    const chrome = screen.getByRole('button', { name: 'page chrome' });
    chrome.focus();
    press(chrome, { key, code });

    expect(confirmationTitle()).toBeNull();
    expect(hrefAssignments).toEqual([`/msp/tickets/${targetTicket}`]);
  });

  it('an opened but empty composer does not prompt either', async () => {
    await renderPage();
    await openComposerAndType('');

    fireEvent.click(screen.getByLabelText('Next ticket'));

    expect(confirmationTitle()).toBeNull();
    expect(hrefAssignments).toEqual(['/msp/tickets/ticket-3']);
  });

  it('history chords and reload are left alone', async () => {
    await renderPage();

    const chrome = screen.getByRole('button', { name: 'page chrome' });
    chrome.focus();
    expect(press(chrome, { key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true }).defaultPrevented).toBe(false);
    expect(press(chrome, { key: '[', code: 'BracketLeft', metaKey: true }).defaultPrevented).toBe(false);

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
