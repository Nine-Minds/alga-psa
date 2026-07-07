/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const listTeamsDeliveriesMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../actions', () => ({
  listTeamsDeliveries: (...a: unknown[]) => listTeamsDeliveriesMock(...a),
}));

import { TeamsDeliveryLogViewer } from './TeamsDeliveryLogViewer';

function deliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant: 't1',
    delivery_id: 'del-1',
    internal_notification_id: 'notif-1',
    category: 'assignment',
    destination_type: 'user_activity',
    destination_id: 'user-1',
    attempt_number: 1,
    idempotency_key: 'k1',
    provider_message_id: 'pm1',
    status: 'delivered',
    error_code: null,
    error_message: null,
    retryable: null,
    provider_request_id: null,
    sent_at: null,
    delivered_at: null,
    responded_at: null,
    created_at: '2026-06-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('TeamsDeliveryLogViewer (F060)', () => {
  beforeEach(() => {
    listTeamsDeliveriesMock.mockReset();
  });
  afterEach(() => cleanup());

  it('T097: lists rows with status/category filters and cursor pagination', async () => {
    listTeamsDeliveriesMock.mockImplementation((params: any = {}) => {
      if (params.status === 'failed') {
        return Promise.resolve({ rows: [deliveryRow({ delivery_id: 'del-f', status: 'failed', error_code: 'graph_unauthorized', error_message: 'unauthorized' })], nextCursor: null });
      }
      if (params.cursor === 'cursor-1') {
        return Promise.resolve({ rows: [deliveryRow({ delivery_id: 'del-2', status: 'sent' })], nextCursor: null });
      }
      return Promise.resolve({ rows: [deliveryRow({ delivery_id: 'del-1', status: 'delivered' })], nextCursor: 'cursor-1' });
    });

    const user = userEvent.setup();
    render(<TeamsDeliveryLogViewer />);

    await waitFor(() => expect(listTeamsDeliveriesMock).toHaveBeenCalled());
    expect(document.querySelector('#teams-delivery-log-viewer')).toBeInTheDocument();
    expect(document.querySelector('#teams-delivery-status-filter')).toBeInTheDocument();
    expect(document.querySelector('#teams-delivery-category-filter')).toBeInTheDocument();

    // Cursor pagination: load-more appends the second page.
    await waitFor(() => expect(screen.getByRole('button', { name: /Load more/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Load more/i }));
    await waitFor(() => expect(listTeamsDeliveriesMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-1' })));

    // Status filter refetches scoped to the chosen status.
    await user.selectOptions(document.querySelector('#teams-delivery-status-filter') as HTMLSelectElement, 'failed');
    await waitFor(() => expect(listTeamsDeliveriesMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' })));
    expect(await screen.findByText('graph_unauthorized')).toBeInTheDocument();

    // Category filter refetches scoped to the chosen category.
    await user.selectOptions(document.querySelector('#teams-delivery-status-filter') as HTMLSelectElement, '');
    await user.selectOptions(document.querySelector('#teams-delivery-category-filter') as HTMLSelectElement, 'assignment');
    await waitFor(() => expect(listTeamsDeliveriesMock).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'assignment' })));
  });

  it('T098: renders the empty state when there are no rows for the current tenant', async () => {
    listTeamsDeliveriesMock.mockResolvedValue({ rows: [], nextCursor: null });
    render(<TeamsDeliveryLogViewer />);
    expect(await screen.findByText('No Teams deliveries recorded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Load more/i })).not.toBeInTheDocument();
  });

  it('T097/T098: renders a graceful permission message when the action is forbidden', async () => {
    listTeamsDeliveriesMock.mockRejectedValue(new Error('Forbidden'));
    render(<TeamsDeliveryLogViewer />);
    expect(await screen.findByText('You do not have permission to view the Teams delivery log.')).toBeInTheDocument();
    // Filters are hidden once forbidden.
    expect(document.querySelector('#teams-delivery-status-filter')).not.toBeInTheDocument();
  });
});
