import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresenceBar } from './PresenceBar';

vi.mock('../components/AvatarIcon', () => ({
  default: ({ userId }: { userId: string }) => <div data-testid={`avatar-${userId}`} />,
}));

describe('PresenceBar', () => {
  afterEach(() => {
    cleanup();
  });

  it('T022: renders one presence chip per unique user id', () => {
    render(
      <PresenceBar
        users={[
          { id: 'user-1', name: 'User One' },
          { id: 'user-1', name: 'User One Duplicate' },
          { id: 'user-2', name: 'User Two' },
        ]}
        showNames
      />
    );

    expect(screen.getAllByTestId('presence-user')).toHaveLength(2);
    expect(screen.getByText('User One')).toBeTruthy();
    expect(screen.getByText('User Two')).toBeTruthy();
    expect(screen.queryByText('User One Duplicate')).toBeNull();
  });

  it('T023: exposes the display name as the hover tooltip text', () => {
    render(<PresenceBar users={[{ id: 'user-1', name: 'User One' }]} showNames />);

    expect(screen.getByTestId('presence-user').getAttribute('title')).toBe('User One');
  });
});
