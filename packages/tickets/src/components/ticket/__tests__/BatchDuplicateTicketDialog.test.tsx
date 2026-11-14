/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const duplicateTicketBatchMock = vi.fn();
const dialogPropsSpy = vi.fn();
const getTicketDuplicateSourceMock = vi.fn();
const getContactsByClientMock = vi.fn();

const { translate } = vi.hoisted(() => ({
  translate: (key: string, fallback?: string | Record<string, unknown>) => {
    const template = typeof fallback === 'string' ? fallback : (fallback?.defaultValue as string | undefined);
    if (typeof template !== 'string') return key;
    const values = typeof fallback === 'string' ? undefined : fallback;
    return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(values?.[name] ?? `{{${name}}}`));
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: translate }) }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock('../../../actions/ticketActions', () => ({
  duplicateTicketBatch: (...args: unknown[]) => duplicateTicketBatchMock(...args),
  getTicketDuplicateSource: (...args: unknown[]) => getTicketDuplicateSourceMock(...args),
}));
vi.mock('../../../actions/clientLookupActions', () => ({
  getContactsByClient: (...args: unknown[]) => getContactsByClientMock(...args),
}));

// Lightweight Dialog: the radix dialog is not under test here.
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: (props: any) => {
    dialogPropsSpy(props);
    const { isOpen, children, title, footer } = props;
    return isOpen ? (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
        {footer ? <div data-testid="dialog-footer">{footer}</div> : null}
      </div>
    ) : null;
  },
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

// A checkbox list stands in for the dropdown picker.
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, onConfirm, onClose, title, id }: any) =>
    isOpen ? (
      <div id={id}>
        <span>{title}</span>
        <button id={`${id}-confirm`} onClick={onConfirm}>confirm</button>
        <button id={`${id}-keep`} onClick={onClose}>keep</button>
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/MultiContactPicker', () => ({
  default: ({ id, values, onValuesChange, contacts, disabled }: any) => (
    <div id={id}>
      {contacts.map((contact: any) => (
        <label key={contact.contact_name_id}>
          <input
            type="checkbox"
            aria-label={`pick ${contact.full_name}`}
            disabled={disabled}
            checked={values.includes(contact.contact_name_id)}
            onChange={(event) =>
              onValuesChange(
                event.target.checked
                  ? [...values, contact.contact_name_id]
                  : values.filter((v: string) => v !== contact.contact_name_id)
              )
            }
          />
          {contact.full_name}
        </label>
      ))}
    </div>
  ),
}));

import BatchDuplicateTicketDialog, { BATCH_DUPLICATE_MAX_COPIES } from '../BatchDuplicateTicketDialog';

const source = {
  ticket_id: 'src-1',
  ticket_number: 'T-100',
  title: 'Onboard John Smith',
  description: '',
  client: { id: 'client-1', name: 'Acme', type: 'company' },
  contact: { id: 'c-john', name: 'John Smith' },
  location_id: null,
  board_id: 'board-1',
  category_id: 'cat-1',
  subcategory_id: 'sub-1',
  priority_id: 'prio-1',
  itil_impact: null,
  itil_urgency: null,
  assigned_to: 'user-1',
  assigned_team_id: 'team-1',
  board_name: 'Support',
  category_name: 'Hardware',
  subcategory_name: 'Laptops',
  priority_name: 'High',
  assignee_name: 'Ann Agent',
  assigned_team_name: 'Onboarding Crew',
  additional_agents: [],
  tags: [{ tag_id: 'tag-1', tag_text: 'onboarding', background_color: null, text_color: null }],
  checklist: [
    { item_name: 'Laptop', is_required: false },
    { item_name: 'Account', is_required: true },
  ],
  custom_field_count: 2,
};

const contacts = [
  { contact_name_id: 'c-jane', full_name: 'Jane Doe', client_id: 'client-1' },
  { contact_name_id: 'c-bob', full_name: 'Bob Ray', client_id: 'client-1' },
  { contact_name_id: 'c-cy', full_name: 'Cy Lee', client_id: 'client-1' },
];

function renderDialog(props: Partial<React.ComponentProps<typeof BatchDuplicateTicketDialog>> = {}) {
  const onClose = vi.fn();
  const onCompleted = vi.fn();
  render(
    <BatchDuplicateTicketDialog sourceTicketId="src-1" isOpen onClose={onClose} onCompleted={onCompleted} {...props} />
  );
  return { onClose, onCompleted };
}

async function loaded() {
  await screen.findByLabelText('Title template');
}

function pick(name: string) {
  fireEvent.click(screen.getByLabelText(`pick ${name}`));
}

function titleInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[id^="batch-duplicate-row-"][id$="-title"]'));
}

describe('BatchDuplicateTicketDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketDuplicateSourceMock.mockResolvedValue(source);
    getContactsByClientMock.mockResolvedValue(contacts);
  });
  afterEach(() => cleanup());

  it('creates one row per selected contact with titles rendered from the template', async () => {
    renderDialog();
    await loaded();
    fireEvent.change(screen.getByLabelText('Title template'), { target: { value: 'Onboard {{contact}}' } });
    pick('Jane Doe');
    pick('Bob Ray');
    pick('Cy Lee');
    expect(titleInputs().map((input) => input.value)).toEqual([
      'Onboard Jane Doe',
      'Onboard Bob Ray',
      'Onboard Cy Lee',
    ]);
    // Deselecting removes the row.
    pick('Bob Ray');
    expect(titleInputs().map((input) => input.value)).toEqual(['Onboard Jane Doe', 'Onboard Cy Lee']);
  });

  it('offers to replace the source contact name and inserts tokens', async () => {
    renderDialog();
    await loaded();
    expect(screen.getByText(/Replace "John Smith" with \{\{contact\}\}/)).toBeInTheDocument();
    fireEvent.click(document.getElementById('batch-duplicate-replace-name')!);
    expect(screen.getByLabelText('Title template')).toHaveValue('Onboard {{contact}}');
    fireEvent.click(document.getElementById('batch-duplicate-token-client')!);
    expect(screen.getByLabelText('Title template')).toHaveValue('Onboard {{contact}}{{client}}');
  });

  it('inserts a token at the caret, replacing the selection', async () => {
    renderDialog();
    await loaded();
    const input = screen.getByLabelText('Title template') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Onboard X today' } });
    input.setSelectionRange(8, 9); // select "X"
    fireEvent.click(document.getElementById('batch-duplicate-token-contact')!);
    expect(input).toHaveValue('Onboard {{contact}} today');
  });

  it('template changes update unedited rows but not edited ones; reset returns a row to the template', async () => {
    renderDialog();
    await loaded();
    fireEvent.change(screen.getByLabelText('Title template'), { target: { value: 'A {{contact}}' } });
    pick('Jane Doe');
    pick('Bob Ray');
    const [first] = titleInputs();
    fireEvent.change(first, { target: { value: 'Custom for Jane' } });
    fireEvent.change(screen.getByLabelText('Title template'), { target: { value: 'B {{contact}}' } });
    expect(titleInputs().map((input) => input.value)).toEqual(['Custom for Jane', 'B Bob Ray']);

    fireEvent.click(document.querySelector<HTMLElement>('[id$="-reset"]')!);
    expect(titleInputs().map((input) => input.value)).toEqual(['B Jane Doe', 'B Bob Ray']);
  });

  it('blocks Review for a blank row that uses {{contact}}', async () => {
    renderDialog();
    await loaded();
    fireEvent.change(screen.getByLabelText('Title template'), { target: { value: 'Onboard {{contact}}' } });
    fireEvent.click(document.getElementById('batch-duplicate-add-blank-row')!);
    expect(document.getElementById('batch-duplicate-review-button')).toBeDisabled();
    expect(screen.getByText(/has no contact/)).toBeInTheDocument();

    // Editing the row's own title clears the error.
    fireEvent.change(titleInputs()[0], { target: { value: 'No contact copy' } });
    expect(document.getElementById('batch-duplicate-review-button')).not.toBeDisabled();
  });

  it('does not use allowOverflow, bounds the rows with their own scroll, and pins step buttons in the footer', async () => {
    renderDialog();
    await loaded();
    fireEvent.change(screen.getByLabelText('Title template'), { target: { value: 'Copy' } });
    pick('Jane Doe');
    pick('Bob Ray');

    const props = dialogPropsSpy.mock.calls.at(-1)![0];
    expect(props.allowOverflow).toBeFalsy();

    const scroll = document.getElementById('batch-duplicate-rows-scroll')!;
    expect(scroll.className).toMatch(/max-h-72/);
    expect(scroll.className).toMatch(/overflow-y-auto/);
    expect(scroll).toContainElement(document.getElementById('batch-duplicate-rows')!);

    const footer = screen.getByTestId('dialog-footer');
    expect(within(footer).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(footer).toContainElement(document.getElementById('batch-duplicate-review-button')!);

    fireEvent.click(document.getElementById('batch-duplicate-review-button')!);
    expect(screen.getByTestId('dialog-footer')).toContainElement(document.getElementById('batch-duplicate-create-button')!);
    expect(screen.getByTestId('dialog-footer')).toContainElement(document.getElementById('batch-duplicate-back-button')!);
  });

  it('enforces the cap of 50 copies', async () => {
    renderDialog();
    await loaded();
    fireEvent.change(screen.getByLabelText('Title template'), { target: { value: 'Copy' } });
    const add = document.getElementById('batch-duplicate-add-blank-row')!;
    for (let i = 0; i < BATCH_DUPLICATE_MAX_COPIES + 5; i += 1) fireEvent.click(add);
    expect(titleInputs()).toHaveLength(BATCH_DUPLICATE_MAX_COPIES);
    expect(add).toBeDisabled();
    expect(document.getElementById('batch-duplicate-count')).toHaveTextContent('50 of 50');
  });

  it('review lists the shared copy set and the final titles', async () => {
    renderDialog();
    await loaded();
    fireEvent.change(screen.getByLabelText('Title template'), { target: { value: 'Onboard {{contact}}' } });
    pick('Jane Doe');
    pick('Bob Ray');
    fireEvent.click(document.getElementById('batch-duplicate-review-button')!);

    const summary = document.getElementById('batch-duplicate-review-summary')!;
    expect(within(summary).getByText('Acme')).toBeInTheDocument();
    expect(within(summary).getByText('Support')).toBeInTheDocument();
    expect(within(summary).getByText('High')).toBeInTheDocument();
    expect(within(summary).getByText('Ann Agent')).toBeInTheDocument();
    expect(within(summary).getByText('Hardware › Laptops')).toBeInTheDocument();
    expect(within(summary).getByText('Onboarding Crew')).toBeInTheDocument();
    expect(within(summary).queryByText('Same as source')).toBeNull();
    expect(within(summary).getByText('onboarding')).toBeInTheDocument();
    expect(within(summary).getByText('Copy 2 items (unchecked)')).toBeInTheDocument();
    expect(within(summary).getByText('Board default')).toBeInTheDocument();
    expect(screen.getByText(/are not copied/)).toBeInTheDocument();

    const list = document.getElementById('batch-duplicate-review-list')!;
    expect(list).toHaveTextContent('Jane Doe→Onboard Jane Doe');
    expect(list).toHaveTextContent('Bob Ray→Onboard Bob Ray');
    expect(document.getElementById('batch-duplicate-create-button')).toHaveTextContent('Create 2 tickets');
  });

  it('says so explicitly when a referenced name cannot be resolved', async () => {
    getTicketDuplicateSourceMock.mockResolvedValue({ ...source, assigned_team_name: null, category_name: null });
    renderDialog();
    await loaded();
    pick('Jane Doe');
    fireEvent.click(document.getElementById('batch-duplicate-review-button')!);
    const summary = document.getElementById('batch-duplicate-review-summary')!;
    expect(within(summary).getAllByText(/Name unavailable/).length).toBeGreaterThanOrEqual(2);
    expect(within(summary).queryByText('Same as source')).toBeNull();
  });

  it('asks before Cancel discards copies that were set up, and closes straight away when nothing was', async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    await loaded();
    fireEvent.click(document.getElementById('batch-duplicate-cancel-button')!);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    pick('Jane Doe');
    fireEvent.click(document.getElementById('batch-duplicate-cancel-button')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Discard these copies?')).toBeInTheDocument();
    fireEvent.click(document.getElementById('batch-duplicate-discard-dialog-keep')!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.getElementById('batch-duplicate-cancel-button')!);
    fireEvent.click(document.getElementById('batch-duplicate-discard-dialog-confirm')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends { key, contactId, title } rows and copyChecklist to duplicateTicketBatch', async () => {
    duplicateTicketBatchMock.mockResolvedValue({
      batchId: 'b1',
      created: [
        { key: 'r1', ticketId: 't1', ticketNumber: 'T-101', title: 'Onboard Jane Doe' },
        { key: 'r2', ticketId: 't2', ticketNumber: 'T-102', title: 'Onboard Bob Ray' },
      ],
      failed: [],
    });
    const { onCompleted, onClose } = renderDialog();
    await loaded();
    fireEvent.change(screen.getByLabelText('Title template'), { target: { value: 'Onboard {{contact}}' } });
    pick('Jane Doe');
    pick('Bob Ray');
    fireEvent.click(document.getElementById('batch-duplicate-copy-checklist')!);
    fireEvent.click(document.getElementById('batch-duplicate-review-button')!);
    fireEvent.click(document.getElementById('batch-duplicate-create-button')!);

    await waitFor(() => expect(duplicateTicketBatchMock).toHaveBeenCalledTimes(1));
    expect(duplicateTicketBatchMock).toHaveBeenCalledWith(
      'src-1',
      [
        { key: 'r1', contactId: 'c-jane', title: 'Onboard Jane Doe' },
        { key: 'r2', contactId: 'c-bob', title: 'Onboard Bob Ray' },
      ],
      { copyChecklist: false }
    );

    const link = await screen.findByRole('link', { name: '#T-101 Onboard Jane Doe' });
    expect(link).toHaveAttribute('href', '/msp/tickets/t1');
    fireEvent.click(document.getElementById('batch-duplicate-done-button')!);
    expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'b1' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows created and failed copies after a partial failure and retries only the failed keys', async () => {
    duplicateTicketBatchMock
      .mockResolvedValueOnce({
        batchId: 'b1',
        created: [{ key: 'r1', ticketId: 't1', ticketNumber: 'T-101', title: 'Onboard Jane Doe' }],
        failed: [{ key: 'r2', message: 'Contact does not belong to Acme' }],
      })
      .mockResolvedValueOnce({
        batchId: 'b2',
        created: [{ key: 'r2', ticketId: 't2', ticketNumber: 'T-102', title: 'Onboard Bob Ray' }],
        failed: [],
      });
    renderDialog();
    await loaded();
    fireEvent.change(screen.getByLabelText('Title template'), { target: { value: 'Onboard {{contact}}' } });
    pick('Jane Doe');
    pick('Bob Ray');
    fireEvent.click(document.getElementById('batch-duplicate-review-button')!);
    fireEvent.click(document.getElementById('batch-duplicate-create-button')!);

    expect(await screen.findByRole('link', { name: '#T-101 Onboard Jane Doe' })).toBeInTheDocument();
    expect(screen.getByText(/Contact does not belong to Acme/)).toBeInTheDocument();
    const retry = document.getElementById('batch-duplicate-retry-button')!;
    expect(retry).toHaveTextContent('Retry failed (1)');

    fireEvent.click(retry);
    await waitFor(() => expect(duplicateTicketBatchMock).toHaveBeenCalledTimes(2));
    expect(duplicateTicketBatchMock.mock.calls[1][1]).toEqual([
      { key: 'r2', contactId: 'c-bob', title: 'Onboard Bob Ray' },
    ]);
    // Created rows from both rounds are listed; nothing failed any more.
    expect(await screen.findByRole('link', { name: '#T-102 Onboard Bob Ray' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#T-101 Onboard Jane Doe' })).toBeInTheDocument();
    expect(document.getElementById('batch-duplicate-retry-button')).toBeNull();
  });

  it('keeps the user on review with an alert when the whole request is refused', async () => {
    duplicateTicketBatchMock.mockResolvedValue({ actionError: 'Source ticket not found' });
    renderDialog();
    await loaded();
    fireEvent.change(screen.getByLabelText('Title template'), { target: { value: 'Onboard {{contact}}' } });
    pick('Jane Doe');
    fireEvent.click(document.getElementById('batch-duplicate-review-button')!);
    fireEvent.click(document.getElementById('batch-duplicate-create-button')!);

    expect(await screen.findByText('Source ticket not found')).toBeInTheDocument();
    expect(document.getElementById('batch-duplicate-create-button')).toBeInTheDocument();
    expect(document.getElementById('batch-duplicate-created-list')).toBeNull();
  });

  it('disables the dialog when the source cannot be loaded', async () => {
    getTicketDuplicateSourceMock.mockResolvedValue({ permissionError: 'Permission denied: Cannot create ticket' });
    renderDialog();
    expect(await screen.findByText('Permission denied: Cannot create ticket')).toBeInTheDocument();
    expect(screen.queryByLabelText('Title template')).toBeNull();
    expect(document.getElementById('batch-duplicate-review-button')).toBeNull();
  });
});
