/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ enabled: true, stager: vi.fn(), picker: vi.fn((_props: any) => null) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: () => ({ enabled: state.enabled }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (k: string, o?: any) => o?.defaultValue ?? k }) }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: (p: any) => <div role="alert">{p.children}</div>, AlertDescription: (p: any) => <span>{p.children}</span> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: (props: any) => <button id={props.id} onClick={props.onClick}>{props.children}</button> }));
vi.mock('@/components/co-managed/attachmentFileStager', () => ({ registerCoManagedAttachmentStager: () => state.stager() }));
vi.mock('@/components/co-managed/SharedCommentAttachmentPicker', () => ({ default: (props: any) => { state.picker(props); return <div data-testid="picker" />; } }));
vi.mock('@/components/co-managed/CoManagedCommentAttachments', () => ({ default: (props: any) => <div data-testid="files">{props.comment.commentId}</div> }));
vi.mock('@/components/co-managed/CoManagedThreadDisclosure', () => ({ default: () => <div data-testid="disclosure" /> }));
vi.mock('@/lib/co-managed/attachmentUploadLimit', () => ({ coManagedAttachmentUploadLimit: () => 1024 }));

import CoManagedConversationFiles from '@/components/co-managed/CoManagedConversationFiles';

const EMPTY: never[] = [];
const staging = { subscribe: () => () => {}, getSnapshot: () => EMPTY } as any;
const resource = { tenant: 't', relationshipId: 'r', kind: 'ticket', id: 'k' } as any;
const session = (audiences: string[]) => ({
  snapshot: () => ({ actor: { tenant: 'a', userId: 'u' }, items: [
    { storeTenant: 't', threadId: 'th1', commentId: 'c1', deleted: false }, { storeTenant: 't', threadId: 'th1', commentId: 'c2', deleted: false }, { storeTenant: 't', threadId: 'th2', commentId: 'c3', deleted: true }] }),
  writeAudiences: () => audiences, load: vi.fn(), subscribe: () => () => {}, version: () => 0, unsentFailure: () => null,
}) as any;

describe('CoManagedConversationFiles', () => {
  beforeEach(() => { state.enabled = true; state.stager.mockClear(); state.picker.mockClear(); });

  it('resolves the comment-attachment slot per comment, the thread-header slot per thread, and offers the picker and registers the stager', () => {
    render(<CoManagedConversationFiles session={session(['requester', 'shared_it'])} resource={resource} staging={staging} />);
    expect(state.stager).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('picker')).toBeInTheDocument();
    expect(state.picker.mock.calls[0][0].limits).toEqual({ maxBytes: 1024, maxFiles: 20 });
    expect(screen.getAllByTestId('files').map(n => n.textContent)).toEqual(['c1', 'c2']); // deleted comments get none; the portal-only slot is skipped
    expect(document.querySelectorAll('[id$="-disclose"]')).toHaveLength(1); // one control for the one live thread
  });

  it('renders nothing and registers the stager only through this panel; no write audience means no picker', () => {
    state.enabled = false;
    const off = render(<CoManagedConversationFiles session={session(['requester'])} resource={resource} staging={staging} />);
    expect(off.container).toBeEmptyDOMElement();
    off.unmount();
    state.enabled = true;
    render(<CoManagedConversationFiles session={session([])} resource={resource} staging={staging} />);
    expect(screen.queryByTestId('picker')).toBeNull();
  });

  it('re-renders when the session finishes a load, so a freshly sent message gets its files surface', () => {
    const listeners = new Set<() => void>();
    let version = 0, items = [{ storeTenant: 't', threadId: 'th1', commentId: 'c1', deleted: false }];
    const live = { snapshot: () => ({ actor: { tenant: 'a', userId: 'u' }, items }), writeAudiences: () => ['requester'], unsentFailure: () => null, load: vi.fn(),
      subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; }, version: () => version } as any;
    render(<CoManagedConversationFiles session={live} resource={resource} staging={staging} />);
    expect(screen.getAllByTestId('files').map(n => n.textContent)).toEqual(['c1']);
    act(() => { items = [...items, { storeTenant: 't', threadId: 'th1', commentId: 'c9', deleted: false }]; version += 1; listeners.forEach(l => l()); });
    expect(screen.getAllByTestId('files').map(n => n.textContent)).toEqual(['c1', 'c9']);
  });
});

describe('CoManagedConversationFiles upload failure notice', () => {
  it('tells the user a failed send with files will be under "Unsent messages", and shows a refusal as itself', () => {
    const failed = (code: string) => { const stable = { code }; return { ...session(['requester']), unsentFailure: () => stable }; }; // the real session hands back one stable reference
    const view = render(<CoManagedConversationFiles session={failed('unknownOutcome')} resource={resource} staging={staging} />);
    expect(screen.getByRole('alert')).toHaveTextContent('coManaged.conversation.drafts.unsent');
    view.unmount();
    render(<CoManagedConversationFiles session={failed('readOnly')} resource={resource} staging={staging} />);
    expect(screen.getByRole('alert')).toHaveTextContent('coManaged.editor.errors.readOnly');
  });
  it('shows the alert as soon as a write fails and drops it after the next success, without a load completing', () => {
    const listeners = new Set<() => void>();
    let failure: { code: string } | null = null;
    const live = { ...session(['requester']), unsentFailure: () => failure, version: () => 0,
      subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; } };
    render(<CoManagedConversationFiles session={live} resource={resource} staging={staging} />);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => { failure = { code: 'unknownOutcome' }; listeners.forEach(l => l()); });
    expect(screen.getByRole('alert')).toHaveTextContent('coManaged.conversation.drafts.unsent');
    act(() => { failure = null; listeners.forEach(l => l()); });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('shows no alert when nothing failed', () => {
    render(<CoManagedConversationFiles session={{ ...session(['requester']), unsentFailure: () => null }} resource={resource} staging={staging} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
