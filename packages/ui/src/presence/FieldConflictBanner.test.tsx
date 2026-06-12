/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldConflictBanner } from './FieldConflictBanner';

describe('FieldConflictBanner', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('T025: shows the remote value, author, relative timestamp, and accessible actions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:02:00.000Z'));

    const onKeepYours = vi.fn();
    const onTakeTheirs = vi.fn();

    render(
      <FieldConflictBanner
        remoteValue="Resolved"
        remoteAuthor="Bob"
        remoteAt="2026-05-07T12:00:00.000Z"
        onKeepYours={onKeepYours}
        onTakeTheirs={onTakeTheirs}
      />
    );

    const alert = screen.getByRole('alert');
    const keepYoursButton = screen.getByRole('button', { name: 'Keep yours' });
    const takeTheirsButton = screen.getByRole('button', { name: 'Take theirs' });

    expect(alert.textContent).toContain('Bob just changed this field 2 minutes ago.');
    expect(alert.textContent).toContain('Remote value: Resolved');
    expect(keepYoursButton).toBeTruthy();
    expect(takeTheirsButton).toBeTruthy();
    expect(document.activeElement).toBe(keepYoursButton);
  });
});
