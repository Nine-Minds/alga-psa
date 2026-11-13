/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const getClientTicketFormDataMock = vi.fn();
const createClientTicketMock = vi.fn();
const finalizeClientTicketDescriptionMock = vi.fn();
const uploadDocumentMock = vi.fn();
const toastErrorMock = vi.fn();

const NEW_TICKET_ID = '00000000-0000-4000-8000-0000000000aa';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: any, maybeOptions?: any) => {
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : options?.defaultValue;
      let text = String(fallback ?? key);
      for (const [name, value] of Object.entries(options ?? {})) {
        text = text.replace(`{{${name}}}`, String(value));
      }
      return text;
    },
  }),
}));

vi.mock('@alga-psa/client-portal/actions', () => ({
  createClientTicket: (...args: any[]) => createClientTicketMock(...args),
  finalizeClientTicketDescription: (...args: any[]) => finalizeClientTicketDescriptionMock(...args),
}));

vi.mock('@alga-psa/tickets/actions/ticketFormActions', () => ({
  getClientTicketFormData: (...args: any[]) => getClientTicketFormDataMock(...args),
  getClientTicketPrioritiesForBoard: vi.fn(),
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  uploadDocument: (...args: any[]) => uploadDocumentMock(...args),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'client-user-1' } }, status: 'authenticated' }),
}));

vi.mock('react-hot-toast', () => {
  const toast = { error: (...args: any[]) => toastErrorMock(...args), success: vi.fn() };
  return { toast, default: toast };
});

// The real staging hook is exercised on purpose: the point of the flow is that a
// paste writes nothing to the server until the ticket exists.
vi.mock('@alga-psa/ui/editor', () => ({
  TextEditor: ({ onContentChange, uploadFile }: any) => (
    <div>
      <button
        type="button"
        data-testid="paste-image"
        onClick={async () => {
          const url = await uploadFile(new File(['screenshot-bytes'], 'paste.png', { type: 'image/png' }));
          onContentChange?.([{ type: 'image', props: { url } }]);
        }}
      >
        paste image
      </button>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, disabled, type = 'button', onClick, ...props }: any) => (
    <button type={type} disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Spinner', () => ({
  default: () => <div>Loading</div>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, title, onConfirm, id }: any) =>
    isOpen ? (
      <div data-testid={id}>
        <span>{title}</span>
        <button type="button" onClick={() => onConfirm()}>
          confirm-discard
        </button>
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, placeholder }: any) => (
    <select
      aria-label={placeholder}
      data-testid={id}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import { ClientAddTicket } from './ClientAddTicket';

let objectUrlSequence = 0;

function uploadedDocument(fileId: string) {
  return {
    success: true as const,
    document: { document_id: `doc-${fileId}`, file_id: fileId, mime_type: 'image/png' },
  };
}

async function renderDialog() {
  const onOpenChange = vi.fn();
  const onTicketAdded = vi.fn();
  render(<ClientAddTicket open onOpenChange={onOpenChange} onTicketAdded={onTicketAdded} />);

  await waitFor(() => {
    expect(screen.getByTestId('client-ticket-board')).toHaveValue('board-1');
  });

  fireEvent.change(screen.getByTestId('client-ticket-priority'), { target: { value: 'priority-1' } });
  return { onOpenChange, onTicketAdded };
}

function pickAttachment(file: File) {
  const input = document.getElementById('client-add-ticket-attachments-input') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

function submitForm() {
  const form = document.getElementById('client-add-ticket-form') as HTMLFormElement;
  fireEvent.submit(form);
}

describe('ClientAddTicket image paste and attachments', () => {
  beforeEach(() => {
    objectUrlSequence = 0;
    (URL as any).createObjectURL = vi.fn(() => `blob:portal-${++objectUrlSequence}`);
    (URL as any).revokeObjectURL = vi.fn();
    getClientTicketFormDataMock.mockResolvedValue({
      boards: [{ board_id: 'board-1', board_name: 'Support', is_default: true }],
      priorities: [{ priority_id: 'priority-1', priority_name: 'Medium' }],
    });
    createClientTicketMock.mockResolvedValue({ ticket_id: NEW_TICKET_ID, attributes: {} });
    finalizeClientTicketDescriptionMock.mockResolvedValue(undefined);
    uploadDocumentMock.mockResolvedValue(uploadedDocument('file-1'));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('stages a pasted image locally without any upload before the ticket is created', async () => {
    await renderDialog();

    fireEvent.click(screen.getByTestId('paste-image'));

    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });
    expect(uploadDocumentMock).not.toHaveBeenCalled();
    expect(createClientTicketMock).not.toHaveBeenCalled();
    expect(finalizeClientTicketDescriptionMock).not.toHaveBeenCalled();
  });

  it('accepts a screenshot-only description and sends the create call without the staged image', async () => {
    await renderDialog();
    fireEvent.change(document.getElementById('client-ticket-title') as HTMLInputElement, {
      target: { value: 'Printer error' },
    });
    fireEvent.click(screen.getByTestId('paste-image'));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));

    submitForm();

    await waitFor(() => expect(createClientTicketMock).toHaveBeenCalledTimes(1));
    const sentDescription = (createClientTicketMock.mock.calls[0][0] as FormData).get('description');
    // The blocks that point at object URLs cannot survive the create call.
    expect(sentDescription).toBe('[]');
    expect(screen.queryByText('create.errors.descriptionRequired')).not.toBeInTheDocument();
  });

  it('uploads staged images against the new ticket and persists the rewritten description', async () => {
    const { onOpenChange, onTicketAdded } = await renderDialog();
    fireEvent.change(document.getElementById('client-ticket-title') as HTMLInputElement, {
      target: { value: 'Printer error' },
    });
    fireEvent.click(screen.getByTestId('paste-image'));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    pickAttachment(new File(['log-bytes'], 'error-log.txt', { type: 'text/plain' }));

    submitForm();

    await waitFor(() => expect(finalizeClientTicketDescriptionMock).toHaveBeenCalledTimes(1));

    // One upload for the pasted image, one for the picked attachment, both on the new ticket.
    expect(uploadDocumentMock).toHaveBeenCalledTimes(2);
    for (const call of uploadDocumentMock.mock.calls) {
      expect(call[1]).toEqual({ userId: 'client-user-1', ticketId: NEW_TICKET_ID });
    }
    expect((uploadDocumentMock.mock.calls[1][0] as FormData).get('file')).toMatchObject({
      name: 'error-log.txt',
    });

    const [finalizedTicketId, finalizedDescription] = finalizeClientTicketDescriptionMock.mock.calls[0];
    expect(finalizedTicketId).toBe(NEW_TICKET_ID);
    expect(JSON.parse(finalizedDescription as string)).toEqual([
      { type: 'image', props: { url: '/api/documents/view/file-1' } },
    ]);
    expect(finalizedDescription).not.toContain('blob:');

    // Object URLs are only revoked once the finalized description is persisted.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:portal-1');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onTicketAdded).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('asks before discarding staged images when the dialog is closed', async () => {
    const { onOpenChange } = await renderDialog();
    fireEvent.click(screen.getByTestId('paste-image'));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));

    fireEvent.click(document.getElementById('cancel-ticket-button') as HTMLButtonElement);

    expect(
      screen.getByTestId('client-add-ticket-description-clipboard-draft-cancel-dialog')
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('confirm-discard'));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:portal-1');
    expect(createClientTicketMock).not.toHaveBeenCalled();
  });

  it('uploads nothing when the ticket could not be created', async () => {
    createClientTicketMock.mockResolvedValue({ actionError: 'Failed to create ticket' });
    const { onOpenChange } = await renderDialog();
    fireEvent.change(document.getElementById('client-ticket-title') as HTMLInputElement, {
      target: { value: 'Printer error' },
    });
    fireEvent.click(screen.getByTestId('paste-image'));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    pickAttachment(new File(['log-bytes'], 'error-log.txt', { type: 'text/plain' }));

    submitForm();

    await waitFor(() => expect(screen.getByText('messages.failedToCreateTicket')).toBeInTheDocument());
    expect(uploadDocumentMock).not.toHaveBeenCalled();
    expect(finalizeClientTicketDescriptionMock).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('keeps the created ticket and names the files that failed to attach', async () => {
    uploadDocumentMock.mockResolvedValue({ success: false, error: 'storage unavailable' });
    const { onOpenChange, onTicketAdded } = await renderDialog();
    fireEvent.change(document.getElementById('client-ticket-title') as HTMLInputElement, {
      target: { value: 'Printer error' },
    });
    fireEvent.click(screen.getByTestId('paste-image'));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    pickAttachment(new File(['log-bytes'], 'error-log.txt', { type: 'text/plain' }));

    submitForm();

    await waitFor(() => expect(onTicketAdded).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Ticket created, but pasted images could not be attached to the description.'
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Ticket created, but these files could not be attached: error-log.txt. Add them from the ticket.',
      { duration: 10000 }
    );
    expect(finalizeClientTicketDescriptionMock).not.toHaveBeenCalled();
  });
});
