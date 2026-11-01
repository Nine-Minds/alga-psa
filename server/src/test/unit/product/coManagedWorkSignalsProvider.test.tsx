/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ signals: vi.fn(), capability: { enabled: true, admitted: true, resolved: true }, product: { productCode: 'psa' } }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: () => mocks.capability }));
vi.mock('@/context/ProductContext', () => ({ useProduct: () => mocks.product }));
vi.mock('@/lib/actions/coManagedTicketQueueActions', () => ({ getCoManagedWorkSignalsAction: (...a: any[]) => mocks.signals(...a) }));

import { CoManagedWorkSignalsProvider, useCoManagedWorkSignals } from '@/components/co-managed/CoManagedWorkSignalsProvider';

function Probe() {
  const s = useCoManagedWorkSignals();
  return <p id="probe" data-available={String(s.available)} data-total={s.total}>{s.escalatedUnassigned}/{s.awaitingReply}</p>;
}
const mount = () => render(<CoManagedWorkSignalsProvider><Probe /></CoManagedWorkSignalsProvider>);

beforeEach(() => {
  mocks.signals.mockReset();
  mocks.capability = { enabled: true, admitted: true, resolved: true };
  mocks.product = { productCode: 'psa' };
});

describe('CoManagedWorkSignalsProvider', () => {
  it('reads the counts when the capability serves a PSA workspace with an assigned relationship', async () => {
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 2, signals: { escalatedUnassigned: 3, awaitingReply: 1 } });
    mount();
    await waitFor(() => expect(screen.getByText('3/1')).toBeInTheDocument());
    expect(document.getElementById('probe')).toHaveAttribute('data-available', 'true');
    expect(document.getElementById('probe')).toHaveAttribute('data-total', '4');
  });

  it('never calls the action when the capability is closed (neutral)', async () => {
    mocks.capability = { enabled: false, admitted: false, resolved: true };
    mount();
    await Promise.resolve();
    expect(mocks.signals).not.toHaveBeenCalled();
    expect(document.getElementById('probe')).toHaveAttribute('data-available', 'false');
  });

  it('never calls the action outside a PSA workspace', async () => {
    mocks.product = { productCode: 'algadesk' };
    mount();
    await Promise.resolve();
    expect(mocks.signals).not.toHaveBeenCalled();
  });

  it('is unavailable when the caller has no staff-assigned relationship', async () => {
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 0, signals: { escalatedUnassigned: 5, awaitingReply: 5 } });
    mount();
    await waitFor(() => expect(mocks.signals).toHaveBeenCalled());
    expect(document.getElementById('probe')).toHaveAttribute('data-available', 'false');
  });

  it('a failed read leaves the context empty', async () => {
    mocks.signals.mockRejectedValue(new Error('boom'));
    mount();
    await waitFor(() => expect(mocks.signals).toHaveBeenCalled());
    expect(document.getElementById('probe')).toHaveAttribute('data-available', 'false');
  });
});
