/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientCoManagedIntegration from '../../../components/co-managed/CoManagedClientIntegration';

const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('@/lib/actions/coManagedActions', () => ({ getCoManagedClientManagement: mocks.load }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
vi.mock('../../../components/co-managed/CoManagedClientSummary', () => ({
  default: () => <div data-testid="summary" />,
}));
vi.mock('../../../components/co-managed/CoManagedClientView', () => ({
  default: () => <div data-testid="view" />,
}));
// The client Tickets slot renders the qualified list, not the retired standalone
// queue. Mocking the old module would silently pull the real component (and its
// server actions) into this render.
vi.mock('../../../components/co-managed/QualifiedTicketList', () => ({
  default: () => <div data-testid="tickets" />,
}));

const view = (over: Record<string, unknown> = {}) => ({
  clientId: 'client', clientName: 'Customer', selectionRequired: false, selectedRelationshipId: 'rel',
  relationships: [{
    relationshipId: 'rel', operationId: 'operation', state: 'active', ended: false, seats: 2, usedSeats: 1,
    workspaceName: 'Customer IT', administratorEmail: 'admin@example.test', canManage: true, canChangeSeats: false,
    canRetry: false, canCancel: false, invitationExpired: false, deliveryFailed: false,
  }],
  ...over,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function Harness(props: { clientId?: string; relationshipId?: string | null }) {
  return (
    <ClientCoManagedIntegration clientId={props.clientId ?? 'client'} clientName="Customer" idPrefix="instance"
      relationshipId={props.relationshipId}>
      {(slots) => (
        <div data-testid="slots" data-tab={slots?.tab?.id ?? 'none'}>
          {slots?.summary}
        </div>
      )}
    </ClientCoManagedIntegration>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.load.mockResolvedValue(view());
});
afterEach(cleanup);

describe('app-owned co-managed client integration', () => {
  it.each([
    ['disabled', { enabled: false, loading: false, error: null }],
    ['loading', { enabled: true, loading: true, error: null }],
    ['unknown', { enabled: undefined, loading: false, error: null }],
    ['error', { enabled: true, loading: false, error: new Error('unavailable') }],
  ])('renders the ordinary client with no feature slots or reads while %s', async (_name, flag) => {
    mocks.flag.mockReturnValue(flag);
    render(<Harness />);
    expect(screen.getByTestId('slots')).toHaveAttribute('data-tab', 'none');
    expect(screen.queryByTestId('summary')).toBeNull();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('supplies the summary and the stable co-managed tab once the flag and client read resolve', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('slots')).toHaveAttribute('data-tab', 'co-managed'));
    expect(mocks.load).toHaveBeenCalledWith('client', undefined);
    expect(screen.getByTestId('summary')).toBeInTheDocument();
  });

  it('falls back to the ordinary client when client read authority is denied or the read fails', async () => {
    mocks.load.mockRejectedValue(new Error('Forbidden'));
    render(<Harness />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    expect(screen.getByTestId('slots')).toHaveAttribute('data-tab', 'none');
    expect(screen.queryByTestId('summary')).toBeNull();
  });

  it('discards a stale response after the selected client or relationship changes', async () => {
    const first = deferred<ReturnType<typeof view>>();
    const second = deferred<ReturnType<typeof view>>();
    mocks.load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(<Harness relationshipId="a" />);
    rerender(<Harness relationshipId="b" />);
    await act(async () => { second.resolve(view({ selectedRelationshipId: 'rel-b' })); });
    await waitFor(() => expect(screen.getByTestId('slots')).toHaveAttribute('data-tab', 'co-managed'));
    await act(async () => { first.resolve(view({ selectedRelationshipId: 'rel-a' })); });
    expect(screen.getByTestId('slots')).toHaveAttribute('data-tab', 'co-managed');
    expect(mocks.load).toHaveBeenLastCalledWith('client', 'b');
  });

  it('drops a late response after unmount instead of restoring feature slots', async () => {
    const pending = deferred<ReturnType<typeof view>>();
    mocks.load.mockReturnValue(pending.promise);
    const { unmount } = render(<Harness />);
    unmount();
    await act(async () => { pending.resolve(view()); });
    expect(screen.queryByTestId('slots')).toBeNull();
  });
});
