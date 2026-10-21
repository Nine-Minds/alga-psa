// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30000 });

const m = vi.hoisted(() => ({
  push: vi.fn(),
  createAction: vi.fn(),
  listEvents: vi.fn(),
  summary: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_k: string, o?: any) => {
      let v = typeof o === 'string' ? o : o?.defaultValue ?? _k;
      if (o && typeof o === 'object') for (const [k, val] of Object.entries(o)) v = v.replace(`{{${k}}}`, String(val));
      return v;
    },
  }),
}));
vi.mock('@alga-psa/workflows/actions', () => ({
  listEventCatalogOptionsV2Action: (...a: unknown[]) => m.listEvents(...a),
}));
vi.mock('../../workflows/createFromTicket/actions.server', () => ({
  createWorkflowFromTicketAction: (...a: unknown[]) => m.createAction(...a),
  getWorkflowFromTicketImportSummaryAction: (...a: unknown[]) => m.summary(...a),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children, footer, id }: any) =>
    isOpen ? (
      <div id={id} role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ id, options, value, onValueChange }: any) => (
    <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  ),
}));

import CreateWorkflowFromTicketDialog from '../../workflows/createFromTicket/CreateWorkflowFromTicketDialog';

const events = [
  { event_id: '1', event_type: 'INVOICE_CREATED', name: 'Invoice created', category: 'Billing', payload_schema_ref: 'x', payload_schema_ref_status: 'known', source: 'system', status: 'active' },
  { event_id: '2', event_type: 'TICKET_CREATED', name: 'Ticket created', category: 'Tickets', payload_schema_ref: 'y', payload_schema_ref_status: 'known', source: 'system', status: 'active' },
];

function setup(onOpenChange = vi.fn()) {
  render(
    <CreateWorkflowFromTicketDialog
      ticketId="ticket-1"
      ticketNumber="T-001"
      title="Onboard new hire"
      open
      onOpenChange={onOpenChange}
    />
  );
  return onOpenChange;
}

describe('CreateWorkflowFromTicketDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.listEvents.mockResolvedValue({ events });
    m.summary.mockResolvedValue({ customFieldCount: 2, templateItemCount: 3, adHocItemCount: 1 });
  });
  afterEach(cleanup);

  it('defaults the name to the ticket title and lists Manual first, then Tickets events first', async () => {
    setup();
    expect((document.getElementById('create-workflow-from-ticket-name') as HTMLInputElement).value).toBe('Onboard new hire');
    await waitFor(() => expect(document.querySelectorAll('#create-workflow-from-ticket-trigger option').length).toBe(3));
    const values = Array.from(document.querySelectorAll('#create-workflow-from-ticket-trigger option')).map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(['__manual__', 'TICKET_CREATED', 'INVOICE_CREATED']);
  });

  it('submits the expected payload and navigates to the workflow editor', async () => {
    m.createAction.mockResolvedValue({ workflowId: 'wf 1' });
    setup();
    fireEvent.change(document.getElementById('create-workflow-from-ticket-name')!, { target: { value: '  My flow ' } });
    fireEvent.click(document.getElementById('create-workflow-from-ticket-include-tags')!);
    fireEvent.click(document.getElementById('create-workflow-from-ticket-submit')!);

    await waitFor(() => expect(m.push).toHaveBeenCalledWith('/msp/workflow-editor/wf%201'));
    expect(m.createAction).toHaveBeenCalledWith({
      ticketId: 'ticket-1',
      name: 'My flow',
      trigger: { type: 'manual' },
      include: { assignment: true, tags: false, customFields: true, checklist: true },
    });
  });

  it('sends an event trigger by name only', async () => {
    m.createAction.mockResolvedValue({ workflowId: 'wf-2' });
    setup();
    await waitFor(() => expect(document.querySelectorAll('#create-workflow-from-ticket-trigger option').length).toBe(3));
    fireEvent.change(document.getElementById('create-workflow-from-ticket-trigger')!, { target: { value: 'TICKET_CREATED' } });
    expect(document.getElementById('create-workflow-from-ticket-recursion-warning')).not.toBeNull();
    fireEvent.click(document.getElementById('create-workflow-from-ticket-submit')!);
    await waitFor(() => expect(m.createAction).toHaveBeenCalled());
    expect(m.createAction.mock.calls[0][0].trigger).toEqual({ type: 'event', eventName: 'TICKET_CREATED' });
  });

  it('keeps the dialog open and shows a returned permission error inline', async () => {
    m.createAction.mockResolvedValue({ permissionError: 'Permission denied: Cannot view ticket' });
    const onOpenChange = setup();
    fireEvent.click(document.getElementById('create-workflow-from-ticket-submit')!);
    expect(await screen.findByText('Permission denied: Cannot view ticket')).toBeTruthy();
    expect(m.push).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.getElementById('create-workflow-from-ticket-dialog')).not.toBeNull();
  });

  it('shows a returned action error and a thrown error inline without navigating', async () => {
    m.createAction.mockResolvedValueOnce({ actionError: 'Unknown workflow event: NOPE' });
    setup();
    fireEvent.click(document.getElementById('create-workflow-from-ticket-submit')!);
    expect(await screen.findByText('Unknown workflow event: NOPE')).toBeTruthy();

    m.createAction.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(document.getElementById('create-workflow-from-ticket-submit')!);
    expect(await screen.findByText('boom')).toBeTruthy();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('blocks an empty name locally', async () => {
    setup();
    fireEvent.change(document.getElementById('create-workflow-from-ticket-name')!, { target: { value: '  ' } });
    fireEvent.submit(document.getElementById('create-workflow-from-ticket-form')!);
    expect(await screen.findByText('Workflow name is required')).toBeTruthy();
    expect(m.createAction).not.toHaveBeenCalled();
  });

  it('loads the counts from the server on open and shows them next to the import checkboxes', async () => {
    setup();
    expect(await screen.findByText('Custom fields (2)')).toBeTruthy();
    expect(m.summary).toHaveBeenCalledWith({ ticketId: 'ticket-1' });
    expect(screen.getByText('Checklist (4 items: 3 from templates / 1 ad-hoc)')).toBeTruthy();
    expect(document.getElementById('create-workflow-from-ticket-checklist-template-note')).not.toBeNull();
    expect(screen.getByText(/re-applied from the current template/)).toBeTruthy();
  });

  it('omits the template-drift note when no items come from templates', async () => {
    m.summary.mockResolvedValue({ customFieldCount: 0, templateItemCount: 0, adHocItemCount: 2 });
    setup();
    expect(await screen.findByText('Checklist (2 items: 0 from templates / 2 ad-hoc)')).toBeTruthy();
    expect(document.getElementById('create-workflow-from-ticket-checklist-template-note')).toBeNull();
  });

  it('falls back to plain labels when the counts are denied or fail, without blocking submit', async () => {
    m.summary.mockResolvedValue({ permissionError: 'Permission denied' });
    setup();
    await waitFor(() => expect(m.summary).toHaveBeenCalled());
    expect(screen.getByText('Custom fields')).toBeTruthy();
    expect(screen.getByText('Checklist')).toBeTruthy();
    expect(document.getElementById('create-workflow-from-ticket-checklist-template-note')).toBeNull();
    expect(document.getElementById('create-workflow-from-ticket-error')).toBeNull();
  });
});
