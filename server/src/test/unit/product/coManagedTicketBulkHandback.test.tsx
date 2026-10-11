/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedTicketBulkHandback from '../../../components/co-managed/CoManagedTicketBulkHandback';
const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock('../../../lib/actions/coManagedTicketQueueActions', () => ({ bulkHandBackCoManagedTicketsAction: mocks.submit }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata() {}, updateActions() {} }) }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: ({ id, label, checked, disabled, onChange }: any) => <label htmlFor={id}>{label}<input type="checkbox" id={id} checked={checked} disabled={disabled} onChange={onChange} /></label> }));
vi.mock('@alga-psa/ui/components/TextArea', () => ({ TextArea: ({ id, label, ...props }: any) => <label htmlFor={id}>{label}<textarea id={id} {...props} /></label> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null }));
const items = () => [
  { tenant: 'a', relationshipId: 'relationship-a', ticketId: 'same-id', workspaceName: 'Customer A', fields: { ticket_number: 'T-1', responsibility: 'msp', work_revision: 1 } },
  { tenant: 'b', relationshipId: 'relationship-b', ticketId: 'same-id', workspaceName: 'Customer B', fields: { ticket_number: 'T-1', responsibility: 'msp', work_revision: 5 } },
  { tenant: 'msp', relationshipId: null, ticketId: 'native', workspaceName: 'MSP', fields: { responsibility: 'msp' } },
] as any;
beforeEach(() => vi.resetAllMocks()); afterEach(cleanup);
it('selects qualified page rows and reports each result without changing other tickets', async () => {
  mocks.submit.mockResolvedValue([{ index: 0, ok: true, receipt: {} }, { index: 1, ok: false, code: 'forbidden' }]);
  const done = vi.fn(); render(<CoManagedTicketBulkHandback items={items()} onDone={done} />);
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  fireEvent.click(screen.getByLabelText('Customer A · T-1')); fireEvent.click(screen.getByLabelText('Customer B · T-1'));
  fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Continue locally' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.handback' }));
  await screen.findByRole('status');
  const request = mocks.submit.mock.lastCall[0];
  expect(request.note).toBe('Continue locally'); expect(request.items.map((item: any) => item.resource.tenant)).toEqual(['a', 'b']);
  expect(request.items.map((item: any) => item.expectedRevision)).toEqual([1, 5]);
  expect(request.items[0].operationId).not.toBe(request.items[1].operationId);
  expect(screen.getByRole('status')).toHaveTextContent('Customer A · T-1: coManaged.queue.bulkHandback.returned');
  expect(screen.getByRole('status')).toHaveTextContent('Customer B · T-1: coManaged.queue.bulkHandback.forbidden');
  expect(screen.getByLabelText('coManaged.ticket.note')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.reload' })); expect(done).toHaveBeenCalledOnce();
});
it('freezes uncertain requests for exact retry and ignores completion after unmount', async () => {
  mocks.submit.mockRejectedValueOnce(new Error('Lost response'));
  let resolve!: (value: any) => void; mocks.submit.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const done = vi.fn(), view = render(<CoManagedTicketBulkHandback items={items()} onDone={done} />);
  fireEvent.click(screen.getByLabelText('Customer A · T-1'));
  fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Frozen note' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.handback' })); await screen.findByRole('alert');
  const original = structuredClone(mocks.submit.mock.calls[0][0]);
  expect(screen.getByLabelText('Customer B · T-1')).toBeDisabled(); expect(screen.getByLabelText('coManaged.ticket.note')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' }));
  expect(mocks.submit.mock.calls[1][0]).toEqual(original);
  view.unmount(); await act(async () => resolve([{ index: 0, ok: true, receipt: {} }])); expect(done).not.toHaveBeenCalled();
});
it('does not offer handback for native customer-handled or revision-masked rows', () => {
  render(<CoManagedTicketBulkHandback items={items().map((item: any) => ({ ...item, fields: { ...item.fields, work_revision: undefined } }))} onDone={() => {}} />);
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(mocks.submit).not.toHaveBeenCalled();
});
