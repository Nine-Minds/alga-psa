/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TicketNotificationSuppressionControl, {
  TicketNotificationSuppressionValue,
} from './TicketNotificationSuppressionControl';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

function StatefulControl({
  initialValue = {
    suppressContactNotifications: false,
    suppressInternalNotifications: false,
  },
}: {
  initialValue?: TicketNotificationSuppressionValue;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <TicketNotificationSuppressionControl
      idPrefix="silent-ticket-update"
      value={value}
      onChange={setValue}
    />
  );
}

describe('TicketNotificationSuppressionControl', () => {
  it('T033: disables agent/watcher suppression until customer suppression is checked and clears it when customer is unchecked', () => {
    render(<StatefulControl />);

    const contact = screen.getByLabelText("Don't notify the customer");
    const internal = screen.getByLabelText("Also don't notify agents and watchers");

    expect(contact).not.toBeChecked();
    expect(internal).toBeDisabled();
    expect(internal).not.toBeChecked();

    fireEvent.click(contact);
    expect(contact).toBeChecked();
    expect(internal).not.toBeDisabled();
    expect(internal).not.toBeChecked();

    fireEvent.click(internal);
    expect(internal).toBeChecked();

    fireEvent.click(contact);
    expect(contact).not.toBeChecked();
    expect(internal).toBeDisabled();
    expect(internal).not.toBeChecked();
  });

  it('T034: renders helper text and kebab-case input ids', () => {
    render(<StatefulControl />);

    const contact = screen.getByLabelText("Don't notify the customer");
    const internal = screen.getByLabelText("Also don't notify agents and watchers");

    expect(
      screen.getByText("Skips the customer's email, survey invitation, and client-portal notification")
    ).toBeInTheDocument();
    expect(screen.getByText('Skips their emails and in-app notifications too')).toBeInTheDocument();
    expect(contact).toHaveAttribute('id', 'silent-ticket-update-suppress-contact-notifications');
    expect(internal).toHaveAttribute('id', 'silent-ticket-update-suppress-internal-notifications');
  });
});
