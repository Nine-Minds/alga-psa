// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({ get: vi.fn(), depart: vi.fn() }));
vi.mock('@/lib/actions/coManagedDepartureActions', () => ({ getCoManagedDeparture: actions.get, departFromCoManagedRelationship: actions.depart }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Stable identities, like the real hook: an unstable `t` would re-run the component's load effect.
  const t = (k: string, o?: any) => {
    const raw = (o?.count === 1 ? o.defaultValue_one : o?.count !== undefined ? o.defaultValue_other : undefined) ?? o?.defaultValue ?? k;
    return raw.replace(/\{\{(\w+)\}\}/g, (_m: string, key: string) => String(o?.[key]));
  };
  const translation = { t }, formatters = { formatDate: (d: Date) => d.toISOString().slice(0, 10) };
  return { useTranslation: () => translation, useFormatters: () => formatters };
});

import CoManagedDeparture from '@/components/co-managed/CoManagedDeparture';

const review = (extra: object = {}) => ({ ok: true, review: { side: 'sponsor', relationshipId: '11111111-1111-4111-8111-111111111111', revision: 4,
  counterpartName: 'Acme Corp', departed: false, closedAt: null, outstandingHandoffs: 0, seatsToRelease: 3, ...extra } });

beforeEach(() => { actions.get.mockReset(); actions.depart.mockReset(); });
afterEach(cleanup);

describe('CoManagedDeparture (A1)', () => {
  it('names the counterpart and the seats, never an id', async () => {
    actions.get.mockResolvedValue(review());
    const { container } = render(<CoManagedDeparture clientId="22222222-2222-4222-8222-222222222222" />);
    expect(await screen.findByText(/End co-managed IT for Acme Corp/)).toBeInTheDocument();
    expect(screen.getByText('3 seats will be released.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('outstanding handoffs warn but do not block the end button', async () => {
    actions.get.mockResolvedValue(review({ outstandingHandoffs: 2 }));
    render(<CoManagedDeparture />);
    expect(await screen.findByText(/2 shared tickets are still with the MSP/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End relationship' })).toBeEnabled();
  });

  it('confirming ends the relationship with the reviewed revision and one retry key across a retry', async () => {
    actions.get.mockResolvedValue(review());
    actions.depart.mockResolvedValueOnce({ ok: false, reason: 'changed' }).mockResolvedValue({ ok: true, releasedSeats: 3, closedAt: '2026-10-31T00:00:00.000Z' });
    render(<CoManagedDeparture />);
    fireEvent.click(await screen.findByRole('button', { name: 'End relationship' }));
    await waitFor(() => expect(document.getElementById('co-managed-departure-confirm-confirm')).not.toBeNull());
    fireEvent.click(document.getElementById('co-managed-departure-confirm-confirm')!);
    await waitFor(() => expect(actions.depart).toHaveBeenCalled());
    expect(actions.depart.mock.calls[0][0]).toMatchObject({ expectedRevision: 4, relationshipId: '11111111-1111-4111-8111-111111111111' });
    await waitFor(() => expect(document.body.textContent).toMatch(/changed while you were reviewing/));
  });

  it('an ended relationship offers no end control and shows when it ended', async () => {
    actions.get.mockResolvedValue(review({ departed: true, closedAt: '2026-10-01T00:00:00.000Z', counterpartName: null, seatsToRelease: 0 }));
    render(<CoManagedDeparture />);
    expect(await screen.findByText('This relationship ended 2026-10-01.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End relationship' })).toBeNull();
  });

  it('an unauthorized party sees a refusal and no review', async () => {
    actions.get.mockResolvedValue({ ok: false, reason: 'denied' });
    render(<CoManagedDeparture />);
    expect(await screen.findByText(/do not have permission to end this relationship/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End relationship' })).toBeNull();
  });

  it('after a successful departure shows the ended state and does not reload (a sponsor would get not_found)', async () => {
    actions.get.mockResolvedValueOnce(review()).mockResolvedValue({ ok: false, reason: 'not_found' });
    actions.depart.mockResolvedValue({ ok: true, releasedSeats: 3, closedAt: '2026-10-31T00:00:00.000Z' });
    render(<CoManagedDeparture />);
    fireEvent.click(await screen.findByRole('button', { name: 'End relationship' }));
    await waitFor(() => expect(document.getElementById('co-managed-departure-confirm-confirm')).not.toBeNull());
    fireEvent.click(document.getElementById('co-managed-departure-confirm-confirm')!);
    expect(await screen.findByText('This relationship ended 2026-10-31.')).toBeInTheDocument();
    expect(document.getElementById('co-managed-departure-done')).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/could not be found/);
    expect(screen.queryByRole('button', { name: 'End relationship' })).toBeNull();
    expect(actions.get).toHaveBeenCalledTimes(1);
  });

  it('a thrown action shows a generic error, resets the retry key and keeps the review', async () => {
    actions.get.mockResolvedValue(review());
    actions.depart.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ok: true, releasedSeats: 3, closedAt: '2026-10-31T00:00:00.000Z' });
    render(<CoManagedDeparture />);
    const end = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'End relationship' }));
      await waitFor(() => expect(document.getElementById('co-managed-departure-confirm-confirm')).not.toBeNull());
      fireEvent.click(document.getElementById('co-managed-departure-confirm-confirm')!);
    };
    await end();
    expect(await screen.findByText('The request could not be processed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End relationship' })).toBeEnabled();
    await end();
    await waitFor(() => expect(actions.depart).toHaveBeenCalledTimes(2));
    expect(actions.depart.mock.calls[1][0].operationId).not.toBe(actions.depart.mock.calls[0][0].operationId);
  });
});
