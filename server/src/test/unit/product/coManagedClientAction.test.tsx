/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedClientAction from '../../../components/co-managed/CoManagedClientAction';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), allowed: vi.fn(), push: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../../../lib/actions/coManagedActions', () => ({ canOpenCoManagedClientProvisioning: mocks.allowed }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
const translate = (key: string) => key;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: translate }), useOptionalI18n: () => null }));
beforeEach(() => { vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null }); mocks.allowed.mockResolvedValue(true); });
afterEach(cleanup);
describe('client-linked co-management entry', () => {
  it('does not probe or expose the action when the release flag is off', () => {
    mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null }); render(<CoManagedClientAction clientId="client" />);
    expect(mocks.allowed).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
  });
  it('opens provisioning with the authorized client already selected', async () => {
    render(<CoManagedClientAction clientId="client" />); fireEvent.click(await screen.findByRole('button'));
    expect(mocks.allowed).toHaveBeenCalledWith('client'); expect(mocks.push).toHaveBeenCalledWith('/msp/co-managed?clientId=client');
  });
});
