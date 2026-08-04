// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmailSenderIdentityCards, type EmailSenderIdentityCopy } from './EmailSenderIdentityCards';

const copy: EmailSenderIdentityCopy = {
  ticketTitle: 'Ticket email identity',
  ticketDescription: 'Ticket replies return here.',
  connectedInboxLabel: 'Connected inbox',
  connectedInboxHelp: 'Use a monitored inbox.',
  customAddressOption: 'Use another address',
  ticketAddressLabel: 'From address',
  ticketAddressPlaceholder: 'support@example.com',
  ticketAddressHelp: 'Controls reply routing.',
  ticketNameLabel: 'Sender display name',
  ticketNamePlaceholder: 'Support',
  ticketNameHelp: 'Ticket name help.',
  warningTitle: 'Warning',
  errorTitle: 'Error',
  notificationTitle: 'All other email identity',
  notificationDescription: 'Portal invites, invoices, and notifications.',
  notificationAddressLabel: 'From address',
  notificationAddressPlaceholder: 'notifications@example.com',
  notificationAddressHelp: 'Branding address.',
  notificationNameLabel: 'Sender display name',
  notificationNamePlaceholder: 'Example MSP',
  notificationNameHelp: 'Blank uses Example MSP automatically.',
};

describe('EmailSenderIdentityCards', () => {
  it('renders separate ticket and notification controls with stable ids', () => {
    render(
      <EmailSenderIdentityCards
        copy={copy}
        ticketAddress="support@example.com"
        ticketName="Example Support"
        notificationAddress="notifications@example.com"
        notificationName=""
        onTicketAddressChange={vi.fn()}
        onTicketNameChange={vi.fn()}
        onNotificationAddressChange={vi.fn()}
        onNotificationNameChange={vi.fn()}
      />
    );

    expect(screen.getByText('Ticket email identity')).toBeInTheDocument();
    expect(screen.getByText('All other email identity')).toBeInTheDocument();
    expect(screen.getByDisplayValue('support@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Example Support')).toBeInTheDocument();
    expect(screen.getByDisplayValue('notifications@example.com')).toBeInTheDocument();
    expect(screen.getByText('Blank uses Example MSP automatically.')).toBeInTheDocument();
  });

  it('keeps ticket and notification change handlers independent', () => {
    const onTicketNameChange = vi.fn();
    const onNotificationNameChange = vi.fn();
    render(
      <EmailSenderIdentityCards
        copy={copy}
        ticketAddress="support@example.com"
        ticketName="Example Support"
        notificationAddress="notifications@example.com"
        notificationName="Example MSP"
        onTicketAddressChange={vi.fn()}
        onTicketNameChange={onTicketNameChange}
        onNotificationAddressChange={vi.fn()}
        onNotificationNameChange={onNotificationNameChange}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Example MSP'), {
      target: { value: 'Example Billing' },
    });
    expect(onNotificationNameChange).toHaveBeenCalledWith('Example Billing');
    expect(onTicketNameChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByDisplayValue('Example Support'), {
      target: { value: 'Example Support Team' },
    });
    expect(onTicketNameChange).toHaveBeenCalledWith('Example Support Team');
  });
});
