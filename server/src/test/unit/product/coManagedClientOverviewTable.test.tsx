/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedClientOverviewTable from '../../../components/co-managed/CoManagedClientOverviewTable';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/actions/coManagedActions', () => ({ getCoManagedClientOverviewAction: mocks.load }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

const page = (over: Record<string, unknown> = {}) => ({
  rows: [{ clientId: 'client-1', clientName: 'Acme', relationshipId: 'rel-1', operationId: 'op-1', workspaceName: 'Acme IT',
    administratorEmail: 'admin@acme.test', state: 'active', ended: false, seats: 3, usedSeats: 2, invitationExpired: false,
    deliveryFailed: false, cleanupFailed: false, canManage: true, canRetry: false, canCancel: false }],
  totalCount: 1, page: 1, pageSize: 20, ...over,
});

beforeEach(() => { vi.resetAllMocks(); mocks.load.mockResolvedValue(page()); });
afterEach(cleanup);

describe('cross-client overview table', () => {
  it('links each authorized client row to its canonical co-managed section', async () => {
    render(<CoManagedClientOverviewTable />);
    const link = await screen.findByRole('link', { name: 'Acme' });
    expect(link).toHaveAttribute('href', '/msp/clients/client-1?tab=co-managed&relationshipId=rel-1');
    expect(mocks.load).toHaveBeenCalledWith({ search: '', page: 1, pageSize: 20 });
  });

  it('searches and paginates through the authorized query', async () => {
    mocks.load.mockResolvedValue(page({ totalCount: 40 }));
    render(<CoManagedClientOverviewTable />);
    await screen.findByRole('link', { name: 'Acme' });
    fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'Acme' } });
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ search: 'Acme', page: 1 })));
    fireEvent.click(document.getElementById('co-managed-overview-pagination-next-btn')!);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  });
});
