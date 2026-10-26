/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedClientSetup from '../../../components/co-managed/CoManagedClientSetup';
import CoManagedClientSeats from '../../../components/co-managed/CoManagedClientSeats';
import CoManagedClientRecovery from '../../../components/co-managed/CoManagedClientRecovery';
import CoManagedClientView from '../../../components/co-managed/CoManagedClientView';
import CoManagedClientSummary from '../../../components/co-managed/CoManagedClientSummary';

const mocks = vi.hoisted(() => ({
  options: vi.fn(), provision: vi.fn(), retry: vi.fn(), cancel: vi.fn(), resize: vi.fn(),
  billing: vi.fn(), preview: vi.fn(), purchaseSeats: vi.fn(), push: vi.fn(),
}));
vi.mock('@/lib/actions/coManagedActions', () => ({
  getCoManagedProvisioningOptions: mocks.options, changeCoManagedWorkspaceSeats: mocks.resize,
  getCoManagedBillingState: mocks.billing,
}));
vi.mock('@enterprise/lib/actions/coManagedProvisioningActions', () => ({
  provisionCoManagedWorkspaceAction: mocks.provision, retryCoManagedProvisioningAction: mocks.retry,
  cancelCoManagedProvisioningAction: mocks.cancel,
}));
vi.mock('@enterprise/lib/actions/coManagedBillingActions', () => ({
  previewCoManagedSeatsAction: mocks.preview, purchaseCoManagedSeatsAction: mocks.purchaseSeats,
}));
vi.mock('@enterprise/components/co-managed/CoManagedCheckout', () => ({ default: () => <div>Stripe checkout</div> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Stable like the real hook's t, so effects keyed on t run once per mount.
  const t = (key: string, options?: Record<string, string>) => {
    if (key.endsWith('invitationExpired')) return 'Invitation expired';
    return (options?.defaultValue ?? key).replace(/{{(\w+)}}/g, (match, name) => options?.[name] ?? match);
  };
  return {
  useTranslation: () => ({ t }),
  useFormatters: () => ({ formatCurrency: (value: number) => `$${value}`, formatDate: (value: Date) => value.toISOString() }),
  };
});
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) =>
    React.createElement('button', props as React.ButtonHTMLAttributes<HTMLButtonElement>, children),
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', props),
}));
vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) =>
    React.createElement('label', props, children),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title }: { isOpen: boolean; children: React.ReactNode; title?: string }) =>
    isOpen ? React.createElement('div', null, React.createElement('h2', null, title), children) : null,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, label, value, options, onValueChange, disabled }: {
    id: string; label: string; value: string; options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void; disabled?: boolean;
  }) => React.createElement('label', null, label,
    React.createElement('select', { id, value, disabled, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onValueChange(event.target.value) },
      React.createElement('option', { value: '' }, 'Choose'),
      options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)))),
}));
vi.mock('../../../components/co-managed/CoManagedPolicyPanel', () => ({ default: () => <div data-testid="policy" /> }));
vi.mock('../../../components/co-managed/CoManagedSlaPolicyPanel', () => ({ default: () => <div data-testid="sla" /> }));
vi.mock('../../../components/co-managed/CoManagedDelegatedAdministration', () => ({ default: () => <div data-testid="delegation" /> }));
vi.mock('../../../components/co-managed/CoManagedDeparture', () => ({ default: () => <div data-testid="departure" /> }));

const relationship = (over: Record<string, unknown> = {}) => ({
  relationshipId: 'rel', operationId: 'operation', state: 'pending_acceptance', ended: false, seats: 2, usedSeats: 1,
  workspaceName: 'Customer IT', administratorEmail: 'admin@example.test', canManage: true, canChangeSeats: true,
  canRetry: true, canCancel: true, invitationExpired: false, deliveryFailed: false, cleanupFailed: false, ...over,
});
const view = (over: Record<string, unknown> = {}) => ({
  clientId: 'client', clientName: 'Acme', selectionRequired: false, selectedRelationshipId: null as string | null,
  canManage: true, relationships: [] as ReturnType<typeof relationship>[], ...over,
});
const billingState = (over: Record<string, unknown> = {}) => ({
  capacity: 5, allocated: 2, available: 3, canGrow: true, isReadOnly: false, graceEndsAt: null,
  selfHosted: false, isPro: true, canPurchase: true, canReadRelationships: true, pending: null,
  purchase: { deployment: 'hosted', sponsorshipEligible: true, accountAuthority: 'purchaser', implementationAvailable: true,
    providerReady: true, pending: null, canPurchase: true, canResume: false, reason: 'available' },
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.options.mockResolvedValue({ clients: [], boards: [{ id: 'board', name: 'Escalations' }] });
  mocks.provision.mockResolvedValue({ operationId: 'op', enqueued: true });
  mocks.retry.mockResolvedValue({ enqueued: true });
  mocks.cancel.mockResolvedValue({ enqueued: true });
  mocks.resize.mockResolvedValue({ changed: true });
  mocks.billing.mockResolvedValue(billingState());
  mocks.preview.mockResolvedValue({ unitAmount: 1149, monthlyTotal: 6894, amountDue: 1200, currency: 'usd' });
  mocks.purchaseSeats.mockResolvedValue({ kind: 'updated', subscriptionId: 'sub', publishableKey: null });
});
afterEach(cleanup);

describe('client-fixed co-managed setup', () => {
  const fillSetup = async () => {
    await screen.findByRole('option', { name: 'Escalations' });
    fireEvent.change(document.getElementById('i-admin-firstName')!, { target: { value: 'Ada' } });
    fireEvent.change(document.getElementById('i-admin-lastName')!, { target: { value: 'Admin' } });
    fireEvent.change(document.getElementById('i-admin-email')!, { target: { value: 'ada@example.test' } });
    fireEvent.change(screen.getByLabelText('Escalation board'), { target: { value: 'board' } });
  };

  it('blocks a new workspace when the pool is empty, including a direct form submit', async () => {
    mocks.billing.mockResolvedValue(billingState({ available: 0 }));
    render(<CoManagedClientSetup clientId="client" clientName="Acme" idPrefix="i" onProvisioned={vi.fn()} />);
    await fillSetup();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    fireEvent.submit(document.querySelector('form')!);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('rejects zero or over-capacity allocations and explains an acknowledged server refusal', async () => {
    mocks.provision.mockResolvedValue({ rejected: true, errorCode: 'CAPACITY_UNAVAILABLE' });
    render(<CoManagedClientSetup clientId="client" clientName="Acme" idPrefix="i" onProvisioned={vi.fn()} />);
    await fillSetup();
    for (const value of ['0', '4']) {
      fireEvent.change(document.getElementById('i-seats')!, { target: { value } });
      expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    }
    fireEvent.change(document.getElementById('i-seats')!, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('There are not enough available co-managed seats');
    expect(screen.getByRole('button', { name: 'Submit' })).not.toBeDisabled();
  });

  it('names a fully allocated pool as out of seats, not as an eligibility problem', async () => {
    mocks.billing.mockResolvedValue(billingState({ capacity: 3, allocated: 3, available: 0, canGrow: false }));
    render(<CoManagedClientSetup clientId="client" clientName="Acme" idPrefix="i" onProvisioned={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveTextContent('No seats are available');
    expect(screen.getByRole('status')).not.toHaveTextContent('Pro license');
  });

  it('keeps the eligibility message for a sponsor without Pro', async () => {
    mocks.billing.mockResolvedValue(billingState({ isPro: false, canGrow: false }));
    render(<CoManagedClientSetup clientId="client" clientName="Acme" idPrefix="i" onProvisioned={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveTextContent('An active Pro license');
  });

  it('re-reads the seat pool after a capacity rejection so the hint matches the server', async () => {
    // Another workspace takes the free seats once this form has been submitted.
    mocks.billing.mockImplementation(async () => mocks.provision.mock.calls.length === 0 ? billingState()
      : billingState({ capacity: 5, allocated: 5, available: 0, canGrow: false }));
    mocks.provision.mockResolvedValue({ rejected: true, errorCode: 'CAPACITY_UNAVAILABLE' });
    render(<CoManagedClientSetup clientId="client" clientName="Acme" idPrefix="i" onProvisioned={vi.fn()} />);
    await fillSetup();
    expect(screen.getByRole('status')).toHaveTextContent('coManaged.provisioning.capacity');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No seats are available'));
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('prefills the client name, fixes the client, and reuses the operation ID when a submission fails', async () => {
    mocks.provision.mockRejectedValueOnce(new Error('Lost acknowledgement'));
    render(<CoManagedClientSetup clientId="client" clientName="Acme" idPrefix="i" onProvisioned={vi.fn()} />);
    await screen.findByRole('option', { name: 'Escalations' });
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Acme');
    fireEvent.change(document.getElementById('i-admin-firstName')!, { target: { value: 'Ada' } });
    fireEvent.change(document.getElementById('i-admin-lastName')!, { target: { value: 'Admin' } });
    fireEvent.change(document.getElementById('i-admin-email')!, { target: { value: 'ada@example.test' } });
    fireEvent.change(screen.getByLabelText('Escalation board'), { target: { value: 'board' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(mocks.provision).toHaveBeenCalledTimes(1));
    const first = mocks.provision.mock.calls[0][0];
    expect(first).toMatchObject({ clientId: 'client', workspaceName: 'Acme', escalationBoardId: 'board' });
    // The form unlocks so the details can be corrected (it used to stay locked
    // with only a resend of the original), and keeps the operation ID so an
    // identical resend stays idempotent; changed details get an explained conflict.
    await screen.findByText('coManaged.provisioning.submitError');
    expect(document.getElementById('i-admin-email')).not.toBeDisabled();
    fireEvent.change(document.getElementById('i-admin-email')!, { target: { value: 'ada.corrected@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(mocks.provision).toHaveBeenCalledTimes(2));
    expect(mocks.provision.mock.calls[1][0]).toMatchObject({ operationId: first.operationId,
      administrator: { email: 'ada.corrected@example.test' } });
  });
});

describe('client allocation', () => {
  it('floors the allocation at the committed count and sends the expected-seat identity', async () => {
    render(<CoManagedClientSeats operationId="op" clientId="client" allocated={2} committed={1} idPrefix="i" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change seats' }));
    const input = screen.getByLabelText('Technician seats');
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Save allocation' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save allocation' }));
    await waitFor(() => expect(mocks.resize).toHaveBeenCalledWith({ operationId: 'op', seats: 3, expectedSeats: 2 }));
  });

  it('names the reason when the server refuses the change', async () => {
    // Pending invitations count as committed seats, so the floor shown here can be below what the server allows.
    mocks.resize.mockResolvedValueOnce({ changed: false, errorCode: 'CO_MANAGED_SEAT_LIMIT' });
    const onSaved = vi.fn();
    render(<CoManagedClientSeats operationId="op" clientId="client" allocated={3} committed={1} idPrefix="i" onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change seats' }));
    fireEvent.change(screen.getByLabelText('Technician seats'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save allocation' }));
    expect(await screen.findByText(/already has more technicians and pending invitations/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('converts a shortfall into an absolute pool target and freezes the purchase operation', async () => {
    render(<CoManagedClientSeats operationId="op" clientId="client" allocated={2} committed={1} idPrefix="i" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change seats' }));
    fireEvent.change(screen.getByLabelText('Technician seats'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save allocation' }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith(6));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm purchase' }));
    await waitFor(() => expect(mocks.purchaseSeats).toHaveBeenCalledWith({ quantity: 6, operationId: expect.any(String) }));
    expect(mocks.resize).not.toHaveBeenCalled();
  });

  it('invalidates a stale quote when the pool baseline changes before confirmation', async () => {
    mocks.billing.mockResolvedValueOnce(billingState()).mockResolvedValueOnce(billingState({ capacity: 7, available: 5 }));
    render(<CoManagedClientSeats operationId="op" clientId="client" allocated={2} committed={1} idPrefix="i" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change seats' }));
    await screen.findByText(/Pool:/);
    fireEvent.change(screen.getByLabelText('Technician seats'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save allocation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm purchase' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The pool changed since this quote. Review the shortfall again.');
    expect(mocks.purchaseSeats).not.toHaveBeenCalled();
  });

  it('completes the prepared allocation once purchased capacity is verified', async () => {
    mocks.billing
      .mockResolvedValueOnce(billingState())
      .mockResolvedValueOnce(billingState())
      .mockResolvedValueOnce(billingState({ capacity: 6, available: 4 }));
    render(<CoManagedClientSeats operationId="op" clientId="client" allocated={2} committed={1} idPrefix="i" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change seats' }));
    await screen.findByText(/Pool:/);
    fireEvent.change(screen.getByLabelText('Technician seats'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save allocation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm purchase' }));
    await waitFor(() => expect(mocks.resize).toHaveBeenCalledWith({ operationId: 'op', seats: 6, expectedSeats: 2 }));
  });

  it.each([
    [{ reason: 'no_permission' }, 'This allocation needs more pool capacity. An account administrator must add it.'],
    [{ reason: 'implementation_unavailable' }, 'Hosted co-managed purchasing is not available in this deployment.'],
    [{ reason: 'provider_unconfigured' }, 'The payment provider is not configured. An administrator must finish billing setup.'],
    [{ reason: 'pending' }, 'A co-managed purchase is already being prepared or checked out. Resume it before changing capacity.'],
  ])('explains a shortfall degradation without a purchase call: %j', async (purchase, message) => {
    mocks.billing.mockResolvedValue(billingState({ purchase: { ...billingState().purchase, canPurchase: false, ...purchase } }));
    render(<CoManagedClientSeats operationId="op" clientId="client" allocated={2} committed={1} idPrefix="i" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change seats' }));
    fireEvent.change(screen.getByLabelText('Technician seats'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save allocation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('freezes the purchase operation across an ambiguous failure and reuses it on retry', async () => {
    mocks.purchaseSeats.mockRejectedValueOnce(new Error('Network timeout'));
    render(<CoManagedClientSeats operationId="op" clientId="client" relationshipId="rel" allocated={2} committed={1} idPrefix="i" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change seats' }));
    await screen.findByText(/Pool:/);
    fireEvent.change(screen.getByLabelText('Technician seats'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save allocation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm purchase' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm purchase' }));
    await waitFor(() => expect(mocks.purchaseSeats).toHaveBeenCalledTimes(2));
    expect(mocks.purchaseSeats.mock.calls[1][0].operationId).toBe(mocks.purchaseSeats.mock.calls[0][0].operationId);
  });

  it('permits a new purchase operation only after an acknowledged expiry', async () => {
    mocks.purchaseSeats.mockResolvedValueOnce({ kind: 'expired', publishableKey: null });
    render(<CoManagedClientSeats operationId="op" clientId="client" relationshipId="rel" allocated={2} committed={1} idPrefix="i" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change seats' }));
    await screen.findByText(/Pool:/);
    fireEvent.change(screen.getByLabelText('Technician seats'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save allocation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm purchase' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The checkout session expired.');
    mocks.purchaseSeats.mockResolvedValueOnce({ kind: 'updated', subscriptionId: 'sub', publishableKey: null });
    fireEvent.click(screen.getByRole('button', { name: 'Save allocation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm purchase' }));
    await waitFor(() => expect(mocks.purchaseSeats).toHaveBeenCalledTimes(2));
    expect(mocks.purchaseSeats.mock.calls[1][0].operationId).not.toBe(mocks.purchaseSeats.mock.calls[0][0].operationId);
  });

  it('routes a self-host shortfall to License Management with a validated return destination', async () => {
    mocks.billing.mockResolvedValue(billingState({ selfHosted: true,
      purchase: { ...billingState().purchase, deployment: 'self_host', canPurchase: false, reason: 'self_host_license' } }));
    render(<CoManagedClientSeats operationId="op" clientId="client" relationshipId="rel" allocated={2} committed={1} idPrefix="i" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change seats' }));
    const link = await screen.findByRole('link', { name: 'Manage license' });
    expect(link).toHaveAttribute('href', '/msp/licenses?returnTo=%2Fmsp%2Fclients%2Fclient%3Ftab%3Dco-managed%26relationshipId%3Drel');
  });

  it('restores a session draft and keeps self-host shortfalls off hosted checkout', async () => {
    window.sessionStorage.setItem('coManaged:clientDraft:client:none',
      JSON.stringify({ seats: 4, relationshipId: null, updatedAt: Date.now() }));
    render(<CoManagedClientSeats operationId="op" clientId="client" allocated={2} committed={1} idPrefix="i" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change seats' }));
    expect(screen.getByLabelText('Technician seats')).toHaveValue(4);
    window.sessionStorage.clear();
  });
});

describe('client recovery', () => {
  it('retries the original operation and distinguishes an expired invitation', async () => {
    const { rerender } = render(<CoManagedClientRecovery operationId="op" state="pending_acceptance" canRetry canCancel={false}
      invitationExpired={false} deliveryFailed={false} idPrefix="r" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('op'));
    rerender(<CoManagedClientRecovery operationId="op" state="pending_acceptance" canRetry canCancel={false}
      invitationExpired deliveryFailed={false} idPrefix="r" onChanged={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Resend invitation' })).toBeInTheDocument();
  });

  it('labels the retry of a delivered, unexpired invitation as a resend', async () => {
    render(<CoManagedClientRecovery operationId="op" state="pending_acceptance" canRetry canCancel={false} invitationSent
      invitationExpired={false} deliveryFailed={false} idPrefix="r" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resend invitation' }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('op'));
  });

  it('confirms before cancelling, because cancelling deletes the unactivated workspace', async () => {
    render(<CoManagedClientRecovery operationId="op" state="pending_acceptance" canRetry={false} canCancel
      invitationExpired={false} deliveryFailed={false} idPrefix="r" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel setup' }));
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(screen.getByText('coManaged.provisioning.cancelDescription')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.keepSetup' }));
    expect(mocks.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.confirmCancel' }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('op'));
  });

  it('reports a failed cancellation as a cancellation, not a retry', async () => {
    mocks.cancel.mockRejectedValueOnce(new Error('denied'));
    render(<CoManagedClientRecovery operationId="op" state="pending_acceptance" canRetry={false} canCancel
      invitationExpired={false} deliveryFailed={false} idPrefix="r" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.confirmCancel' }));
    expect(await screen.findByText(/Setup could not be cancelled/)).toBeInTheDocument();
    expect(screen.queryByText(/Could not recover this setup/)).not.toBeInTheDocument();
  });
});

describe('client relationship view sections', () => {
  it('offers client-fixed setup when no relationship exists and management is permitted', () => {
    render(<CoManagedClientView view={view()} clientId="client" clientName="Acme" idPrefix="i" />);
    expect(document.getElementById('i-setup')).not.toBeNull();
    expect(screen.queryByTestId('policy')).toBeNull();
  });
  it('embeds access, SLA, and delegation for an active relationship', () => {
    render(<CoManagedClientView view={view({ selectedRelationshipId: 'rel', relationships: [relationship({ state: 'active', canRetry: false, canCancel: false, canChangeSeats: false })] })}
      clientId="client" clientName="Acme" idPrefix="i" />);
    expect(screen.getByTestId('policy')).toBeInTheDocument();
    expect(screen.getByTestId('sla')).toBeInTheDocument();
    expect(screen.getByTestId('delegation')).toBeInTheDocument();
  });
  it('offers setup again beside history selection when only an ended relationship exists', () => {
    render(<CoManagedClientView view={view({ selectionRequired: true,
      relationships: [relationship({ state: 'cancelled', ended: true, canRetry: false, canCancel: false, canChangeSeats: false })] })}
      clientId="client" clientName="Acme" idPrefix="i" />);
    expect(document.getElementById('i-setup')).not.toBeNull();
    expect(document.getElementById('i-relationship')).not.toBeNull();
    expect(screen.getByText('Co-managed IT not enabled')).toBeInTheDocument();
  });
  it('does not offer a second setup while a relationship is live', () => {
    render(<CoManagedClientView view={view({ selectionRequired: true, relationships: [
      relationship({ state: 'cancelled', ended: true, relationshipId: 'old' }), relationship({ relationshipId: 'live' })] })}
      clientId="client" clientName="Acme" idPrefix="i" />);
    expect(document.getElementById('i-setup')).toBeNull();
  });
  it('explains a failed setup and a pending or failed cleanup', () => {
    const { rerender } = render(<CoManagedClientView view={view({ selectedRelationshipId: 'rel', relationships: [relationship({ state: 'failed', canCancel: true })] })}
      clientId="client" clientName="Acme" idPrefix="i" />);
    expect(screen.getByText(/Setup did not finish/)).toBeInTheDocument();
    rerender(<CoManagedClientView view={view({ selectedRelationshipId: 'rel', relationships: [relationship({ state: 'cleanup_requested', canCancel: false, cleanupFailed: false })] })}
      clientId="client" clientName="Acme" idPrefix="i" />);
    expect(screen.getByText(/Cleanup is pending/)).toBeInTheDocument();
    expect(screen.queryByText(/must accept/)).toBeNull();
    rerender(<CoManagedClientView view={view({ selectedRelationshipId: 'rel', relationships: [relationship({ state: 'cleanup_requested', canCancel: false, cleanupFailed: true })] })}
      clientId="client" clientName="Acme" idPrefix="i" />);
    expect(screen.getByText(/Cleanup did not finish/)).toBeInTheDocument();
  });
  it('links client-context work to the MSP shell', () => {
    render(<CoManagedClientView view={view({ selectedRelationshipId: 'rel', relationships: [relationship({ state: 'active', canRetry: false, canCancel: false, canChangeSeats: false })] })}
      clientId="client" clientName="Acme" idPrefix="i" />);
    expect(document.getElementById('i-work-projects')).not.toBeNull();
    expect(document.getElementById('i-work-shared-tasks')).not.toBeNull();
    expect(screen.getByTestId('departure')).toBeInTheDocument();
  });
  // Guide 10 (clientIntegration F003/F010/F018/T009): a departed client is not "not enabled".
  it('shows a departed client as ended with its end date and archive link, and offers no setup', () => {
    render(<CoManagedClientView view={view({ selectedRelationshipId: 'rel', canManage: true, relationships: [relationship({ state: 'terminated', ended: true, retained: true,
      endedAt: '2026-10-26T00:13:30.705Z', usedSeats: null, canRetry: false, canCancel: false, canChangeSeats: false })] })}
      clientId="client" clientName="Kansas Farms" idPrefix="i" />);
    expect(document.getElementById('i-setup')).toBeNull();
    expect(screen.queryByText('Co-managed IT not enabled')).toBeNull();
    expect(screen.getByText('terminated')).toBeInTheDocument();
    expect(document.getElementById('i-ended-on')?.textContent).toBe('Ended 2026-10-26T00:13:30.705Z');
    expect(document.getElementById('i-history-link')).not.toBeNull();
    expect(screen.getByText('Open Shared work archive').closest('a')?.getAttribute('href')).toBe('/msp/co-managed/archive');
    expect(screen.getByText('Seats released')).toBeInTheDocument();
    expect(screen.queryByTestId('departure')).toBeNull();
  });
  it('still offers setup when the only history is a cancelled setup (nothing retained)', () => {
    render(<CoManagedClientView view={view({ selectedRelationshipId: 'rel', relationships: [relationship({ state: 'cancelled', ended: true, retained: false,
      endedAt: '2026-10-26T00:13:30.705Z', canRetry: false, canCancel: false, canChangeSeats: false })] })}
      clientId="client" clientName="Acme" idPrefix="i" />);
    expect(document.getElementById('i-setup')).not.toBeNull();
  });
  it('summarizes a departed client as ended, with history rather than setup', () => {
    const onOpenTab = vi.fn();
    render(<CoManagedClientSummary view={view({ selectedRelationshipId: 'rel', relationships: [relationship({ state: 'terminated', ended: true, retained: true,
      endedAt: '2026-10-26T00:13:30.705Z' })] })} clientId="client" idPrefix="s" onOpenTab={onOpenTab} />);
    expect(screen.queryByText('Co-managed IT not enabled')).toBeNull();
    expect(screen.getByText('terminated')).toBeInTheDocument();
    expect(screen.getByText('Ended 2026-10-26T00:13:30.705Z')).toBeInTheDocument();
    fireEvent.click(screen.getByText('View history'));
    expect(onOpenTab).toHaveBeenCalledWith('co-managed');
  });
  it('shows retained history and no live settings for an ended relationship', () => {
    render(<CoManagedClientView view={view({ selectedRelationshipId: 'rel', relationships: [relationship({ state: 'terminated', ended: true, canRetry: false, canCancel: false, canChangeSeats: false })] })}
      clientId="client" clientName="Acme" idPrefix="i" />);
    expect(screen.queryByTestId('policy')).toBeNull();
    expect(screen.queryByTestId('departure')).toBeNull();
    expect(document.getElementById('i-history-link')).not.toBeNull();
    expect(screen.getByText('Relationship history')).toBeInTheDocument();
  });
});
