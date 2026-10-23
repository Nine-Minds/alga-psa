/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RemoteAccessLinksManager from './RemoteAccessLinksManager';

const h = vi.hoisted(() => ({ list: vi.fn(), bulkDelete: vi.fn(), deleteOne: vi.fn(), save: vi.fn(), toastError: vi.fn() }));
vi.mock('../../actions/remoteAccessLinkActions', () => ({ listRemoteAccessLinks: h.list, deleteRemoteAccessLinks: h.bulkDelete, deleteRemoteAccessLink: h.deleteOne, saveRemoteAccessLink: h.save }));
vi.mock('react-hot-toast', () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, opts: any = {}) => Object.entries(opts).reduce((s, [k,v]) => k === 'defaultValue' ? String(v) : s.replace(`{{${k}}}`, String(v)), String(opts.defaultValue ?? key)) }) }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: ({ indeterminate, label, ...props }: any) => <input type="checkbox" aria-label={label ?? props['aria-label'] ?? props.id} data-indeterminate={indeterminate ? 'true' : 'false'} {...props} /> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: ({ isOpen, children, footer, title }: any) => isOpen ? <div><h2>{title}</h2>{children}{footer}</div> : null, DialogContent: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: ({ id, isOpen, message, onConfirm, confirmLabel }: any) => isOpen ? <div id={id}><p>{message}</p><button onClick={onConfirm}>{confirmLabel}</button></div> : null }));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({ DropdownMenu: ({ children }: any) => <div>{children}</div>, DropdownMenuTrigger: ({ children }: any) => children, DropdownMenuContent: ({ children }: any) => <div>{children}</div>, DropdownMenuItem: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/BulkActionBar', () => ({ BulkActionBar: ({ count, selectedLabel, actions }: any) => count ? <div><span>{selectedLabel}</span>{actions.map((a: any) => <button key={a.id} onClick={a.onClick}>{a.label}</button>)}</div> : null }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: ({ data, columns }: any) => <table><thead><tr>{columns.map((c: any, i: number) => <th key={i}>{c.title}</th>)}</tr></thead><tbody>{data.map((row: any) => <tr key={row.link_id}>{columns.map((c: any, i: number) => <td key={i}>{c.render ? c.render(row[c.dataIndex], row) : row[c.dataIndex]}</td>)}</tr>)}</tbody></table> }));

const rows = [
  { link_id: 'l1', tenant: 't', label: 'ScreenConnect', url_template: 'https://sc.example/{field.sc_session}' },
  { link_id: 'l2', tenant: 't', label: 'RDP', url_template: 'https://rdp.example/{asset.name}' },
];
beforeEach(() => { vi.clearAllMocks(); h.list.mockResolvedValue(rows); });
afterEach(cleanup);

describe('RemoteAccessLinksManager bulk selection', () => {
  it('selects rows and all rows, showing an indeterminate header for partial selection', async () => {
    render(<RemoteAccessLinksManager />);
    await screen.findByText('ScreenConnect');
    const head = screen.getByLabelText('Select all links') as HTMLInputElement;
    fireEvent.click(screen.getByLabelText('ScreenConnect'));
    expect(head.dataset.indeterminate).toBe('true');
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.click(head);
    expect((screen.getByLabelText('ScreenConnect') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('RDP') as HTMLInputElement).checked).toBe(true);
  });

  it('confirms bulk deletion with the count and toasts partial failures', async () => {
    h.bulkDelete.mockResolvedValue({ deletedIds: ['l1'], failedIds: ['l2'] });
    render(<RemoteAccessLinksManager />);
    await screen.findByText('ScreenConnect');
    fireEvent.click(screen.getByLabelText('Select all links'));
    fireEvent.click(screen.getAllByText('remoteAccess.links.delete').at(-1)!);
    expect(screen.getByText('Delete 2 selected remote access link(s)?')).toBeTruthy();
    fireEvent.click(document.querySelector('#remote-access-links-confirm-bulk-delete-dialog button')!);
    await waitFor(() => expect(h.bulkDelete).toHaveBeenCalledWith(['l1', 'l2']));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('remoteAccess.links.errors.partialDelete'));
  });
});
