/** @vitest-environment jsdom */
import React, { useRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConversationMessageFocus, useConversationMessageTarget } from '../../../../../packages/tickets/src/components/ticket/conversations/useConversationMessageFocus';
import { HybridThreadNode } from '../../../../../packages/ui/src/components/HybridThreadNode';
import { buildCommentThreadGroups } from '../../../../../packages/ui/src/components/CommentThreadList';
const navigation = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(navigation.query) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, fallback: any) => typeof fallback === 'string' ? fallback : fallback.defaultValue }) }));
function Message({ id, target }: { id: string; target: string | null }) {
  const ref = useRef<HTMLDivElement>(null), highlighted = useConversationMessageFocus(target, id, ref);
  return <div ref={ref} tabIndex={-1} data-highlighted={highlighted}>{id}</div>;
}
function Destination({ conversation = 'selected', store = 'home', defaultSlot = null }: { conversation?: string; store?: string; defaultSlot?: string | null }) {
  const target = useConversationMessageTarget('owner', { storeTenant: store, conversationId: conversation, defaultSlot });
  return <Message id="linked" target={target} />;
}
beforeEach(() => {
  navigation.query = 'conversation=selected&conversationStore=home&message=linked';
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('focuses only the selected qualified conversation and dismisses its highlight on interaction', async () => {
  const view = render(<Destination conversation="old" />);
  expect(screen.getByText('linked')).not.toHaveFocus();
  view.rerender(<Destination />);
  await waitFor(() => expect(screen.getByText('linked')).toHaveFocus());
  expect(screen.getByText('linked')).toHaveAttribute('data-highlighted', 'true');
  fireEvent.pointerDown(window); expect(screen.getByText('linked')).toHaveAttribute('data-highlighted', 'false');
  navigation.query += '&conversationView=all'; view.rerender(<Destination />);
  expect(screen.getByText('linked')).toHaveAttribute('data-highlighted', 'false');
});
it('uses Requester for a message-only URL and never applies another store target', async () => {
  navigation.query = 'message=LINKED';
  const view = render(<Destination />); expect(screen.getByText('linked')).not.toHaveFocus();
  view.rerender(<Destination conversation="requester" store="owner" defaultSlot="requester" />);
  await waitFor(() => expect(screen.getByText('linked')).toHaveFocus());
  navigation.query = 'conversation=requester&conversationStore=foreign&message=linked';
  view.rerender(<Destination conversation="requester" store="owner" defaultSlot="requester" />);
  expect(screen.getByText('linked')).toHaveAttribute('data-highlighted', 'false');
});
it('reveals and focuses an older reply inside a collapsed thread without changing normal collapse behavior', async () => {
  const comments = ['root', 'linked', 'newer-1', 'newer-2', 'newer-3'].map((id, index) => ({ id, parent: index ? 'root' : null, createdAt: `2026-01-01T00:00:0${index}Z` }));
  const group = buildCommentThreadGroups({ comments, getCommentId: x => x.id, getThreadId: () => 'thread', getParentCommentId: x => x.parent, getCreatedAt: x => x.createdAt })[0];
  const thread = (target: string | null) => <HybridThreadNode group={group} comment={group.root} getCommentId={x => x.id} autoCollapseAfter={3} revealCommentId={target}
    renderComment={x => <Message id={x.id} target={target} />} />;
  const view = render(thread(null)); expect(screen.queryByText('linked')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse' })); expect(screen.queryByText('newer-3')).toBeNull();
  view.rerender(thread('linked'));
  await waitFor(() => expect(screen.getByText('linked')).toHaveFocus());
  expect(screen.getByText('newer-3')).toBeInTheDocument();
});
