/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketWatchListCard from '../TicketWatchListCard';
import { setTicketWatchListOnAttributes, type TicketWatchListEntry } from '@shared/lib/tickets/watchList';

function renderWatchListCard(args?: {
  initialAttributes?: Record<string, unknown> | null;
  onPersist?: (watchList: TicketWatchListEntry[]) => Promise<boolean>;
}) {
  const onPersist =
    args?.onPersist ??
    (async () => {
      return true;
    });

  function Wrapper() {
    const [attributes, setAttributes] = useState<Record<string, unknown> | null>(
      args?.initialAttributes ?? { watch_list: [] }
    );

    return (
      <TicketWatchListCard
        id="ticket-watch-list"
        attributes={attributes}
        onUpdateWatchList={async (watchList) => {
          const ok = await onPersist(watchList);
          if (ok) {
            setAttributes(setTicketWatchListOnAttributes(attributes, watchList));
          }
          return ok;
        }}
      />
    );
  }

  return render(<Wrapper />);
}

describe('TicketWatchListCard', () => {
  it('T011: renders Watch List card and existing watchers', () => {
    renderWatchListCard({
      initialAttributes: {
        watch_list: [
          { email: 'active@example.com', active: true },
          { email: 'inactive@example.com', active: false },
        ],
      },
    });

    expect(screen.getByText('Watch List')).toBeInTheDocument();
    expect(screen.getByText('active@example.com')).toBeInTheDocument();
    expect(screen.getByText('inactive@example.com')).toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('T012: adding a valid manual watcher triggers persistence callback and refreshes displayed list', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
    });

    await user.type(screen.getByPlaceholderText('name@example.com'), 'newwatch@example.com');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([
        { email: 'newwatch@example.com', active: true, source: 'manual' },
      ]);
    });
    expect(screen.getByText('newwatch@example.com')).toBeInTheDocument();
  });

  it('T013: adding invalid email shows validation error and does not persist', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
    });

    await user.type(screen.getByPlaceholderText('name@example.com'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('T014: adding existing inactive watcher reactivates instead of creating duplicate row', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: {
        watch_list: [{ email: 'reactivate@example.com', active: false, source: 'manual' }],
      },
      onPersist,
    });

    await user.type(screen.getByPlaceholderText('name@example.com'), 'REACTIVATE@example.com');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([
        { email: 'reactivate@example.com', active: true, source: 'manual' },
      ]);
    });

    expect(screen.getAllByText('reactivate@example.com')).toHaveLength(1);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('T015: unchecking watcher updates active=false and persists', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [{ email: 'toggle@example.com', active: true }] },
      onPersist,
    });

    await user.click(screen.getByRole('checkbox'));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([{ email: 'toggle@example.com', active: false }]);
    });
  });

  it('T016: checking inactive watcher updates active=true and persists', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [{ email: 'toggle@example.com', active: false }] },
      onPersist,
    });

    await user.click(screen.getByRole('checkbox'));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([{ email: 'toggle@example.com', active: true }]);
    });
  });

  it('T017: removing watcher deletes row and persists attribute update', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [{ email: 'remove@example.com', active: true }] },
      onPersist,
    });

    await user.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([]);
    });
    expect(screen.queryByText('remove@example.com')).not.toBeInTheDocument();
  });

  it('T018: watcher save controls disable while request is in-flight to prevent double submits', async () => {
    let resolvePersist: ((value: boolean) => void) | null = null;
    const onPersist = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePersist = resolve;
        })
    );
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [{ email: 'pending@example.com', active: true }] },
      onPersist,
    });

    await user.click(screen.getByRole('checkbox'));

    expect(screen.getByPlaceholderText('name@example.com')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /remove/i })).toBeDisabled();

    resolvePersist?.(true);
    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledTimes(1);
    });
  });

  it('T044: technician/internal email can be added manually and remains persisted active', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
    });

    await user.type(screen.getByPlaceholderText('name@example.com'), 'tech@internal.example');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([
        { email: 'tech@internal.example', active: true, source: 'manual' },
      ]);
    });

    expect(screen.getByText('tech@internal.example')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});
