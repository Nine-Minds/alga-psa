/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedTicketSlaStatus from '../../../components/co-managed/CoManagedTicketSlaStatus';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../../lib/actions/coManagedSharedWorkActions', () => ({ getSharedTicketSlaAction: mocks.load }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: any) => typeof options === 'object' && options
    ? `${key}${options.time ? `:${options.time}` : ''}${options.date ? `:${options.date}` : ''}` : key }),
  useFormatters: () => ({ formatDate: (date: Date) => date.toISOString() }),
}));
const resource = { tenant: 'c', relationshipId: 'r', kind: 'ticket' as const, id: 't' };
const target = (over: object = {}) => ({ status: 'running', dueAt: '2026-10-27T10:00:00.000Z', completedAt: null, ...over });
const tracking = (over: object = {}) => ({ state: 'tracking', paused: false, elapsedMinutes: 75, response: target(), resolution: target({ dueAt: '2026-10-27T17:00:00.000Z' }), ...over });

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it('shows a running clock with elapsed and due time', async () => {
  mocks.load.mockResolvedValue({ msp: tracking() });
  render(<CoManagedTicketSlaStatus resource={resource} />);
  expect(await screen.findByText('sharedSla.state.running')).toBeInTheDocument();
  expect(screen.getByText('sharedSla.elapsed:sharedSla.duration.hoursMinutes')).toBeInTheDocument();
  expect(screen.getByText('sharedSla.dueAt:2026-10-27T10:00:00.000Z')).toBeInTheDocument();
  expect(mocks.load).toHaveBeenCalledWith(resource);
});
it('shows paused while the work is with the customer, without a due time', async () => {
  mocks.load.mockResolvedValue({ msp: tracking({ paused: true, response: target({ status: 'paused', dueAt: null }), resolution: target({ status: 'paused', dueAt: null }) }) });
  render(<CoManagedTicketSlaStatus resource={resource} />);
  expect(await screen.findByText('sharedSla.state.paused')).toBeInTheDocument();
  expect(screen.getAllByText('sharedSla.targetPaused')).toHaveLength(2);
  expect(screen.queryByText(/sharedSla\.dueAt/)).toBeNull();
});
it('shows breached, and met once the resolution completed', async () => {
  mocks.load.mockResolvedValue({ msp: tracking({ response: target({ status: 'breached' }) }) });
  const { unmount } = render(<CoManagedTicketSlaStatus resource={resource} />);
  expect(await screen.findByText('sharedSla.state.breached')).toBeInTheDocument();
  unmount();
  mocks.load.mockResolvedValue({ msp: tracking({ response: target({ status: 'completed', completedAt: '2026-10-27T09:30:00.000Z' }),
    resolution: target({ status: 'completed', completedAt: '2026-10-27T09:45:00.000Z' }) }) });
  render(<CoManagedTicketSlaStatus resource={resource} />);
  expect(await screen.findByText('sharedSla.state.met')).toBeInTheDocument();
});
it('shows one empty state when no obligation exists', async () => {
  mocks.load.mockResolvedValue({ msp: { state: 'not_started' }, customer: { state: 'not_configured' } });
  render(<CoManagedTicketSlaStatus resource={resource} />);
  expect(await screen.findByText('sharedSla.empty')).toBeInTheDocument();
  expect(screen.queryByText('sharedSla.state.running')).toBeNull();
});
it('shows an error alert when the display cannot be loaded and never renders raw ids', async () => {
  mocks.load.mockRejectedValue(new Error('nope'));
  render(<CoManagedTicketSlaStatus resource={resource} />);
  expect(await screen.findByText('sharedSla.loadError')).toBeInTheDocument();
  await waitFor(() => expect(document.body.textContent).not.toContain(resource.relationshipId + resource.id));
});
