/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { getTicketDuplicateSource, getContactsByClient } = vi.hoisted(() => ({
  getTicketDuplicateSource: vi.fn(),
  getContactsByClient: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (key === 'multiContactPicker.fields.search.placeholder') return 'Search contacts...';
      if (key === 'multiContactPicker.fields.contacts.placeholder') return 'Select contacts...';
      if (key === 'multiContactPicker.noEmail') return 'no email';
      if (typeof fallback === 'string') return fallback;
      if (typeof fallback?.defaultValue === 'string') return fallback.defaultValue;
      return key;
    },
  }),
}));

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

vi.mock('../../../actions/ticketActions', () => ({
  duplicateTicketBatch: vi.fn(),
  getTicketDuplicateSource,
}));
vi.mock('../../../actions/clientLookupActions', () => ({ getContactsByClient }));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children, footer }: any) => isOpen ? (
    <div role="dialog"><h2>{title}</h2>{children}{footer}</div>
  ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

import BatchDuplicateTicketDialog from '../BatchDuplicateTicketDialog';

const source = {
  ticket_id: 'source-ticket',
  ticket_number: 'T-100',
  title: 'Review access request',
  description: '',
  client: { id: 'client-1', name: 'Example Client', type: 'company' },
  contact: null,
  location_id: null,
  board_id: 'board-1',
  category_id: 'category-1',
  subcategory_id: null,
  priority_id: 'priority-1',
  itil_impact: null,
  itil_urgency: null,
  assigned_to: null,
  assigned_team_id: null,
  board_name: 'Support',
  category_name: 'Access',
  subcategory_name: null,
  priority_name: 'Normal',
  assignee_name: null,
  assigned_team_name: null,
  additional_agents: [],
  tags: [],
  checklist: [],
  custom_field_count: 0,
};

const contactsWithoutEmail = [
  { contact_name_id: 'contact-no-email', full_name: 'Morgan No Email', email: null, client_id: 'client-1' },
];

describe('BatchDuplicateTicketDialog with the real contact picker', () => {
  beforeEach(() => {
    getTicketDuplicateSource.mockResolvedValue(source);
    getContactsByClient.mockResolvedValue(contactsWithoutEmail);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('allows selecting a client contact without email and creates its per-contact row', async () => {
    render(<BatchDuplicateTicketDialog sourceTicketId="source-ticket" isOpen onClose={() => {}} />);
    await screen.findByLabelText('Title template');

    fireEvent.click(screen.getByRole('button', { name: /Select contacts/ }));
    const search = await screen.findByPlaceholderText('Search contacts...');
    await waitFor(() => expect(document.activeElement).toBe(search));

    const option = screen.getByRole('option', { name: /Morgan No Email/ });
    expect(option).toHaveAttribute('aria-disabled', 'false');
    expect(within(option).queryByText('no email')).not.toBeInTheDocument();
    fireEvent.click(option);

    const rowTitle = document.querySelector<HTMLInputElement>('input[id^="batch-duplicate-row-"][id$="-title"]');
    expect(rowTitle).toHaveValue('Review access request');
    expect(document.getElementById('batch-duplicate-contact-picker')).toHaveTextContent('Morgan No Email');
  });
});
