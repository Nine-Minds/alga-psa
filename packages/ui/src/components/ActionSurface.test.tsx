// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionSurface, ActionTrigger } from './ActionSurface';
import { ContentCard, ContentCardFooter } from './ContentCard';
import HybridThreadNode from './HybridThreadNode';
import { buildCommentThreadGroups } from './CommentThreadList';

afterEach(cleanup);

describe('ActionTrigger', () => {
  it('renders as a button-bar button by default and as a text link inside a tile surface', () => {
    const onClick = vi.fn();
    const { rerender } = render(<ActionTrigger id="receive" label="Receive equipment" onClick={onClick} />);
    const bar = document.getElementById('receive')!;
    expect(bar.className).not.toContain('hover:underline');

    rerender(
      <ActionSurface kind="tile">
        <ActionTrigger id="receive" label="Receive equipment" onClick={onClick} />
      </ActionSurface>,
    );
    const link = document.getElementById('receive')!;
    expect(link.className).toContain('hover:underline');
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('ContentCardFooter', () => {
  it('is consumed by the nearest ContentCard only', () => {
    render(
      <ContentCardFooter footer={<span data-testid="host-footer">Receive equipment</span>}>
        <ContentCard id="outer">
          <ContentCard id="inner">
            <p>asset row</p>
          </ContentCard>
        </ContentCard>
      </ContentCardFooter>,
    );
    const footers = screen.getAllByTestId('host-footer');
    expect(footers).toHaveLength(1);
    expect(document.getElementById('inner')!.contains(footers[0])).toBe(false);
    expect(document.getElementById('outer')!.contains(footers[0])).toBe(true);
  });
});

describe('HybridThreadNode maxIndentDepth', () => {
  type C = { id: string; parent?: string; text: string };
  const comments: C[] = [
    { id: 'a', text: 'root' },
    { id: 'b', parent: 'a', text: 'reply' },
    { id: 'c', parent: 'b', text: 'reply to reply' },
  ];

  it('renders replies below the max depth flat at that depth', () => {
    const groups = buildCommentThreadGroups<C>({
      comments,
      getCommentId: (c) => c.id,
      getThreadId: () => 'a',
      getParentCommentId: (c) => c.parent ?? null,
      getCreatedAt: () => '2026-10-01T00:00:00.000Z',
    });
    const group = groups[0];
    render(
      <HybridThreadNode<C>
        group={group}
        comment={group.root}
        getCommentId={(c) => c.id}
        renderComment={(c) => <p>{c.text}</p>}
        maxIndentDepth={1}
      />,
    );
    // One indented level for the direct reply; the nested reply does not open another.
    expect(document.querySelectorAll('.thread-children')).toHaveLength(1);
    expect(screen.getByText('reply to reply')).toBeInTheDocument();
  });
});
