/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import TaskDocumentsSimple from './TaskDocumentsSimple';

afterEach(() => {
  // Explicit cleanup: @testing-library/react's module-level auto-cleanup is
  // not registered reliably when the module is externalized, and this project
  // config does not provide a global cleanup setup file.
  cleanup();
});

const uploadState = vi.hoisted(() => ({ props: null as any }));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    getDocumentsByEntity: vi.fn().mockResolvedValue({ documents: [] }),
    removeDocumentAssociations: vi.fn(),
    ensureEntityFolders: vi.fn().mockResolvedValue({ success: true }),
    getBlockContent: vi.fn(),
    updateBlockContent: vi.fn(),
    createBlockDocument: vi.fn(),
    updateDocument: vi.fn(),
    downloadDocumentInBrowser: vi.fn(),
    downloadDocument: vi.fn(),
    renderDocumentUpload: (props: any) => {
      uploadState.props = props;
      return <div data-testid="upload-stub" />;
    },
    renderDocumentSelector: () => null,
    renderFolderSelectorModal: () => null,
    renderDocumentStorageCard: () => null,
  }),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1' }),
}));

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: () => null,
  TextEditor: () => null,
}));

vi.mock('@blocknote/core', () => ({
  BlockNoteEditor: class {},
}));

vi.mock('@alga-psa/ui/context', () => ({
  useRegisterUnsavedChanges: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, any> | string) =>
      typeof options === 'string' ? options : (options?.defaultValue ?? _key),
  }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Drawer', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  default: { success: vi.fn(), error: vi.fn() },
}));

const openUploader = async (container: HTMLElement) => {
  const uploadButton = container.querySelector('#task-documents-upload-btn') as HTMLButtonElement;
  fireEvent.click(uploadButton);
  await waitFor(() => expect(screen.getByTestId('upload-stub')).toBeInTheDocument());
};

describe('TaskDocumentsSimple upload batch lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadState.props = null;
  });

  it('keeps uploads open on failure and preserves per-file successful additions', async () => {
    const onDocumentAdded = vi.fn();
    const onDocumentCreated = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <TaskDocumentsSimple
        taskId="task-1"
        onDocumentAdded={onDocumentAdded}
        onDocumentCreated={onDocumentCreated}
      />,
    );

    await openUploader(container);

    // A successful per-file upload still notifies the parent.
    await act(async () => {
      await uploadState.props.onUploadComplete({
        success: true,
        document: {
          document_id: 'doc-1',
          document_name: 'good.pdf',
          mime_type: 'application/pdf',
          file_id: 'file-1',
        },
      });
    });
    expect(onDocumentAdded).toHaveBeenCalledWith(
      expect.objectContaining({ document_id: 'doc-1', type: 'uploaded' }),
    );

    // A partial batch keeps the uploader mounted for correction.
    act(() => {
      uploadState.props.onAllUploadsComplete({ total: 2, succeeded: 1, failed: 1 });
    });
    expect(screen.getByTestId('upload-stub')).toBeInTheDocument();
  });

  it('closes the uploader only after a fully successful batch', async () => {
    const { container } = render(
      <TaskDocumentsSimple taskId="task-1" onDocumentCreated={vi.fn().mockResolvedValue(undefined)} />,
    );

    await openUploader(container);

    act(() => {
      uploadState.props.onAllUploadsComplete({ total: 1, succeeded: 1, failed: 0 });
    });

    await waitFor(() => expect(screen.queryByTestId('upload-stub')).not.toBeInTheDocument());
  });

  it('rejects the per-file success callback when its refresh path fails', async () => {
    // The uploader awaits onUploadComplete and turns a rejection into reload
    // guidance, so the parent path must actually reject rather than swallow.
    const onDocumentCreated = vi.fn().mockRejectedValue(new Error('refresh boom'));
    const { container } = render(
      <TaskDocumentsSimple taskId="task-1" onDocumentCreated={onDocumentCreated} />,
    );

    await openUploader(container);

    await expect(
      uploadState.props.onUploadComplete({
        success: true,
        document: {
          document_id: 'doc-1',
          document_name: 'good.pdf',
          mime_type: 'application/pdf',
          file_id: 'file-1',
        },
      }),
    ).rejects.toThrow('refresh boom');
  });
});
