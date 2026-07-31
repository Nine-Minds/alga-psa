/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const listTeamsAuditEventsMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../actions', () => ({
  listTeamsAuditEvents: (...a: unknown[]) => listTeamsAuditEventsMock(...a),
}));

import { TeamsAuditLogViewer } from './TeamsAuditLogViewer';

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant: 't1',
    event_id: 'evt-1',
    actor_user_id: 'user-1',
    microsoft_user_id: 'aad-1',
    surface: 'bot',
    action_id: 'assign_ticket',
    target_type: 'ticket',
    target_id: 'tk-1',
    idempotency_key: 'k1',
    payload_hash: 'h1',
    result_status: 'success',
    error_code: null,
    created_at: '2026-06-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('TeamsAuditLogViewer (F061)', () => {
  beforeEach(() => {
    listTeamsAuditEventsMock.mockReset();
  });
  afterEach(() => cleanup());

  it('T099: lists mutation events with surface/action filters and pagination', async () => {
    listTeamsAuditEventsMock.mockImplementation((params: any = {}) => {
      if (params.surface === 'quick_action') {
        return Promise.resolve({ rows: [auditRow({ event_id: 'evt-qa', surface: 'quick_action' })], nextCursor: null });
      }
      if (params.action_id === 'add_note') {
        return Promise.resolve({ rows: [auditRow({ event_id: 'evt-2', action_id: 'add_note', result_status: 'failure', error_code: 'permission_denied' })], nextCursor: null });
      }
      if (params.cursor === 'cursor-1') {
        return Promise.resolve({ rows: [auditRow({ event_id: 'evt-2b' })], nextCursor: null });
      }
      return Promise.resolve({ rows: [auditRow({ event_id: 'evt-1', action_id: 'assign_ticket' })], nextCursor: 'cursor-1' });
    });

    const user = userEvent.setup();
    render(<TeamsAuditLogViewer />);

    await waitFor(() => expect(listTeamsAuditEventsMock).toHaveBeenCalledTimes(1));
    expect(document.querySelector('#teams-audit-log-viewer')).toBeInTheDocument();
    expect(document.querySelector('#teams-audit-surface-filter')).toBeInTheDocument();
    expect(document.querySelector('#teams-audit-action-filter')).toBeInTheDocument();

    // Surface filter refetches scoped to the surface.
    await user.selectOptions(document.querySelector('#teams-audit-surface-filter') as HTMLSelectElement, 'quick_action');
    await waitFor(() => expect(listTeamsAuditEventsMock).toHaveBeenLastCalledWith(expect.objectContaining({ surface: 'quick_action' })));

    // Action-id filter is applied on refresh.
    await user.type(document.querySelector('#teams-audit-action-filter') as HTMLInputElement, 'add_note');
    await user.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => expect(listTeamsAuditEventsMock).toHaveBeenLastCalledWith(expect.objectContaining({ action_id: 'add_note' })));
  });

  it('T099: renders the empty state when there are no audit events', async () => {
    listTeamsAuditEventsMock.mockResolvedValue({ rows: [], nextCursor: null });
    render(<TeamsAuditLogViewer />);
    expect(await screen.findByText('No Teams audit events recorded yet.')).toBeInTheDocument();
  });

  it('T099: renders a graceful permission message when the action is forbidden', async () => {
    listTeamsAuditEventsMock.mockRejectedValue(new Error('Forbidden'));
    render(<TeamsAuditLogViewer />);
    expect(await screen.findByText('You do not have permission to view the Teams audit log.')).toBeInTheDocument();
    expect(document.querySelector('#teams-audit-surface-filter')).not.toBeInTheDocument();
  });
});
