/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { IDocument } from '@alga-psa/types';
import DocumentListView from './DocumentListView.tsx';

vi.mock('@alga-psa/core/formatters', () => ({
  formatBytes: (value: number) => `${value} B`,
  formatDate: (value: string | Date) => String(value),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, any> | string) =>
      typeof options === 'string' ? options : (options?.defaultValue ?? _key),
  }),
}));

function buildDocument(overrides: Partial<IDocument> = {}): IDocument {
  return {
    tenant: 'tenant-1',
    document_id: 'doc-1',
    document_name: 'Network Diagram',
    type_id: null,
    user_id: 'user-1',
    order_number: 1,
    created_by: 'user-1',
    folder_path: '/Contracts',
    is_client_visible: false,
    ...overrides,
  };
}

describe('DocumentListView visibility controls', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders visibility badge and toggle in MSP context', () => {
    const onToggleVisibility = vi.fn();
    const document = buildDocument({ is_client_visible: true });

    render(
      <DocumentListView
        documents={[document]}
        selectedDocuments={new Set()}
        onSelectionChange={() => undefined}
        showVisibilityControls
        onToggleVisibility={onToggleVisibility}
      />
    );

    expect(screen.getByText('Client visible')).toBeInTheDocument();

    const toggleButton = screen.getByRole('button', { name: 'Visible to clients' });
    fireEvent.click(toggleButton);

    expect(onToggleVisibility).toHaveBeenCalledWith(document, false);
  });

  it('hides visibility badge and toggle when not in MSP context', () => {
    render(
      <DocumentListView
        documents={[buildDocument()]}
        selectedDocuments={new Set()}
        onSelectionChange={() => undefined}
      />
    );

    expect(screen.queryByText('Visibility')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hidden from clients' })).not.toBeInTheDocument();
  });

  it('disables toggle while document visibility is updating', () => {
    render(
      <DocumentListView
        documents={[buildDocument()]}
        selectedDocuments={new Set()}
        onSelectionChange={() => undefined}
        showVisibilityControls
        onToggleVisibility={() => undefined}
        visibilityUpdatingIds={new Set(['doc-1'])}
      />
    );

    const toggleButton = screen.getByRole('button', { name: 'Hidden from clients' });
    expect(toggleButton).toBeDisabled();
  });
});
