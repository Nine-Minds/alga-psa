/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedLegacyRedirect from '../../../components/co-managed/CoManagedLegacyRedirect';

const mocks = vi.hoisted(() => ({ flag: vi.fn(), resolve: vi.fn(), replace: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('@/lib/actions/coManagedActions', () => ({ resolveCoManagedLegacyOperation: mocks.resolve }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, push: vi.fn() }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.resolve.mockResolvedValue({ clientId: 'client-1', relationshipId: 'rel-1', operationId: 'op-1' });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('legacy sponsor link adapter', () => {
  it('resolves an authorized operation to the canonical client, relationship, and section', async () => {
    render(<CoManagedLegacyRedirect operationId="op-1" section="sla"><div data-testid="legacy">Legacy</div></CoManagedLegacyRedirect>);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(1));
    expect(mocks.resolve).toHaveBeenCalledWith('op-1', undefined);
    expect(mocks.replace).toHaveBeenCalledWith('/msp/clients/client-1?tab=co-managed&relationshipId=rel-1&section=sla');
    expect(screen.queryByTestId('legacy')).toBeNull();
  });

  it('rejects a conflicting client selector without navigating away from the generic state', async () => {
    mocks.resolve.mockResolvedValue(null);
    render(<CoManagedLegacyRedirect operationId="op-1" clientId="other-client"><div /></CoManagedLegacyRedirect>);
    expect(await screen.findByRole('status')).toHaveTextContent('This co-managed link is unavailable.');
    expect(mocks.resolve).toHaveBeenCalledWith('op-1', 'other-client');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('performs no discovery while the release boundary is unavailable', () => {
    mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null });
    render(<CoManagedLegacyRedirect operationId="op-1"><div data-testid="legacy">Legacy</div></CoManagedLegacyRedirect>);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('legacy')).toBeNull();
  });

  it('leaves customer and selector-free routes on their existing presentation', () => {
    render(<CoManagedLegacyRedirect><div data-testid="legacy">Legacy</div></CoManagedLegacyRedirect>);
    expect(screen.getByTestId('legacy')).toBeInTheDocument();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('redirects a client-scoped overview link to the canonical client view', async () => {
    render(<CoManagedLegacyRedirect clientId="client-9"><div /></CoManagedLegacyRedirect>);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/msp/clients/client-9?tab=co-managed'));
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
