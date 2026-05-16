/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InlineReplyComposer from './InlineReplyComposer';

vi.mock('../editor', () => ({
  TextEditor: () => <textarea aria-label="Reply editor" />,
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
});
