/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactionDisplay } from '../ReactionDisplay';
import type { IAggregatedReaction } from '@alga-psa/types';

// Mock the EmojiPickerPopover to avoid loading emoji-mart in tests
vi.mock('../EmojiPickerPopover', () => ({
  EmojiPickerPopover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ALGA_EMOJI_ID: ':alga:',
}));

// Mock the Tooltip to just render children
vi.mock('../Tooltip', () => ({
  Tooltip: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
    <div data-testid="tooltip" title={String(content)}>{children}</div>
  ),
}));

describe('ReactionDisplay', () => {
  afterEach(() => cleanup());

  const mockToggle = vi.fn();
  const mockAdd = vi.fn();

  const sampleReactions: IAggregatedReaction[] = [
    { emoji: '\u{1F44D}', count: 3, userIds: ['user1', 'user2', 'user3'], currentUserReacted: true },
    { emoji: '\u{2764}\u{FE0F}', count: 1, userIds: ['user1'], currentUserReacted: false },
  ];

  it('renders reaction pills with emoji and count', () => {
    render(
      <ReactionDisplay
        id="test"
        reactions={sampleReactions}
        onToggle={mockToggle}
        onAdd={mockAdd}
      />
    );

    // Find the thumbs up reaction (count 3)
    const thumbsButton = screen.getByRole('button', { name: /\u{1F44D} 3 reaction/u });
    expect(thumbsButton).toBeTruthy();

    // Find the heart reaction (count 1)
    const heartButton = screen.getByRole('button', { name: /\u{2764}\u{FE0F} 1 reaction/u });
    expect(heartButton).toBeTruthy();
  });

  it('calls onToggle when a reaction pill is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ReactionDisplay
        id="test"
        reactions={sampleReactions}
        onToggle={mockToggle}
        onAdd={mockAdd}
      />
    );

    const thumbsButton = screen.getByRole('button', { name: /\u{1F44D} 3 reaction/u });
    await user.click(thumbsButton);

    expect(mockToggle).toHaveBeenCalledWith('\u{1F44D}');
  });

  it('shows add reaction button when no reactions exist', () => {
    render(
      <ReactionDisplay
        id="test"
        reactions={[]}
        onToggle={mockToggle}
        onAdd={mockAdd}
      />
    );

    const addButton = screen.getByLabelText('Add reaction');
    expect(addButton).toBeTruthy();
  });

  it('shows add reaction button alongside existing reactions', () => {
    render(
      <ReactionDisplay
        id="test"
        reactions={sampleReactions}
        onToggle={mockToggle}
        onAdd={mockAdd}
      />
    );

    const addButton = screen.getByLabelText('Add reaction');
    expect(addButton).toBeTruthy();
  });

  it('renders tooltip with user names', () => {
    const userNames = {
      user1: 'Alice',
      user2: 'Bob',
      user3: 'Charlie',
    };

    render(
      <ReactionDisplay
        id="test"
        reactions={sampleReactions}
        onToggle={mockToggle}
        onAdd={mockAdd}
        userNames={userNames}
      />
    );

    const tooltips = screen.getAllByTestId('tooltip');
    // First tooltip should contain user names for thumbs up
    expect(tooltips[0].getAttribute('title')).toContain('Alice');
    expect(tooltips[0].getAttribute('title')).toContain('Bob');
    expect(tooltips[0].getAttribute('title')).toContain('Charlie');
  });

  it('indicates current user reacted via aria-label', () => {
    render(
      <ReactionDisplay
        id="test"
        reactions={sampleReactions}
        onToggle={mockToggle}
        onAdd={mockAdd}
      />
    );

    // Thumbs up has currentUserReacted=true
    const thumbsButton = screen.getByRole('button', { name: /you reacted/i });
    expect(thumbsButton).toBeTruthy();
  });

  it('renders custom alga emoji as SVG', () => {
    const algaReaction: IAggregatedReaction[] = [
      { emoji: ':alga:', count: 2, userIds: ['user1', 'user2'], currentUserReacted: false },
    ];

    const { container } = render(
      <ReactionDisplay
        id="test"
        reactions={algaReaction}
        onToggle={mockToggle}
        onAdd={mockAdd}
      />
    );

    // Should render an SVG instead of text
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });
});
