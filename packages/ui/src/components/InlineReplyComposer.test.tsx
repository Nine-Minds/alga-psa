/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InlineReplyComposer from './InlineReplyComposer';

vi.mock('../editor', () => ({
  TextEditor: ({ footerActions }: { footerActions?: React.ReactNode }) => (
    <>
      <textarea aria-label="Reply editor" />
      {footerActions}
    </>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('InlineReplyComposer', () => {
  it('T049: shows only the internal visibility switch and submits the inherited internal default', () => {
    const onSubmit = vi.fn();

    render(
      <InlineReplyComposer
        parentCommentId="comment-parent-1"
        roomName="reply-room"
        initialInternal={true}
        showInternalToggle={true}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />
    );

    expect(screen.getByText('Mark as Internal')).toBeTruthy();
    expect(screen.queryByText('Mark as Resolution')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      parentCommentId: 'comment-parent-1',
      isInternal: true,
    }));
  });

  it('T071: without the footer slot the composer is unchanged and Reply stays enabled', () => {
    const onSubmit = vi.fn();

    render(
      <InlineReplyComposer
        parentCommentId="comment-parent-1"
        roomName="reply-room"
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />
    );

    expect(screen.queryByTestId('footer-slot')).toBeNull();
    const reply = screen.getByRole('button', { name: 'Reply' }) as HTMLButtonElement;
    expect(reply.disabled).toBe(false);

    fireEvent.click(reply);
    // The payload callers already destructure keeps its exact shape.
    expect(onSubmit).toHaveBeenCalledWith({
      parentCommentId: 'comment-parent-1',
      content: expect.anything(),
      isInternal: false,
    });
  });

  it('T071: the footer slot renders in the editor footer and can block Reply', () => {
    render(
      <InlineReplyComposer
        parentCommentId="comment-parent-1"
        roomName="reply-room"
        footerActions={<span data-testid="footer-slot">Cc/Bcc</span>}
        submitDisabled
        onSubmit={vi.fn()}
        onCancel={() => undefined}
      />
    );

    expect(screen.getByTestId('footer-slot')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Reply' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
