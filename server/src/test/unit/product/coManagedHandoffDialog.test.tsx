/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedHandoffDialog from '../../../components/co-managed/CoManagedHandoffDialog';

const mocks = vi.hoisted(() => ({ escalate: vi.fn(), handBack: vi.fn(), revoke: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/actions/coManagedSharedWorkActions', () => ({
  escalateSharedTicketAction: (...a: any[]) => mocks.escalate(...a),
  handBackSharedTicketAction: (...a: any[]) => mocks.handBack(...a),
  revokeSharedTicketGrantAction: (...a: any[]) => mocks.revoke(...a),
}));
vi.mock('../../../components/co-managed/CoManagedWorkSignalsProvider', () => ({ useCoManagedWorkSignals: () => ({ refresh: mocks.refresh }) }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant: _v, ...rest }: any) => <button {...rest}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: ({ children, footer }: any) => <div>{children}{footer}</div>, DialogContent: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/TextArea', () => ({ TextArea: ({ label, onChange, ...rest }: any) => <textarea aria-label={label} onChange={onChange} {...rest} /> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const resource = { kind: 'ticket', tenant: 't1', id: 'tk1' } as any;
const CODES = ['INVALID_HANDOFF', 'HANDOFF_CHANGED', 'ALREADY_RESPONSIBLE', 'ALREADY_REVOKED', 'DESTINATION_UNAVAILABLE', 'CAPABILITY_UNAVAILABLE', 'NOT_AVAILABLE', 'READ_ONLY'];
const KEYS: Record<string, string> = { INVALID_HANDOFF: 'invalidHandoff', HANDOFF_CHANGED: 'handoffChanged', ALREADY_RESPONSIBLE: 'alreadyResponsible',
  ALREADY_REVOKED: 'alreadyRevoked', DESTINATION_UNAVAILABLE: 'destinationUnavailable', CAPABILITY_UNAVAILABLE: 'capabilityUnavailable', NOT_AVAILABLE: 'notAvailable', READ_ONLY: 'readOnly' };
const onSaved = vi.fn(); const onClose = vi.fn(); const onReload = vi.fn();
const open = (action: 'escalate' | 'handback' | 'revoke' = 'escalate') => {
  render(<CoManagedHandoffDialog action={action} side="customer" resource={resource} revision={3} onSaved={onSaved} onClose={onClose} onReload={onReload} />);
  fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Please look' } });
};
const submit = () => document.getElementById('co-ticket-handoff-submit') as HTMLButtonElement;
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

describe('handoff dialog outcomes', () => {
  it.each(CODES)('keeps the dialog open and shows the %s refusal', async code => {
    mocks.escalate.mockResolvedValue({ ok: false, code });
    open();
    fireEvent.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(`coManaged.ticket.refusal.${KEYS[code]}`);
    expect(onSaved).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(submit().disabled).toBe(false));
  });

  it('sends a fresh operation after a refusal and clears the message', async () => {
    mocks.escalate.mockResolvedValueOnce({ ok: false, code: 'HANDOFF_CHANGED' }).mockResolvedValueOnce({ ok: true, receipt: {} });
    open();
    fireEvent.click(submit());
    await screen.findByRole('alert');
    fireEvent.click(submit());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.escalate.mock.calls[0][1].operationId).not.toBe(mocks.escalate.mock.calls[1][1].operationId);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refreshes work signals and reports saved once on success', async () => {
    mocks.revoke.mockResolvedValue({ ok: true, receipt: {} });
    open('revoke');
    fireEvent.click(submit());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the uncertain state and stays open when the action throws, retrying the same operation', async () => {
    mocks.escalate.mockRejectedValueOnce(new Error('redacted')).mockResolvedValueOnce({ ok: true, receipt: {} });
    open();
    fireEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toBe('coManaged.ticket.uncertain');
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(submit());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.escalate.mock.calls[0][1].operationId).toBe(mocks.escalate.mock.calls[1][1].operationId);
  });
});
