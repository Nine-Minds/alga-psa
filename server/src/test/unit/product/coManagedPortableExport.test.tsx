/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedPortableExport, { CoManagedPortableExportEntry } from '../../../components/co-managed/CoManagedPortableExport';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ load: vi.fn(), enabled: true, loading: false, error: null as any, sessionId: 'session' }));
vi.mock('../../../lib/actions/coManagedPortableExportActions', () => ({ getCoManagedPortableExportScreenAction: mocks.load }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: () => ({ enabled: mocks.enabled && !mocks.loading && !mocks.error, admitted: mocks.enabled && !mocks.loading && !mocks.error, resolved: true }) }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { session_id: mocks.sessionId, user: { id: 'admin', tenant: 'customer' } } }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null }));
const mount = () => render(<CoManagedFeatureBoundary mode="serves"><CoManagedPortableExport /></CoManagedFeatureBoundary>);
beforeEach(() => { vi.clearAllMocks(); mocks.enabled = true; mocks.loading = false; mocks.error = null; mocks.sessionId = 'session'; mocks.load.mockResolvedValue({ workspaceName: 'Customer workspace' }); });
afterEach(cleanup);
it('does not load or reveal export controls when the presentation flag is disabled, loading or failed', () => {
  for (const state of [{ enabled: false }, { enabled: true, loading: true }, { loading: false, error: new Error('Flag unavailable') }]) {
    Object.assign(mocks, state); const view = mount(); expect(screen.queryByRole('button')).toBeNull(); view.unmount();
  }
  expect(mocks.load).not.toHaveBeenCalled();
});
it('validates recovery confirmation and posts only the passphrase using a native streamed download', async () => {
  mount(); await screen.findByText('Customer workspace');
  const passphrase = screen.getByLabelText('coManaged.portableExport.passphrase', { exact: false }), confirm = screen.getByLabelText('coManaged.portableExport.confirmPassphrase', { exact: false });
  const form = document.querySelector('form')!;
  fireEvent.change(passphrase, { target: { value: 'short' } }); fireEvent.change(confirm, { target: { value: 'short' } });
  expect(fireEvent.submit(form)).toBe(false); expect(screen.getByRole('alert')).toHaveTextContent('lengthError');
  fireEvent.change(passphrase, { target: { value: 'Customer recovery passphrase' } });
  expect(fireEvent.submit(form)).toBe(false); expect(screen.getByRole('alert')).toHaveTextContent('matchError');
  fireEvent.change(confirm, { target: { value: 'Customer recovery passphrase' } });
  expect(fireEvent.submit(form)).toBe(true);
  expect([...new FormData(form).entries()]).toEqual([['passphrase', 'Customer recovery passphrase']]);
  expect(form).toHaveAttribute('action', '/api/co-management/export'); expect(form).toHaveAttribute('method', 'post'); expect(form).toHaveAttribute('target', '_blank');
  expect(passphrase).toHaveAttribute('type', 'password'); expect(screen.getByRole('status')).toHaveTextContent('requested');
});
it('clears recovery inputs when the tracked session changes and hides controls on denied access', async () => {
  const view = mount(); await screen.findByText('Customer workspace');
  fireEvent.change(screen.getByLabelText('coManaged.portableExport.passphrase', { exact: false }), { target: { value: 'Do not retain across accounts' } });
  mocks.sessionId = 'new-session'; mocks.load.mockRejectedValue(new Error('Denied'));
  view.rerender(<CoManagedFeatureBoundary mode="serves"><CoManagedPortableExport /></CoManagedFeatureBoundary>);
  await screen.findByText('coManaged.portableExport.loadError'); expect(screen.queryByLabelText('coManaged.portableExport.passphrase', { exact: false })).toBeNull();
  expect(screen.queryByText('Customer workspace')).toBeNull();
});
it('renders an unavailable notice, not the form, when the edition has no export service', () => {
  render(<CoManagedPortableExport available={false} />);
  expect(screen.queryByRole('button')).toBeNull(); expect(mocks.load).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toBeTruthy();
});
it('the export entry renders a link for a served customer and nothing when the capability is off', () => {
  const view = render(<CoManagedPortableExportEntry />);
  expect(screen.getByRole('link')).toHaveAttribute('href', '/msp/co-management/export'); view.unmount();
  for (const state of [{ enabled: false }, { enabled: true, loading: true }, { enabled: true, error: new Error('x') }]) {
    Object.assign(mocks, state); const v = render(<CoManagedPortableExportEntry />); expect(screen.queryByRole('link')).toBeNull(); v.unmount();
  }
});
