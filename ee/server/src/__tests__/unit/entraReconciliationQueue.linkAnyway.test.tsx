// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EntraReconciliationQueue from '@ee/components/settings/integrations/EntraReconciliationQueue';

const { getQueueMock, linkAnywayMock, dismissMock } = vi.hoisted(() => ({
  getQueueMock: vi.fn(),
  linkAnywayMock: vi.fn(),
  dismissMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});

vi.mock('@alga-psa/integrations/actions', () => ({
  getEntraReconciliationQueue: getQueueMock,
  linkEntraQueueItemAnyway: linkAnywayMock,
  dismissEntraQueueItem: dismissMock,
  resolveEntraQueueToExisting: vi.fn(),
  resolveEntraQueueToNew: vi.fn(),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllContacts: vi.fn(async () => []),
  getAllClients: vi.fn(async () => []),
}));

// QuickAddContact drags next-auth into the module graph; these tests never open it.
vi.mock('@alga-psa/clients/components', () => ({ QuickAddContact: () => null }));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, onConfirm, message }: { isOpen: boolean; onConfirm: () => void; message: string }) =>
    isOpen ? <div role="dialog"><p>{message}</p><button id="confirm-link-anyway" onClick={onConfirm}>confirm</button></div> : null,
}));

const conflictItem = (queueItemId: string, displayName: string, email: string) => ({
  queueItemId,
  managedTenantId: 'managed-1',
  clientId: 'client-mdc',
  entraTenantId: 'entra-1',
  entraObjectId: `obj-${queueItemId}`,
  userPrincipalName: email,
  displayName,
  email,
  candidateContacts: [],
  status: 'open',
  createdAt: new Date().toISOString(),
  reason: 'email_owned_by_other_client',
  owner: { contactNameId: 'owner-1', clientId: 'client-hfp', clientName: 'Harbourfront Physio', fullName: displayName, kind: 'primary', isInactive: false, email },
});

describe('EntraReconciliationQueue: an operator decision says what it did', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the linked-anyway confirmation after the queue reloads (the reload used to wipe it)', async () => {
    const benjamin = conflictItem('q-ben', 'Benjamin Dixon', 'benjamin.dixon@muscle.ca');
    getQueueMock
      .mockResolvedValueOnce({ success: true, data: { items: [benjamin] } })
      .mockResolvedValue({ success: true, data: { items: [] } });
    linkAnywayMock.mockResolvedValue({ success: true, data: { queueItemId: 'q-ben', contactNameId: 'owner-1' } });

    render(<EntraReconciliationQueue />);
    await screen.findByText('Benjamin Dixon');

    fireEvent.click(document.querySelector('#entra-queue-link-anyway-q-ben')!);
    fireEvent.click(await screen.findByText('confirm'));

    await waitFor(() => expect(linkAnywayMock).toHaveBeenCalledWith({ queueItemId: 'q-ben' }));
    await waitFor(() => expect(getQueueMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/benjamin\.dixon@muscle\.ca/)).toBeTruthy();
    expect(screen.queryByText('Benjamin Dixon')).toBeNull();
  });

  it('shows the dismissed confirmation after the queue reloads', async () => {
    const lena = conflictItem('q-lena', 'Lena Fischer', 'lena.fischer@muscle.ca');
    getQueueMock
      .mockResolvedValueOnce({ success: true, data: { items: [lena] } })
      .mockResolvedValue({ success: true, data: { items: [] } });
    dismissMock.mockResolvedValue({ success: true, data: {} });

    render(<EntraReconciliationQueue />);
    await screen.findByText('Lena Fischer');

    fireEvent.click(document.querySelector('#entra-queue-dismiss-q-lena')!);

    await waitFor(() => expect(dismissMock).toHaveBeenCalledWith({ queueItemId: 'q-lena' }));
    expect(await screen.findByText(/lena\.fischer@muscle\.ca/)).toBeTruthy();
  });
});
