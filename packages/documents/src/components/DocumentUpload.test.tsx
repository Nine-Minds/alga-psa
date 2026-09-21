/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { IDocument } from '@alga-psa/types';
// Import the .tsx explicitly: src/components ships stale committed .jsx twins
// that Vite's default extension order would otherwise prefer.
import DocumentUpload from './DocumentUpload.tsx';
import { uploadDocument } from '../actions/documentActions';

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

vi.mock('../actions/documentActions', () => ({
  uploadDocument: vi.fn(),
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

const makeDocument = (name: string): IDocument => ({
  document_id: `doc-${name}`,
  document_name: name,
  file_id: `file-${name}`,
} as IDocument);

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
    (uploadDocument as unknown as { mockReset: () => void }).mockReset();
  });

  it('keeps a returned upload error visible with one failure announcement', async () => {
    (uploadDocument as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      success: false,
      error: 'File type not allowed',
    });
    const { input } = renderUpload();

    selectFiles(input, [makeFile('report.eml')]);

    await waitFor(() => expect(screen.getByText('report.eml')).toBeInTheDocument());
    expect(screen.getByText('File type not allowed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Browse Files/i })).not.toBeDisabled();
  });

  it('keeps a permission error readable after processing', async () => {
    (uploadDocument as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      permissionError: 'Permission denied: Cannot create documents',
    });
    const { input } = renderUpload();

    selectFiles(input, [makeFile('restricted.pdf')]);

    await waitFor(() =>
      expect(screen.getByText('Permission denied: Cannot create documents')).toBeInTheDocument(),
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('uses a safe localized fallback for a thrown transport error', async () => {
    (uploadDocument as unknown as { mockRejectedValueOnce: (v: unknown) => void }).mockRejectedValueOnce(
      new Error('socket hang up at internal stack line 42'),
    );
    const { input } = renderUpload();

    selectFiles(input, [makeFile('opaque.bin')]);

    await waitFor(() => expect(screen.getByText('Failed to upload file')).toBeInTheDocument());
    expect(screen.queryByText(/internal stack line 42/)).not.toBeInTheDocument();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('retains success and failure rows in a success-then-failure batch', async () => {
    (uploadDocument as unknown as { mockResolvedValueOnce: (v: unknown) => void })
      .mockResolvedValueOnce({ success: true, document: makeDocument('good.pdf') })
      .mockResolvedValueOnce({ success: false, error: 'Blocked MIME type' });
    const { input, props } = renderUpload();

    selectFiles(input, [makeFile('good.pdf'), makeFile('bad.eml')]);

    await waitFor(() => expect(screen.getByText('Blocked MIME type')).toBeInTheDocument());
    expect(screen.getByText('good.pdf')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.getByText('bad.eml')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(props.onUploadComplete).toHaveBeenCalledTimes(1);
    expect(props.onAllUploadsComplete).toHaveBeenCalledWith({ total: 2, succeeded: 1, failed: 1 });
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('retains success and failure rows in a failure-then-success batch', async () => {
    (uploadDocument as unknown as { mockResolvedValueOnce: (v: unknown) => void })
      .mockResolvedValueOnce({ success: false, error: 'Blocked MIME type' })
      .mockResolvedValueOnce({ success: true, document: makeDocument('good.pdf') });
    const { input, props } = renderUpload();

    selectFiles(input, [makeFile('bad.eml'), makeFile('good.pdf')]);

    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument());
    expect(screen.getByText('good.pdf')).toBeInTheDocument();
    expect(screen.getByText('bad.eml')).toBeInTheDocument();
    expect(screen.getByText('Blocked MIME type')).toBeInTheDocument();
    expect(props.onAllUploadsComplete).toHaveBeenCalledWith({ total: 2, succeeded: 1, failed: 1 });
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('reports correct totals for an all-success batch with no failure toast', async () => {
    (uploadDocument as unknown as { mockResolvedValueOnce: (v: unknown) => void })
      .mockResolvedValueOnce({ success: true, document: makeDocument('a.pdf') })
      .mockResolvedValueOnce({ success: true, document: makeDocument('b.pdf') });
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
    (uploadDocument as unknown as { mockResolvedValueOnce: (v: unknown) => void })
      .mockResolvedValueOnce({ success: false, error: 'First failed' })
      .mockResolvedValueOnce({ success: false, error: 'Second failed' });
    const { input, props } = renderUpload();

    selectFiles(input, [makeFile('one.eml'), makeFile('two.eml')]);

    await waitFor(() =>
      expect(props.onAllUploadsComplete).toHaveBeenCalledWith({ total: 2, succeeded: 0, failed: 2 }),
    );
    expect(screen.getByText('First failed')).toBeInTheDocument();
    expect(screen.getByText('Second failed')).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('does not relabel a stored file when the per-file callback rejects', async () => {
    (uploadDocument as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      success: true,
      document: makeDocument('good.pdf'),
    });
    const onUploadComplete = vi.fn().mockRejectedValue(new Error('handler boom'));
    const { input } = renderUpload({ onUploadComplete });

    selectFiles(input, [makeFile('good.pdf')]);

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument());
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  });

  it('reports a refresh callback rejection separately without relabeling the upload', async () => {
    (uploadDocument as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      success: true,
      document: makeDocument('good.pdf'),
    });
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
    (uploadDocument as unknown as { mockReset: () => void }).mockReset();
  });

  it('guides the user for an empty drop without uploading or opening the folder selector', async () => {
    const { dropZone } = renderUpload({ folderPath: undefined });

    fireEvent.drop(dropZone, { dataTransfer: { files: [] } });

    await waitFor(() => expect(screen.getByText('No files received')).toBeInTheDocument());
    expect(screen.getByText(/Save the attachment or email to your computer/)).toBeInTheDocument();
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(folderModalSpy).not.toHaveBeenCalledWith(expect.objectContaining({ isOpen: true }));
    expect(toastFn).toHaveBeenCalledTimes(1);
  });

  it('cannot replace an active batch with an overlapping drop', async () => {
    let resolveUpload: (value: unknown) => void = () => {};
    (uploadDocument as unknown as { mockImplementation: (fn: () => Promise<unknown>) => void }).mockImplementation(
      () => new Promise((resolve) => { resolveUpload = resolve; }),
    );
    const { input, dropZone } = renderUpload();

    selectFiles(input, [makeFile('first.pdf')]);
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(1));

    fireEvent.drop(dropZone, { dataTransfer: { files: [makeFile('second.pdf')] } });

    await waitFor(() => expect(toastFn).toHaveBeenCalledTimes(1));
    expect(uploadDocument).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUpload({ success: true, document: makeDocument('first.pdf') });
    });

    await waitFor(() => expect(screen.getByText('first.pdf')).toBeInTheDocument());
    expect(screen.queryByText('second.pdf')).not.toBeInTheDocument();
  });

  it('resets the hidden input and starts a fresh batch when the same file is selected again', async () => {
    (uploadDocument as unknown as { mockResolvedValueOnce: (v: unknown) => void })
      .mockResolvedValueOnce({ success: false, error: 'Temporary failure' })
      .mockResolvedValueOnce({ success: true, document: makeDocument('retry.pdf') });
    const { input } = renderUpload();

    selectFiles(input, [makeFile('retry.pdf')]);
    await waitFor(() => expect(screen.getByText('Temporary failure')).toBeInTheDocument());
    expect(input.value).toBe('');

    selectFiles(input, [makeFile('retry.pdf')]);
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument());
    expect(screen.queryByText('Temporary failure')).not.toBeInTheDocument();
  });
});

describe('DocumentUpload folder destination selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (uploadDocument as unknown as { mockReset: () => void }).mockReset();
  });

  type FolderModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSelectFolder: (folder: string | null) => void;
  };

  const latestFolderProps = () =>
    folderModalSpy.mock.calls.at(-1)?.[0] as FolderModalProps;

  it('retains previous outcomes when folder selection is canceled', async () => {
    (uploadDocument as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      success: false,
      error: 'kept failure',
    });
    const { input } = renderUpload({ folderPath: undefined });

    selectFiles(input, [makeFile('first.eml')]);
    await waitFor(() => expect(latestFolderProps().isOpen).toBe(true));

    // Confirm the first batch (mirrors FolderSelectorModal.handleConfirm: select then close).
    act(() => {
      const props = latestFolderProps();
      props.onSelectFolder('/Root');
      props.onClose();
    });
    await waitFor(() => expect(screen.getByText('kept failure')).toBeInTheDocument());

    // A second selection opens the folder modal again; canceling must not clear the list.
    selectFiles(input, [makeFile('second.eml')]);
    await waitFor(() => expect(latestFolderProps().isOpen).toBe(true));
    act(() => {
      latestFolderProps().onClose();
    });

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect(screen.getByText('kept failure')).toBeInTheDocument();
  });

  it('uploads to the confirmed destination folder', async () => {
    (uploadDocument as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      success: true,
      document: makeDocument('filed.pdf'),
    });
    const { input } = renderUpload({ folderPath: undefined });

    selectFiles(input, [makeFile('filed.pdf')]);
    await waitFor(() => expect(latestFolderProps().isOpen).toBe(true));

    act(() => {
      const props = latestFolderProps();
      props.onSelectFolder('/Clients/Acme');
      props.onClose();
    });

    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(1));
    const uploadOptions = (uploadDocument as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as {
      folder_path: string | null;
    };
    expect(uploadOptions.folder_path).toBe('/Clients/Acme');
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument());
  });
});
