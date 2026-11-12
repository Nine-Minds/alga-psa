/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { UploadSessionClientError, uploadFileInSession } from '../lib/uploadSessionClient';
// Import the .tsx explicitly: src/components ships stale committed .jsx twins
// that Vite's default extension order would otherwise prefer.
import DocumentUpload from './DocumentUpload.tsx';

const { toastError, toastFn, folderModalSpy } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastFn: vi.fn(),
  folderModalSpy: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(toastFn, { error: toastError, success: vi.fn() }),
  toast: { error: toastError, success: vi.fn() },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown> | string) =>
      typeof options === 'string' ? options : (options?.defaultValue ?? _key),
  }),
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// The protocol client has its own tests; here it is the seam between the UI and the server.
vi.mock('../lib/uploadSessionClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/uploadSessionClient')>()),
  uploadFileInSession: vi.fn(),
}));

vi.mock('./AssociatedEntityPicker', () => ({
  default: () => null,
}));

vi.mock('./FolderSelectorModal', () => ({
  default: (props: Record<string, unknown>) => {
    folderModalSpy(props);
    return null;
  },
}));

const makeDocument = (name: string) => ({
  document_id: `doc-${name}`,
  document_name: name,
  file_id: `file-${name}`,
  mime_type: 'application/pdf',
  file_size: 4,
});

const uploadMock = uploadFileInSession as unknown as ReturnType<typeof vi.fn>;
const refuse = (...args: ConstructorParameters<typeof UploadSessionClientError>) =>
  new UploadSessionClientError(...args);

const makeFile = (name: string, type = 'application/pdf') =>
  new File(['data'], name, { type });

type UploadProps = React.ComponentProps<typeof DocumentUpload>;

function renderUpload(overrides: Partial<UploadProps> = {}) {
  const props: UploadProps = {
    id: 'upload-test',
    userId: 'user-1',
    entityId: 'ticket-1',
    entityType: 'ticket',
    folderPath: null,
    onUploadComplete: vi.fn(),
    onAllUploadsComplete: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  const utils = render(<DocumentUpload {...props} />);
  const input = utils.container.querySelector('input[type="file"]') as HTMLInputElement;
  const dropZone = utils.container.querySelector('.border-dashed') as HTMLElement;
  return { ...utils, props, input, dropZone };
}

const selectFiles = (input: HTMLInputElement, files: File[]) => {
  fireEvent.change(input, { target: { files } });
};

describe('DocumentUpload outcome feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMock.mockReset();
  });

  const settle = () =>
    waitFor(() => expect(screen.getByRole('button', { name: /Browse Files/i })).not.toBeDisabled());

  it('says the file type is not allowed, with one failure announcement', async () => {
    uploadMock.mockRejectedValueOnce(refuse('typeNotAllowed', 'File type not allowed'));
    const { input } = renderUpload();

    selectFiles(input, [makeFile('report.eml')]);

    await waitFor(() =>
      expect(screen.getByText("This file type isn't allowed. Choose a different file.")).toBeInTheDocument(),
    );
    await settle();
    expect(screen.getByText('report.eml')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Failed to upload file')).not.toBeInTheDocument();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('names both the file size and the API-provided limit for an over-limit file', async () => {
    uploadMock
      .mockRejectedValueOnce(refuse('tooLarge', 'File size exceeds limit', { status: 413, maxFileSize: 5 * 1024 * 1024 * 1024 }))
      .mockResolvedValueOnce(makeDocument('small.pdf'));
    const { input } = renderUpload();
    const big = makeFile('huge.iso');
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 * 1024 });

    selectFiles(input, [big, makeFile('small.pdf')]);

    await waitFor(() =>
      expect(screen.getByText('This file is 6 GB. The current limit is 5 GB per file.')).toBeInTheDocument(),
    );
    await settle();
    // The server decides; the UI neither pre-filters nor hardcodes a limit, and the rest of the batch goes on.
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(screen.getByText('huge.iso')).toBeInTheDocument();
  });

  it('says permission was denied', async () => {
    uploadMock.mockRejectedValueOnce(refuse('permissionDenied', 'Permission denied: Cannot create documents', { status: 403 }));
    const { input } = renderUpload();

    selectFiles(input, [makeFile('restricted.pdf')]);

    await waitFor(() =>
      expect(screen.getByText("You don't have permission to upload documents here.")).toBeInTheDocument(),
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('says the connection was interrupted once the retries ran out, and offers to try again', async () => {
    uploadMock.mockRejectedValueOnce(refuse('network', 'socket hang up at internal stack line 42'));
    const { input } = renderUpload();

    selectFiles(input, [makeFile('flaky.bin')]);

    await waitFor(() =>
      expect(screen.getByText(/The connection was interrupted and the upload could not be resumed/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/internal stack line 42/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('offers to start again when the session expired, and sends the file to the same folder', async () => {
    uploadMock
      .mockRejectedValueOnce(refuse('sessionGone', 'gone', { status: 410 }))
      .mockResolvedValueOnce(makeDocument('late.pdf'));
    const { input } = renderUpload({ folderPath: '/Clients/Acme' });

    selectFiles(input, [makeFile('late.pdf')]);
    await waitFor(() => expect(screen.getByText('This upload expired before it finished. Start it again.')).toBeInTheDocument());
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));

    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument());
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(uploadMock.mock.calls[1][0].target.folderPath).toBe('/Clients/Acme');
  });

  it('keeps the generic message for a failure with no known cause', async () => {
    uploadMock.mockRejectedValueOnce(new Error('socket hang up at internal stack line 42'));
    const { input } = renderUpload();

    selectFiles(input, [makeFile('opaque.bin')]);

    await waitFor(() => expect(screen.getByText('Failed to upload file')).toBeInTheDocument());
    expect(screen.queryByText(/internal stack line 42/)).not.toBeInTheDocument();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('shows committed bytes over the total in a progress bar while uploading', async () => {
    let report: (p: { committed: number; total: number }) => void = () => {};
    let finish: (d: unknown) => void = () => {};
    uploadMock.mockImplementation((input: { onProgress: typeof report }) => {
      report = input.onProgress;
      return new Promise((resolve) => { finish = resolve; });
    });
    const { input } = renderUpload();
    const big = makeFile('movie.mp4', 'video/mp4');
    Object.defineProperty(big, 'size', { value: 400 * 1024 * 1024 });

    selectFiles(input, [big]);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));

    act(() => report({ committed: 100 * 1024 * 1024, total: 400 * 1024 * 1024 }));

    const bar = await screen.findByRole('progressbar', { name: 'Upload progress for movie.mp4' });
    // 100 of 400 MB committed: the indicator is shifted left by the 75% still to go.
    expect(bar.firstElementChild).toHaveStyle({ transform: 'translateX(-75%)' });
    expect(screen.getByText('100 MB of 400 MB')).toBeInTheDocument();

    await act(async () => finish(makeDocument('movie.mp4')));
    await settle();
  });

  it('cancels the upload in flight and marks the file cancelled without a failure toast', async () => {
    uploadMock.mockImplementation((input: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(refuse('cancelled', 'Upload cancelled')));
      }));
    const { input, props } = renderUpload();

    selectFiles(input, [makeFile('slow.bin')]);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel upload' }));

    await waitFor(() => expect(screen.getByText('Cancelled')).toBeInTheDocument());
    await settle();
    expect(toastError).not.toHaveBeenCalled();
    expect(props.onAllUploadsComplete).toHaveBeenCalledWith({ total: 1, succeeded: 0, failed: 1 });
  });

  it('retains success and failure rows in a success-then-failure batch', async () => {
    uploadMock.mockResolvedValueOnce(makeDocument('good.pdf'))
      .mockRejectedValueOnce(refuse('typeNotAllowed', 'File type not allowed'));
    const { input, props } = renderUpload();

    selectFiles(input, [makeFile('good.pdf'), makeFile('bad.eml')]);

    await waitFor(() => expect(screen.getByText(/file type isn't allowed/)).toBeInTheDocument());
    expect(screen.getByText('good.pdf')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.getByText('bad.eml')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(props.onUploadComplete).toHaveBeenCalledTimes(1);
    expect(props.onAllUploadsComplete).toHaveBeenCalledWith({ total: 2, succeeded: 1, failed: 1 });
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('retains success and failure rows in a failure-then-success batch', async () => {
    uploadMock.mockRejectedValueOnce(refuse('typeNotAllowed', 'File type not allowed'))
      .mockResolvedValueOnce(makeDocument('good.pdf'));
    const { input, props } = renderUpload();

    selectFiles(input, [makeFile('bad.eml'), makeFile('good.pdf')]);

    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument());
    expect(screen.getByText('good.pdf')).toBeInTheDocument();
    expect(screen.getByText('bad.eml')).toBeInTheDocument();
    expect(screen.getByText(/file type isn't allowed/)).toBeInTheDocument();
    expect(props.onAllUploadsComplete).toHaveBeenCalledWith({ total: 2, succeeded: 1, failed: 1 });
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('reports correct totals for an all-success batch with no failure toast', async () => {
    uploadMock.mockResolvedValueOnce(makeDocument('a.pdf'))
      .mockResolvedValueOnce(makeDocument('b.pdf'));
    const { input, props } = renderUpload();

    selectFiles(input, [makeFile('a.pdf'), makeFile('b.pdf')]);

    await waitFor(() =>
      expect(props.onAllUploadsComplete).toHaveBeenCalledWith({ total: 2, succeeded: 2, failed: 0 }),
    );
    expect(screen.getByText('a.pdf')).toBeInTheDocument();
    expect(screen.getByText('b.pdf')).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('finishes every attempt and reports totals for an all-failure batch', async () => {
    uploadMock.mockRejectedValueOnce(refuse('permissionDenied', 'denied'))
      .mockRejectedValueOnce(refuse('network', 'dropped'));
    const { input, props } = renderUpload();

    selectFiles(input, [makeFile('one.eml'), makeFile('two.eml')]);

    await waitFor(() =>
      expect(props.onAllUploadsComplete).toHaveBeenCalledWith({ total: 2, succeeded: 0, failed: 2 }),
    );
    expect(screen.getByText(/don't have permission/)).toBeInTheDocument();
    expect(screen.getByText(/connection was interrupted/)).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('does not relabel a stored file when the per-file callback rejects', async () => {
    uploadMock.mockResolvedValueOnce(makeDocument('good.pdf'));
    const onUploadComplete = vi.fn().mockRejectedValue(new Error('handler boom'));
    const { input } = renderUpload({ onUploadComplete });

    selectFiles(input, [makeFile('good.pdf')]);

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument());
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  });

  it('reports a rejected per-file success callback with reload guidance without relabeling', async () => {
    uploadMock.mockResolvedValueOnce(makeDocument('good.pdf'));
    const onUploadComplete = vi.fn().mockRejectedValue(new Error('consumer refresh boom'));
    const { input } = renderUpload({ onUploadComplete });

    selectFiles(input, [makeFile('good.pdf')]);

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Your files were uploaded, but the document list could not refresh. Reload the page to see them.',
      ),
    );
    // The stored file stays a success.
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  });

  it('reports a refresh callback rejection separately without relabeling the upload', async () => {
    uploadMock.mockResolvedValueOnce(makeDocument('good.pdf'));
    const onAllUploadsComplete = vi.fn().mockRejectedValue(new Error('refresh boom'));
    const { input } = renderUpload({ onAllUploadsComplete });

    selectFiles(input, [makeFile('good.pdf')]);

    await waitFor(() => expect(onAllUploadsComplete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument());
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith(
      'Your files were uploaded, but the document list could not refresh. Reload the page to see them.',
    );
  });
});

describe('DocumentUpload empty drops and batch guarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMock.mockReset();
  });

  it('guides the user for an empty drop without uploading or opening the folder selector', async () => {
    const { dropZone } = renderUpload({ folderPath: undefined });

    fireEvent.drop(dropZone, { dataTransfer: { files: [] } });

    await waitFor(() => expect(screen.getByText('No files received')).toBeInTheDocument());
    expect(screen.getByText(/Save the attachment or email to your computer/)).toBeInTheDocument();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(folderModalSpy).not.toHaveBeenCalledWith(expect.objectContaining({ isOpen: true }));
    expect(toastFn).toHaveBeenCalledTimes(1);
  });

  it('cannot replace an active batch with an overlapping drop', async () => {
    let resolveUpload: (value: unknown) => void = () => {};
    uploadMock.mockImplementation(
      () => new Promise((resolve) => { resolveUpload = resolve; }),
    );
    const { input, dropZone } = renderUpload();

    selectFiles(input, [makeFile('first.pdf')]);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));

    fireEvent.drop(dropZone, { dataTransfer: { files: [makeFile('second.pdf')] } });

    await waitFor(() => expect(toastFn).toHaveBeenCalledTimes(1));
    expect(uploadMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUpload(makeDocument('first.pdf'));
    });

    await waitFor(() => expect(screen.getByText('first.pdf')).toBeInTheDocument());
    expect(screen.queryByText('second.pdf')).not.toBeInTheDocument();
  });

  it('resets the hidden input and starts a fresh batch when the same file is selected again', async () => {
    uploadMock.mockRejectedValueOnce(refuse('network', 'dropped'))
      .mockResolvedValueOnce(makeDocument('retry.pdf'));
    const { input } = renderUpload();

    selectFiles(input, [makeFile('retry.pdf')]);
    await waitFor(() => expect(screen.getByText(/connection was interrupted/)).toBeInTheDocument());
    expect(input.value).toBe('');

    selectFiles(input, [makeFile('retry.pdf')]);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument());
    expect(screen.queryByText(/connection was interrupted/)).not.toBeInTheDocument();
  });
});

describe('DocumentUpload folder destination selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMock.mockReset();
  });

  type FolderModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSelectFolder: (folder: string | null) => void;
  };

  const latestFolderProps = () =>
    folderModalSpy.mock.calls.at(-1)?.[0] as FolderModalProps;

  it('retains previous outcomes when folder selection is canceled', async () => {
    uploadMock.mockRejectedValueOnce(refuse('typeNotAllowed', 'kept failure'));
    const { input } = renderUpload({ folderPath: undefined });

    selectFiles(input, [makeFile('first.eml')]);
    await waitFor(() => expect(latestFolderProps().isOpen).toBe(true));

    // Confirm the first batch (mirrors FolderSelectorModal.handleConfirm: select then close).
    act(() => {
      const props = latestFolderProps();
      props.onSelectFolder('/Root');
      props.onClose();
    });
    await waitFor(() => expect(screen.getByText(/file type isn't allowed/)).toBeInTheDocument());

    // A second selection opens the folder modal again; canceling must not clear the list.
    selectFiles(input, [makeFile('second.eml')]);
    await waitFor(() => expect(latestFolderProps().isOpen).toBe(true));
    act(() => {
      latestFolderProps().onClose();
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/file type isn't allowed/)).toBeInTheDocument();
  });

  it('uploads to the confirmed destination folder', async () => {
    uploadMock.mockResolvedValueOnce(makeDocument('filed.pdf'));
    const { input } = renderUpload({ folderPath: undefined });

    selectFiles(input, [makeFile('filed.pdf')]);
    await waitFor(() => expect(latestFolderProps().isOpen).toBe(true));

    act(() => {
      const props = latestFolderProps();
      props.onSelectFolder('/Clients/Acme');
      props.onClose();
    });

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(uploadMock.mock.calls[0][0].target).toEqual({
      entityType: 'ticket',
      entityId: 'ticket-1',
      folderPath: '/Clients/Acme',
    });
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument());
  });
});
