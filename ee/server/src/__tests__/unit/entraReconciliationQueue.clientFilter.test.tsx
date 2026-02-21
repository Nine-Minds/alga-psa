// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EntraReconciliationQueue from '@ee/components/settings/integrations/EntraReconciliationQueue';

const {
  getEntraReconciliationQueueMock,
  resolveEntraQueueToExistingMock,
  resolveEntraQueueToNewMock,
  getAllContactsMock,
} = vi.hoisted(() => ({
  getEntraReconciliationQueueMock: vi.fn(),
  resolveEntraQueueToExistingMock: vi.fn(),
  resolveEntraQueueToNewMock: vi.fn(),
  getAllContactsMock: vi.fn(),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getEntraReconciliationQueue: getEntraReconciliationQueueMock,
  resolveEntraQueueToExisting: resolveEntraQueueToExistingMock,
  resolveEntraQueueToNew: resolveEntraQueueToNewMock,
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllContacts: getAllContactsMock,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: ({
    id,
    contacts,
    value,
    onValueChange,
    placeholder,
  }: {
    id: string;
    contacts: Array<{ contact_name_id: string; full_name: string }>;
    value: string;
    onValueChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <select
      id={id}
      data-testid={`contact-picker-${id}`}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">{placeholder || 'Select existing contact...'}</option>
      {contacts.map((contact) => (
        <option key={contact.contact_name_id} value={contact.contact_name_id}>
          {contact.full_name}
        </option>
      ))}
    </select>
  ),
}));

describe('EntraReconciliationQueue contact filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEntraQueueToExistingMock.mockResolvedValue({ success: true, data: {} });
    resolveEntraQueueToNewMock.mockResolvedValue({ success: true, data: {} });
  });

  it('T133: existing-contact picker options are scoped to queue item client', async () => {
    getEntraReconciliationQueueMock.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            queueItemId: 'queue-item-133-a',
            managedTenantId: 'managed-a',
            clientId: 'client-a',
            entraTenantId: 'entra-a',
            entraObjectId: 'entra-obj-a',
            userPrincipalName: 'a@example.com',
            displayName: 'Queue User A',
            email: 'a@example.com',
            candidateContacts: [],
            status: 'open',
            createdAt: new Date().toISOString(),
          },
          {
            queueItemId: 'queue-item-133-b',
            managedTenantId: 'managed-b',
            clientId: 'client-b',
            entraTenantId: 'entra-b',
            entraObjectId: 'entra-obj-b',
            userPrincipalName: 'b@example.com',
            displayName: 'Queue User B',
            email: 'b@example.com',
            candidateContacts: [],
            status: 'open',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    getAllContactsMock.mockResolvedValue([
      {
        contact_name_id: 'contact-a1',
        client_id: 'client-a',
        full_name: 'Client A Contact',
      },
      {
        contact_name_id: 'contact-b1',
        client_id: 'client-b',
        full_name: 'Client B Contact',
      },
    ]);

    render(<EntraReconciliationQueue />);

    await screen.findByText('Queue User A');
    await screen.findByText('Queue User B');

    const clientASelect = screen.getByTestId(
      'contact-picker-entra-queue-existing-contact-queue-item-133-a'
    );
    const clientBSelect = screen.getByTestId(
      'contact-picker-entra-queue-existing-contact-queue-item-133-b'
    );

    expect(clientASelect.textContent).toContain('Client A Contact');
    expect(clientASelect.textContent).not.toContain('Client B Contact');
    expect(clientBSelect.textContent).toContain('Client B Contact');
    expect(clientBSelect.textContent).not.toContain('Client A Contact');
  });

  it('T134: queue items without a client allow selecting from all active contacts', async () => {
    getEntraReconciliationQueueMock.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            queueItemId: 'queue-item-134',
            managedTenantId: null,
            clientId: null,
            entraTenantId: 'entra-134',
            entraObjectId: 'entra-obj-134',
            userPrincipalName: 'u134@example.com',
            displayName: 'Queue User 134',
            email: 'u134@example.com',
            candidateContacts: [],
            status: 'open',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    getAllContactsMock.mockResolvedValue([
      {
        contact_name_id: 'contact-134-a',
        client_id: 'client-a',
        full_name: 'Contact A',
      },
      {
        contact_name_id: 'contact-134-b',
        client_id: 'client-b',
        full_name: 'Contact B',
      },
    ]);

    render(<EntraReconciliationQueue />);

    await screen.findByText('Queue User 134');
    const select = screen.getByTestId('contact-picker-entra-queue-existing-contact-queue-item-134');
    expect(select.textContent).toContain('Contact A');
    expect(select.textContent).toContain('Contact B');
  });
});
