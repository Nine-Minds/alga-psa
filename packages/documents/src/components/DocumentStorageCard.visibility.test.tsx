/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { IDocument } from '@alga-psa/types';
import DocumentStorageCard from './DocumentStorageCard.tsx';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, any> | string) =>
      typeof options === 'string' ? options : (options?.defaultValue ?? _key),
  }),
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui', () => ({
  DeleteEntityDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/Spinner', () => ({
  default: () => <div>Loading...</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({
  preCheckDeletion: vi.fn(),
}));

vi.mock('@alga-psa/documents/lib/documentUtils', () => ({
  getDocumentDownloadUrl: vi.fn(() => '/download'),
  downloadDocument: vi.fn(),
}));

vi.mock('../actions/documentActions', () => ({
  getDocumentPreview: vi.fn(),
}));

function buildDocument(overrides: Partial<IDocument> = {}): IDocument {
  return {
    tenant: 'tenant-1',
    document_id: 'doc-1',
    document_name: 'Contract.pdf',
    type_id: null,
    user_id: 'user-1',
    order_number: 1,
    created_by: 'user-1',
    is_client_visible: false,
    ...overrides,
  };
}

describe('DocumentStorageCard visibility controls', () => {
  afterEach(() => {
    cleanup();
  });

  beforeAll(() => {
    if (!window.IntersectionObserver) {
      class MockIntersectionObserver {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }

      window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
    }
  });

  it('renders visibility badge and toggle in MSP context', () => {
    const onToggleVisibility = vi.fn();
    const document = buildDocument({ is_client_visible: true });

    render(
      <DocumentStorageCard
        id="document-storage-card"
        document={document}
        hideActions
        showVisibilityControls
        onToggleVisibility={onToggleVisibility}
      />
    );

    expect(screen.getByText('Client visible')).toBeInTheDocument();

    const toggleButton = screen.getByRole('button', { name: 'Visible to clients' });
    fireEvent.click(toggleButton);

    expect(onToggleVisibility).toHaveBeenCalledWith(document, false);
  });

  it('hides visibility controls when not in MSP context', () => {
    render(
      <DocumentStorageCard
        id="document-storage-card"
        document={buildDocument()}
        hideActions
      />
    );

    expect(screen.queryByRole('button', { name: 'Visible to clients' })).not.toBeInTheDocument();
    expect(screen.queryByText('Client visible')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hidden from clients' })).not.toBeInTheDocument();
  });

  it('disables visibility toggle while update is pending', () => {
    render(
      <DocumentStorageCard
        id="document-storage-card"
        document={buildDocument({ is_client_visible: false })}
        hideActions
        showVisibilityControls
        onToggleVisibility={() => undefined}
        isVisibilityUpdating
      />
    );

    const toggleButton = screen.getByRole('button', { name: 'Hidden from clients' });
    expect(toggleButton).toBeDisabled();
  });
});
