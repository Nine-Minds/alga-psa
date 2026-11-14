// @vitest-environment jsdom
/** T031: the manage-keys dialog shows a new key exactly once, and revokes / rotates keys. */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interpolate } from './spTestHarness';

const m = vi.hoisted(() => ({ list: vi.fn(), issue: vi.fn(), rotate: vi.fn(), revoke: vi.fn() }));

const stableT = vi.hoisted(() => ({ t: (key: string, options?: { defaultValue?: string } & Record<string, unknown>) =>
  String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, n) => String(options?.[n] ?? '')) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => stableT,
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString().slice(0, 10) }),
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/actions/service-principal-actions', () => ({
  listServicePrincipalKeysAction: m.list,
  issueServicePrincipalKeyAction: m.issue,
  rotateServicePrincipalKeyAction: m.rotate,
  revokeServicePrincipalKeyAction: m.revoke,
}));

import { ServicePrincipalKeysDialog } from '../../../components/service-principals/ServicePrincipalKeysDialog';

const KEY = (id: string, overrides = {}) => ({
  api_key_id: id,
  description: `key ${id}`,
  active: true,
  expires_at: null,
  last_used_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const renderDialog = (canIssue = true) =>
  render(
    <ServicePrincipalKeysDialog
      principal={{ user_id: 'user-1', name: 'Billing sync' }}
      canIssue={canIssue}
      onClose={vi.fn()}
      onChanged={vi.fn()}
    />,
  );

beforeEach(() => {
  Object.values(m).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
  m.list.mockResolvedValue([KEY('k1')]);
});
afterEach(cleanup);

describe('T031 manage keys dialog', () => {
  it('shows the plaintext once on create, and never again after closing', async () => {
    m.issue.mockResolvedValue({ api_key_id: 'k2', api_key: 'plaintext-secret-123', description: 'x', expires_at: null });
    renderDialog();
    await screen.findByText('key k1');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ci' } });
    await screen.findByDisplayValue('ci');
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect((await screen.findByTestId('service-principal-key-value')).textContent).toBe('plaintext-secret-123');
    expect(screen.getByText(/will not be shown again/)).toBeTruthy();
    expect(m.issue).toHaveBeenCalledWith('user-1', { description: 'ci' });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByTestId('service-principal-key-value')).toBeNull());
    expect(document.body.textContent).not.toContain('plaintext-secret-123');
  });

  it('rotate reveals the replacement key with the grace-period note', async () => {
    m.rotate.mockResolvedValue({ api_key_id: 'k3', api_key: 'rotated-secret-456', description: 'x', expires_at: null });
    renderDialog();
    await screen.findByText('key k1');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    expect((await screen.findByTestId('service-principal-key-value')).textContent).toBe('rotated-secret-456');
    expect(screen.getByTestId('service-principal-rotation-note')).toBeTruthy();
    expect(m.rotate).toHaveBeenCalledWith('user-1', 'k1', {});
  });

  it('revoke asks for confirmation, then revokes', async () => {
    renderDialog();
    await screen.findByText('key k1');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Revoke API key?')).toBeTruthy();
    expect(m.revoke).not.toHaveBeenCalled();
    const confirm = screen.getAllByRole('button', { name: 'Revoke' }).pop() as HTMLElement;
    fireEvent.click(confirm);
    await waitFor(() => expect(m.revoke).toHaveBeenCalledWith('user-1', 'k1'));
  });

  it('does not offer create or rotate when the tier no longer allows issuing', async () => {
    renderDialog(false);
    await screen.findByText('key k1');
    expect(screen.queryByRole('button', { name: 'Create key' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rotate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy();
  });
});
