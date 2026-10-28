// @vitest-environment jsdom
// T029: the warranty panel offers exactly the actions the state machine allows for each status.

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RmaWarrantyPanel } from './RmaWarrantyPanel';
import { WARRANTY_ACTIONS, allowedWarrantyActions, nextWarrantyStatus } from '../../lib/rma/stateMachine';

vi.mock('../../actions', () => {
  const fn = () => vi.fn(async () => ({}));
  return {
    approveWarrantyClaim: fn(), cancelWarrantyClaim: fn(), closeWarrantyRma: fn(), denyWarrantyClaim: fn(),
    markDeviceReceived: fn(), receiveVendorReplacement: fn(), recordVendorCredit: fn(), recordVendorRepair: fn(),
    returnDeviceToClient: fn(), shipToVendor: fn(),
    listRmaCaseEvents: vi.fn(async () => []),
  };
});
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, fallback?: string, values?: Record<string, unknown>) =>
    (fallback ?? key).replace(/{{(\w+)}}/g, (_m, n) => String(values?.[n] ?? ''));
  return { useTranslation: () => ({ t }) };
});
vi.mock('@alga-psa/ui/components/labels/useLabelPrint', () => ({
  useLabelPrint: () => ({ print: vi.fn(), isPrinting: false }),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: React.forwardRef<HTMLButtonElement, any>(({ children, variant, size, ...props }, ref) => <button ref={ref} {...props}>{children}</button>),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: () => null }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: () => null }));
vi.mock('@alga-psa/ui/components/TextArea', () => ({ TextArea: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  // The real component always renders a "nothing selected" row for `placeholder` (even when
  // `options` has no `value: ''` entry of its own); without an `<option value="">` here, a native
  // <select> would silently fall back to selecting the first real option instead.
  default: ({ id, value, placeholder, options, onValueChange }: any) => (
    <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">{placeholder ?? ''}</option>
      {options?.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));

afterEach(cleanup);

const STATUSES = [
  'warranty_review', 'open', 'awaiting_return', 'returned', 'sent_to_vendor', 'replacement_received',
  'replacement_deployed', 'dead_unit_owed', 'replaced', 'repaired', 'credited', 'charged', 'closed',
] as const;

const base = {
  rma_id: '0e7f4c70-0000-4000-8000-000000000001',
  rma_number: 'RMA-00007',
  rma_reference: 'VND-1',
  rma_type: 'standard',
  returned_unit_id: null,
  asset_id: 'a1b2c3d4-0000-4000-8000-000000000002',
  asset_name: 'Dell Laptop',
  asset_serial_number: 'SN123',
  ticket_id: 'a1b2c3d4-0000-4000-8000-000000000003',
  ticket_number: 'T-100',
  client_name: 'Acme',
  vendor_name: 'Dell',
  warranty_outcome: 'covered',
  return_by: '2026-12-01',
  outbound_carrier: 'UPS',
  outbound_tracking_number: '1Z999',
};

const renderedActions = () =>
  Array.from(document.querySelectorAll('#rma-warranty-actions button'))
    .map((b) => b.id)
    .filter((id) => id.startsWith('rma-warranty-action-'))
    .map((id) => id.replace('rma-warranty-action-', ''))
    .sort();

describe('RmaWarrantyPanel (T029)', () => {
  it.each(STATUSES)('status %s offers exactly the state-machine actions', (status) => {
    render(<RmaWarrantyPanel rma={{ ...base, status } as any} vendors={[]} locations={[]} onChanged={vi.fn()} />);
    const expected = [...allowedWarrantyActions(status as any)].sort();
    expect(renderedActions()).toEqual(expected);
    for (const a of expected) expect(nextWarrantyStatus(status as any, a)).not.toBeNull();
    for (const a of WARRANTY_ACTIONS.filter((x) => !expected.includes(x))) {
      expect(document.getElementById(`rma-warranty-action-${a}`)).toBeNull();
    }
  });

  it('warranty_review offers approve/deny/cancel and never a generic close', () => {
    render(<RmaWarrantyPanel rma={{ ...base, status: 'warranty_review' } as any} vendors={[]} locations={[]} onChanged={vi.fn()} />);
    expect(renderedActions()).toEqual(['approve_advance', 'approve_standard', 'cancel', 'deny']);
  });

  it('shows decision, vendor case, shipping, return-by and links to asset and ticket', () => {
    render(<RmaWarrantyPanel rma={{ ...base, status: 'sent_to_vendor' } as any} vendors={[]} locations={[]} onChanged={vi.fn()} />);
    const text = document.getElementById('rma-warranty-panel')!.textContent!;
    expect(text).toContain('Covered');
    expect(text).toContain('VND-1');
    expect(text).toContain('UPS · 1Z999');
    expect(document.getElementById('rma-warranty-asset-link')!.getAttribute('href')).toContain(base.asset_id);
    expect(document.getElementById('rma-warranty-ticket-link')!.getAttribute('href')).toContain(base.ticket_id);
    expect(screen.getByText(/Ticket: T-100/)).toBeTruthy();
  });

  it('exposes print actions, and the mirror action only with a ticket, a composition callback and a reference', () => {
    const { unmount } = render(<RmaWarrantyPanel rma={{ ...base, status: 'open' } as any} vendors={[]} locations={[]} onChanged={vi.fn()} />);
    expect(document.getElementById('rma-warranty-print-tag')).toBeTruthy();
    expect(document.getElementById('rma-warranty-print-slip')).toBeTruthy();
    expect(document.getElementById('rma-warranty-mirror-ticket')).toBeNull();
    unmount();
    render(<RmaWarrantyPanel rma={{ ...base, status: 'open' } as any} vendors={[]} locations={[]} onChanged={vi.fn()} onMirrorToTicket={vi.fn()} />);
    expect(document.getElementById('rma-warranty-mirror-ticket')).toBeTruthy();
    cleanup();
    render(<RmaWarrantyPanel rma={{ ...base, ticket_id: null, status: 'open' } as any} vendors={[]} locations={[]} onChanged={vi.fn()} onMirrorToTicket={vi.fn()} />);
    expect(document.getElementById('rma-warranty-mirror-ticket')).toBeNull();
    expect(document.getElementById('rma-warranty-ticket-link')).toBeNull();
  });

  it('shows the vendor-case system picker only when systems are supplied, and passes the selection to onMirrorToTicket', () => {
    const onMirror = vi.fn(async () => undefined);
    const { unmount } = render(<RmaWarrantyPanel rma={{ ...base, status: 'open' } as any} vendors={[]} locations={[]} onChanged={vi.fn()} onMirrorToTicket={onMirror} />);
    expect(document.getElementById('rma-warranty-mirror-system')).toBeNull();
    fireEvent.click(document.getElementById('rma-warranty-mirror-ticket')!);
    expect(onMirror).toHaveBeenLastCalledWith(expect.anything(), undefined);
    unmount();

    render(
      <RmaWarrantyPanel
        rma={{ ...base, status: 'open' } as any}
        vendors={[]}
        locations={[]}
        onChanged={vi.fn()}
        onMirrorToTicket={onMirror}
        vendorCaseSystems={[{ key: 'custom:dell', label: 'Dell portal' }]}
      />,
    );
    const picker = document.getElementById('rma-warranty-mirror-system') as HTMLSelectElement;
    expect(picker).toBeTruthy();
    fireEvent.change(picker, { target: { value: 'custom:dell' } });
    fireEvent.click(document.getElementById('rma-warranty-mirror-ticket')!);
    expect(onMirror).toHaveBeenLastCalledWith(expect.objectContaining({ rma_id: base.rma_id }), 'custom:dell');
  });

  it('reopens the picker on the already-mirrored system instead of resetting to generic', () => {
    const onMirror = vi.fn(async () => undefined);
    const systems = [{ key: 'custom:dell', label: 'Dell portal' }];

    // Known at first render (e.g. the caller already resolved it before mounting this panel).
    const { unmount } = render(
      <RmaWarrantyPanel
        rma={{ ...base, status: 'open' } as any}
        vendors={[]}
        locations={[]}
        onChanged={vi.fn()}
        onMirrorToTicket={onMirror}
        vendorCaseSystems={systems}
        selectedVendorCaseSystem="custom:dell"
      />,
    );
    expect((document.getElementById('rma-warranty-mirror-system') as HTMLSelectElement).value).toBe('custom:dell');
    fireEvent.click(document.getElementById('rma-warranty-mirror-ticket')!);
    expect(onMirror).toHaveBeenLastCalledWith(expect.anything(), 'custom:dell');
    unmount();
    cleanup();

    // Resolved asynchronously after mount (the real composition-root lookup): the picker must not
    // stay stuck on the placeholder/generic value once the caller's effect delivers the answer.
    const { rerender } = render(
      <RmaWarrantyPanel
        rma={{ ...base, status: 'open' } as any}
        vendors={[]}
        locations={[]}
        onChanged={vi.fn()}
        onMirrorToTicket={onMirror}
        vendorCaseSystems={systems}
      />,
    );
    expect((document.getElementById('rma-warranty-mirror-system') as HTMLSelectElement).value).toBe('');
    rerender(
      <RmaWarrantyPanel
        rma={{ ...base, status: 'open' } as any}
        vendors={[]}
        locations={[]}
        onChanged={vi.fn()}
        onMirrorToTicket={onMirror}
        vendorCaseSystems={systems}
        selectedVendorCaseSystem="custom:dell"
      />,
    );
    expect((document.getElementById('rma-warranty-mirror-system') as HTMLSelectElement).value).toBe('custom:dell');
  });

  it('never offers "generic" twice: the picker options are exactly the tenant\'s systems, with no explicit empty-value entry', () => {
    render(
      <RmaWarrantyPanel
        rma={{ ...base, status: 'open' } as any}
        vendors={[]}
        locations={[]}
        onChanged={vi.fn()}
        onMirrorToTicket={vi.fn()}
        vendorCaseSystems={[{ key: 'custom:dell', label: 'Dell portal' }]}
      />,
    );
    const picker = document.getElementById('rma-warranty-mirror-system') as HTMLSelectElement;
    const labels = Array.from(picker.options).map((o) => o.textContent);
    // Exactly one "Generic link" row (the placeholder), not a second one duplicated into `options`.
    expect(labels.filter((l) => l === 'Generic link')).toHaveLength(1);
    expect(labels).toEqual(['Generic link', 'Dell portal']);
  });
});
