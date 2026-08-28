// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  listTenantSecrets: vi.fn(),
  getTenantSecretStoragePosture: vi.fn(),
  getSecretUsage: vi.fn(),
}));

vi.mock('@alga-psa/tenancy/actions/tenant-secret-actions', () => ({
  listTenantSecrets: actions.listTenantSecrets,
  getTenantSecretStoragePosture: actions.getTenantSecretStoragePosture,
  getSecretUsage: actions.getSecretUsage,
  deleteSecret: vi.fn(),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ handleError: vi.fn(), isActionMessageError: () => false, isActionPermissionError: () => false }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('lucide-react', () => ({ Plus: () => null, Trash2: () => null, Edit: () => null, Key: () => null, AlertTriangle: () => null, Search: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: any) => <section>{children}</section> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: ({ children }: any) => <div>{children}</div>, DialogContent: ({ children }: any) => <div>{children}</div>, DialogHeader: ({ children }: any) => <div>{children}</div>, DialogTitle: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: ({ data, columns }: any) => <div>{data.flatMap((row: any) => columns.map((column: any) => <React.Fragment key={`${row.id}-${column.dataIndex}`}>{column.render ? column.render(row[column.dataIndex], row) : row[column.dataIndex]}</React.Fragment>))}</div> }));
vi.mock('../../../components/settings/secrets/SecretDialog', () => ({ default: () => null }));

import SecretsManagement from '../../../components/settings/secrets/SecretsManagement';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function arrange({ permissionDenied = false, writable = true, reason }: { permissionDenied?: boolean; writable?: boolean; reason?: 'NO_DURABLE_PATH' | 'READ_ONLY_PROVIDER' } = {}) {
  actions.listTenantSecrets.mockResolvedValue({ permissionDenied, secrets: [{ id: 'secret-1', name: 'API_KEY', updatedAt: '2026-01-01', createdAt: '2026-01-01' }] });
  actions.getTenantSecretStoragePosture.mockResolvedValue({ writable, reason });
  actions.getSecretUsage.mockResolvedValue(new Map());
}

describe('SecretsManagement durability and permission guards', () => {
  it('shows the durable-storage notice and disables every mutation when filesystem storage is not configured', async () => {
    arrange({ writable: false, reason: 'NO_DURABLE_PATH' });
    render(<SecretsManagement />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('errors.secrets.noDurablePath'));
    expect(screen.getByRole('button', { name: 'secrets.list.createSecret' })).toBeDisabled();
    expect(document.getElementById('edit-secret-API_KEY')).toBeDisabled();
    expect(document.getElementById('delete-secret-API_KEY')).toBeDisabled();
  });

  it('shows the no-permission state and does not fetch usage or expose mutations', async () => {
    arrange({ permissionDenied: true, writable: true });
    render(<SecretsManagement />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('secrets.messages.permissionDenied'));
    expect(actions.getSecretUsage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'secrets.list.createSecret' })).toBeDisabled();
    expect(document.getElementById('edit-secret-API_KEY')).toBeDisabled();
    expect(document.getElementById('delete-secret-API_KEY')).toBeDisabled();
  });
});
