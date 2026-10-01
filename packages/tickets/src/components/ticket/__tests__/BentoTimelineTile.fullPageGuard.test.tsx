/** @vitest-environment jsdom */

/**
 * Default (Grid/bento) full-page ticket layout: a comment typed into the
 * BentoTimelineTile composer must not be lost by ticket prev/next navigation,
 * reload or a browser history chord. Uses the real BentoTimelineTile,
 * TicketNavigation, UnsavedChangesProvider and KeyboardShortcutsProvider, as
 * TicketDetailsContainer mounts them; only heavy leaf dependencies are mocked.
 * Companion to TicketConversation.fullPageGuard.test.tsx (the list layout).
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
    t: (key: string, fallback?: string | { defaultValue?: string }, values?: Record<string, unknown>) => {
      let result = typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key;
      for (const [name, value] of Object.entries(values ?? {})) {
        result = result.replace(`{{${name}}}`, String(value));
      }
      return result;
    },
    i18n: { language: 'en' },
  }),
  useFormatters: () => ({
    locale: 'en',
    formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en', options).format(typeof date === 'string' ? new Date(date) : date),
    formatNumber: (value: number) => String(value),
    formatCurrency: (value: number) => String(value),
    formatRelativeTime: (date: Date | string) => String(date),
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
  getCommentsReactionsBatch: vi.fn(async () => ({ reactions: {}, userNames: {} })),
}));

vi.mock('../../../actions/ticketActivityActions', () => ({
  getTicketTimelineEntries: vi.fn(async () => []),
}));

vi.mock('../../../actions/ticketLayoutPreference', () => ({
  setTicketLayoutPreference: vi.fn(async () => undefined),
}));

// Real TicketConversation drags in half the ticket UI; the tile only needs DEFAULT_BLOCK.
vi.mock('../TicketConversation', () => ({ DEFAULT_BLOCK: [] }));
vi.mock('../TicketNotificationSuppressionControl', () => ({ default: () => null }));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ deleteDocument: vi.fn() }),
}));

vi.mock('../useTicketRichTextUploadSession', () => ({
  useTicketRichTextUploadSession: (options: { onDiscard?: () => void }) => ({
    draftClipboardImages: [],
    isUploading: false,
    isDeletingDraftImages: false,
    keepDraftClipboardImages: vi.fn(),
    // Cancel withdraws draft uploads, then hands control back to the composer.
    requestDiscard: vi.fn(async () => { options.onDiscard?.(); }),
    resetDraftTracking: vi.fn(),
    showDraftCancelDialog: false,
    setShowDraftCancelDialog: vi.fn(),
    uploadFile: vi.fn(),
    deleteTrackedDraftClipboardImages: vi.fn(),
  }),
}));

vi.mock('../CommentItem', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components', () => ({
  buildCommentThreadGroups: () => [],
  HybridThreadNode: () => null,
}));

import { BentoTimelineTile } from '../bento/BentoTimelineTile';
import TicketNavigation from '../TicketNavigation';

function PageScope({ children }: { children?: React.ReactNode }) {
  useShortcutScope('page');
  return <>{children}</>;
}

const TILE_ID = 'ticket-timeline';

function FullPage({ editorKey = 0, onAddNewComment = vi.fn(async () => true) }: {
  editorKey?: number;
  onAddNewComment?: (...args: any[]) => Promise<boolean>;
}) {
  return (
    <KeyboardShortcutsProvider platform="other">
      <UnsavedChangesProvider>
        <PageScope>
          <button type="button">page chrome</button>
          <TicketNavigation currentTicketId="ticket-2" />
          <BentoTimelineTile
            id={TILE_ID}
            ticketId="ticket-2"
            conversations={[]}
            userMap={{}}
            contactMap={{}}
            contactFirstName="Andrew"
            editorKey={editorKey}
            onNewCommentContentChange={vi.fn()}
            onAddNewComment={onAddNewComment as any}
            isEditing={false}
            currentComment={null}
            onContentChange={vi.fn()}
            onSaveComment={vi.fn()}
            onCloseEdit={vi.fn()}
            onEditComment={vi.fn()}
            onDeleteComment={vi.fn()}
          />
        </PageScope>
      </UnsavedChangesProvider>
    </KeyboardShortcutsProvider>
  );
}

const originalLocation = window.location;
const originalIntersectionObserver = (globalThis as any).IntersectionObserver;
let hrefAssignments: string[];

function press(target: EventTarget, init: KeyboardEventInit & { key: string; code: string }) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Make the tile header count as scrolled out of view, so the bottom dock is offered. */
function scrollHeaderOffscreen() {
  (globalThis as any).IntersectionObserver = class {
    constructor(private callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}
    observe() {
      this.callback([{ isIntersecting: false }]);
    }
    disconnect() {}
    unobserve() {}
  };
}

type Placement = 'top' | 'bottom';

async function renderPage(props: React.ComponentProps<typeof FullPage> = {}) {
  const result = render(<FullPage {...props} />);
  // Navigation renders once the adjacent-ticket lookup resolves.
  await screen.findByLabelText('Previous ticket');
  return result;
}

async function openComposer(placement: Placement = 'top') {
  if (placement === 'top') {
    fireEvent.click(document.getElementById(`${TILE_ID}-add-comment-btn`)!);
  } else {
    fireEvent.click(document.getElementById(`${TILE_ID}-composer-dock-trigger`)!);
  }
  const editor = await screen.findByRole('textbox', { name: 'Comment editor' });
  expect(document.getElementById(placement === 'top' ? `${TILE_ID}-composer-top` : `${TILE_ID}-composer-dock`)).not.toBeNull();
  return editor;
}

function type(editor: HTMLElement, text: string) {
  editor.focus();
  editor.textContent = text;
  fireEvent.input(editor);
}

const confirmationTitle = () => screen.queryByText('Unsaved Changes');
const textboxText = () => screen.getByRole('textbox', { name: 'Comment editor' }).textContent;

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
  (globalThis as any).IntersectionObserver = originalIntersectionObserver;
  vi.clearAllMocks();
});

describe.each<Placement>(['top', 'bottom'])(
  'full-page bento ticket view with a typed comment in the %s composer',
  (placement) => {
    beforeEach(() => {
      if (placement === 'bottom') scrollHeaderOffscreen();
    });

    it('the prev/next buttons confirm before leaving; Stay keeps the text, Leave navigates', async () => {
      await renderPage();
      type(await openComposer(placement), 'half-written reply');

      fireEvent.click(screen.getByLabelText('Next ticket'));

      expect(await screen.findByText('Unsaved Changes')).toBeTruthy();
      expect(hrefAssignments).toEqual([]);

      fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
      await waitFor(() => expect(confirmationTitle()).toBeNull());
      expect(hrefAssignments).toEqual([]);
      expect(textboxText()).toBe('half-written reply');

      fireEvent.click(screen.getByLabelText('Previous ticket'));
      fireEvent.click(await screen.findByRole('button', { name: 'Leave Without Saving' }));
      expect(hrefAssignments).toEqual(['/msp/tickets/ticket-1']);
    });

    it.each([
      ['Cmd+ArrowLeft', { key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true }],
      ['Ctrl+ArrowRight', { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true }],
      ['Alt+ArrowLeft', { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }],
      ['Alt+ArrowRight', { key: 'ArrowRight', code: 'ArrowRight', altKey: true }],
      ['Cmd+[', { key: '[', code: 'BracketLeft', metaKey: true }],
      ['Cmd+]', { key: ']', code: 'BracketRight', metaKey: true }],
    ])('%s with focus outside the editor is default-prevented', async (_name, init) => {
      await renderPage();
      type(await openComposer(placement), 'half-written reply');

      // ESC-style blur: focus lands outside the editor.
      const chrome = screen.getByRole('button', { name: 'page chrome' });
      chrome.focus();

      expect(press(chrome, init).defaultPrevented).toBe(true);
      expect(textboxText()).toBe('half-written reply');
    });

    it('the same chords inside the editor stay native caret movement', async () => {
      await renderPage();
      const editor = await openComposer(placement);
      type(editor, 'half-written reply');

      expect(press(editor, { key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true }).defaultPrevented).toBe(false);
      expect(press(editor, { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true }).defaultPrevented).toBe(false);
    });

    it('reload is guarded by the page-level beforeunload', async () => {
      await renderPage();
      type(await openComposer(placement), 'half-written reply');

      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('the record shortcuts ask for confirmation instead of navigating', async () => {
      await renderPage();
      type(await openComposer(placement), 'half-written reply');

      const chrome = screen.getByRole('button', { name: 'page chrome' });
      chrome.focus();
      press(chrome, { key: ']', code: 'BracketRight' });

      // Either the dialog scope keeps the shortcut inert or the leave guard confirms; never a silent jump.
      expect(hrefAssignments).toEqual([]);
      expect(textboxText()).toBe('half-written reply');
    });

    it('typing and then clearing the text removes the guard', async () => {
      await renderPage();
      const editor = await openComposer(placement);
      type(editor, 'half-written reply');
      type(editor, '');

      const chrome = screen.getByRole('button', { name: 'page chrome' });
      chrome.focus();
      expect(press(chrome, { key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true }).defaultPrevented).toBe(false);
      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);

      fireEvent.click(screen.getByLabelText('Previous ticket'));
      expect(confirmationTitle()).toBeNull();
      expect(hrefAssignments).toEqual(['/msp/tickets/ticket-1']);
    });

    it('an opened but empty composer does not prompt', async () => {
      await renderPage();
      type(await openComposer(placement), '');

      fireEvent.click(screen.getByLabelText('Next ticket'));

      expect(confirmationTitle()).toBeNull();
      expect(hrefAssignments).toEqual(['/msp/tickets/ticket-3']);
    });

    it('cancelling the composer releases the guard', async () => {
      await renderPage();
      type(await openComposer(placement), 'half-written reply');

      fireEvent.click(document.getElementById(`${TILE_ID}-composer-cancel`)!);
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Comment editor' })).toBeNull());

      fireEvent.click(screen.getByLabelText('Next ticket'));
      expect(confirmationTitle()).toBeNull();
      expect(hrefAssignments).toEqual(['/msp/tickets/ticket-3']);
    });

    it('a successful send releases the guard', async () => {
      const onAddNewComment = vi.fn(async () => true);
      await renderPage({ onAddNewComment });
      type(await openComposer(placement), 'half-written reply');

      fireEvent.click(document.getElementById(`${TILE_ID}-composer-send`)!);
      await waitFor(() => expect(onAddNewComment).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Comment editor' })).toBeNull());

      fireEvent.click(screen.getByLabelText('Next ticket'));
      expect(confirmationTitle()).toBeNull();
      expect(hrefAssignments).toEqual(['/msp/tickets/ticket-3']);
    });

    it('a failed send keeps the guard', async () => {
      await renderPage({ onAddNewComment: vi.fn(async () => false) });
      type(await openComposer(placement), 'half-written reply');

      fireEvent.click(document.getElementById(`${TILE_ID}-composer-send`)!);
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Comment editor' })).toBeTruthy());

      fireEvent.click(screen.getByLabelText('Next ticket'));
      expect(await screen.findByText('Unsaved Changes')).toBeTruthy();
      expect(hrefAssignments).toEqual([]);
    });

    it('an editorKey bump (composer remounts empty) releases the guard', async () => {
      const { rerender } = await renderPage({ editorKey: 0 });
      type(await openComposer(placement), 'half-written reply');

      rerender(<FullPage editorKey={1} />);

      fireEvent.click(screen.getByLabelText('Next ticket'));
      expect(confirmationTitle()).toBeNull();
      expect(hrefAssignments).toEqual(['/msp/tickets/ticket-3']);
    });
  },
);

describe('full-page bento ticket view with nothing typed', () => {
  it('history chords and reload are left alone, and the record shortcuts navigate', async () => {
    await renderPage();

    const chrome = screen.getByRole('button', { name: 'page chrome' });
    chrome.focus();
    expect(press(chrome, { key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true }).defaultPrevented).toBe(false);
    expect(press(chrome, { key: '[', code: 'BracketLeft', metaKey: true }).defaultPrevented).toBe(false);

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    press(chrome, { key: ']', code: 'BracketRight' });
    expect(confirmationTitle()).toBeNull();
    expect(hrefAssignments).toEqual(['/msp/tickets/ticket-3']);
  });
});
