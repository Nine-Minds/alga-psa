// @vitest-environment jsdom
/**
 * T011: UniFi credentials panel. List shows labels/modes/consoles/last error (never ids),
 * the unreachable-console guidance renders, and removing a key that has mapped sites is
 * confirmed before it is repeated with confirm:true.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UniFiCredentialsPanel from '@ee/components/settings/integrations/UniFiCredentialsPanel';

const m = vi.hoisted(() => ({
  addUniFiCredential: vi.fn(),
  removeUniFiCredential: vi.fn(),
  replaceUniFiCredentialKey: vi.fn(),
  saveUniFiConfiguration: vi.fn(),
  updateUniFiCredential: vi.fn(),
}));

vi.mock('@ee/lib/actions/integrations/uniFiActions', () => m);
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string; [k: string]: unknown }) =>
    (options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_x, name) => String(options?.[name] ?? ''));
  return { useTranslation: () => ({ t }) };
});
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id }: any) => <div role="alert" id={id}>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, variant: _v, ...props }: any) => <button id={id} {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, onConfirm, message, title }: any) =>
    isOpen ? (
      <div role="dialog">
        <h3>{title}</h3>
        {message}
        <button id="confirm-yes" onClick={onConfirm}>confirm</button>
      </div>
    ) : null,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: any) => (isOpen ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, id, onClick, className: _c }: any) => (
    <button id={id} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => (
    <table>
      <tbody>
        {data.map((row: any) => (
          <tr key={row.credentialId}>
            {columns.map((col: any, i: number) => (
              <td key={i}>{col.render ? col.render(row[col.dataIndex], row) : String(row[col.dataIndex] ?? '')}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

const item = (over: Record<string, unknown> = {}) => ({
  credentialId: 'cred-uuid-1111',
  label: 'Acme fabric',
  mode: 'site_manager' as const,
  status: 'active' as const,
  consoles: ['Branch UDM'],
  lastError: null,
  lastCheckedAt: null,
  ...over,
});

describe('UniFiCredentialsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists labels, kind and consoles without ever rendering ids', () => {
    const { container } = render(
      <UniFiCredentialsPanel
        items={[item(), item({ credentialId: 'cred-uuid-2222', label: 'Independent', consoles: [], lastError: 'Key rejected' })]}
        unreachableConsoles={[]}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />
    );
    expect(screen.getByText('Acme fabric')).toBeTruthy();
    expect(screen.getByText('Branch UDM')).toBeTruthy();
    expect(screen.getByText('None yet')).toBeTruthy();
    expect(screen.getByText('Key rejected')).toBeTruthy();
    expect(container.textContent).not.toContain('cred-uuid');
  });

  it('shows the add-a-fabric-key guidance for unreachable consoles', () => {
    render(
      <UniFiCredentialsPanel items={[item()]} unreachableConsoles={[{ name: 'Locked Fabric UDM' }]} onChanged={vi.fn()} onError={vi.fn()} />
    );
    expect(screen.getByText('Locked Fabric UDM')).toBeTruthy();
    expect(screen.getByText(/add a key created under that fabric/)).toBeTruthy();
  });

  it('asks for confirmation before removing a key that mapped sites depend on', async () => {
    m.removeUniFiCredential
      .mockResolvedValueOnce({ success: true, requiresConfirmation: true, affectedSites: ['Branch Site'] })
      .mockResolvedValueOnce({ success: true });
    const onChanged = vi.fn();
    const { container } = render(
      <UniFiCredentialsPanel items={[item()]} unreachableConsoles={[]} onChanged={onChanged} onError={vi.fn()} />
    );

    fireEvent.click(container.querySelector('#unifi-remove-key-cred-uuid-1111')!);
    await waitFor(() => expect(screen.getByText('Branch Site')).toBeTruthy());
    expect(m.removeUniFiCredential).toHaveBeenCalledTimes(1);
    expect(m.removeUniFiCredential).toHaveBeenLastCalledWith({ credentialId: 'cred-uuid-1111' });
    expect(onChanged).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('#confirm-yes')!);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(m.removeUniFiCredential).toHaveBeenLastCalledWith({ credentialId: 'cred-uuid-1111', confirm: true });
  });

  it('removes immediately when no mapped site depends on the key', async () => {
    m.removeUniFiCredential.mockResolvedValue({ success: true });
    const onChanged = vi.fn();
    const { container } = render(
      <UniFiCredentialsPanel items={[item()]} unreachableConsoles={[]} onChanged={onChanged} onError={vi.fn()} />
    );
    fireEvent.click(container.querySelector('#unifi-remove-key-cred-uuid-1111')!);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(m.removeUniFiCredential).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('surfaces invalid mappings without reporting removal success (confirmed=%s)', async (confirmed) => {
    const error = 'A mapped UniFi site has an invalid stored scope. Repair or unmap invalid site mappings in this integration before removing this key.';
    if (confirmed) {
      m.removeUniFiCredential.mockResolvedValueOnce({
        success: true, requiresConfirmation: true, affectedSites: ['Branch Site'],
      });
    }
    m.removeUniFiCredential.mockResolvedValueOnce({ success: false, error });
    const onChanged = vi.fn();
    const onError = vi.fn();
    const { container } = render(
      <UniFiCredentialsPanel items={[item()]} unreachableConsoles={[]} onChanged={onChanged} onError={onError} />
    );
    fireEvent.click(container.querySelector('#unifi-remove-key-cred-uuid-1111')!);
    if (confirmed) {
      await waitFor(() => expect(screen.getByText('Branch Site')).toBeTruthy());
      fireEvent.click(container.querySelector('#confirm-yes')!);
    }
    await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    expect(onChanged).not.toHaveBeenCalled();
    expect(m.removeUniFiCredential).toHaveBeenCalledTimes(confirmed ? 2 : 1);
  });

  it('surfaces a rejected add through onError and keeps the form', async () => {
    m.addUniFiCredential.mockResolvedValue({ success: false, error: 'UniFi rejected this key' });
    const onError = vi.fn();
    const { container } = render(
      <UniFiCredentialsPanel items={[item()]} unreachableConsoles={[]} onChanged={vi.fn()} onError={onError} />
    );
    fireEvent.click(container.querySelector('#unifi-add-key')!);
    fireEvent.change(container.querySelector('#unifi-new-label')!, { target: { value: 'Second' } });
    fireEvent.change(container.querySelector('#unifi-new-key')!, { target: { value: 'k' } });
    fireEvent.click(container.querySelector('#unifi-add-key-submit')!);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('UniFi rejected this key'));
    expect(container.querySelector('#unifi-new-label')).toBeTruthy();
  });
});
