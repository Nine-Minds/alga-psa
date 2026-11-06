/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedAmpExport, { CoManagedAmpExportEntry } from '../../../components/co-managed/CoManagedAmpExport';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';

const mocks = vi.hoisted(() => ({ load: vi.fn(), enabled: true, loading: false, error: null as unknown, sessionId: 'session', status: 'authenticated' as string, identified: true }));
vi.mock('../../../lib/actions/coManagedAmpExportActions', () => ({ getCoManagedAmpExportScreenAction: mocks.load }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: () => ({ enabled: mocks.enabled && !mocks.loading && !mocks.error, admitted: mocks.enabled && !mocks.loading && !mocks.error, resolved: true }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: mocks.status, data: mocks.identified ? { session_id: mocks.sessionId, user: { id: 'admin', tenant: 'customer' } } : undefined }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));
const mount = () => render(<CoManagedFeatureBoundary mode="serves"><CoManagedAmpExport /></CoManagedFeatureBoundary>);

beforeEach(() => { vi.clearAllMocks(); Object.assign(mocks, { enabled: true, loading: false, error: null, sessionId: 'session', status: 'authenticated', identified: true }); mocks.load.mockResolvedValue({ workspaceName: 'Customer workspace' }); });
afterEach(cleanup);

it('hides the export entry when the capability is disabled or unresolved', () => {
  for (const state of [{ enabled: false }, { enabled: true, loading: true }, { error: new Error('unresolved') }]) {
    Object.assign(mocks, state); const view = render(<CoManagedAmpExportEntry />); expect(screen.queryByRole('link')).toBeNull(); view.unmount();
  }
});

it('downloads an AMP package through the native form without sending a passphrase', async () => {
  mount();
  await screen.findByText('Customer workspace');
  const form = document.querySelector('form')!;
  expect(form).toHaveAttribute('action', '/api/co-management/export');
  expect(form).toHaveAttribute('method', 'post');
  expect(form).toHaveAttribute('target', '_blank');
  expect([...new FormData(form).entries()]).toEqual([]);
  fireEvent.submit(form);
  expect(screen.getByRole('status')).toHaveTextContent('Your AMP download has started.');
});

it('shows a visible failure when the authorized export screen cannot be loaded', async () => {
  mocks.load.mockRejectedValueOnce(new Error('denied'));
  mount();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
