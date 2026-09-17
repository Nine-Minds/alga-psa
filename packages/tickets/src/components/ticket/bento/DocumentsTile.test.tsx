/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IDocument } from '@alga-psa/types';
import { DocumentsTile } from './DocumentsTile';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

// The manager dialog is closed in these tests; stub it so the grid rows can be
// asserted without mounting the documents cross-feature context.
vi.mock('./../TicketDocumentsSection', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    renderDocuments: ({ documentToOpen, onDocumentClosed }: any) => (
      <div role="dialog" aria-label={documentToOpen.document_name} data-document-id={documentToOpen.document_id}>
        <button onClick={onDocumentClosed}>Close viewer</button>
      </div>
    ),
  }),
}));

const documents = [
  {
    document_id: 'doc-file',
    file_id: 'file-1',
    document_name: 'notes.pdf',
    file_size: 2048,
  },
  {
    document_id: 'doc-block',
    file_id: null,
    document_name: 'Runbook',
    file_size: 0,
  },
] as unknown as IDocument[];

const noop = async () => {};

describe('DocumentsTile grid document cells', () => {
  it('serves file-backed documents and never requests file content for file-less ones', () => {
    render(
      <DocumentsTile id="docs" ticketId="t1" documents={documents} onDocumentCreated={noop} />,
    );

    expect(screen.getByText('notes.pdf').closest('a')).toHaveAttribute(
      'href',
      '/api/documents/view/file-1',
    );

    const internalDocument = screen.getByRole('button', { name: /Runbook/ });
    expect(internalDocument).not.toHaveAttribute('href');
    expect(internalDocument).not.toHaveAttribute('target');
    fireEvent.click(internalDocument);
    expect(screen.getByRole('dialog', { name: 'Runbook' })).toHaveAttribute('data-document-id', 'doc-block');
    fireEvent.click(screen.getByText('Close viewer'));
    expect(screen.queryByRole('dialog', { name: 'Runbook' })).not.toBeInTheDocument();
    fireEvent.click(internalDocument);
    expect(screen.getByRole('dialog', { name: 'Runbook' })).toBeInTheDocument();
  });

  it('honours a host resolver for file-backed documents only', () => {
    render(
      <DocumentsTile
        id="docs-portal"
        ticketId="t1"
        documents={documents}
        onDocumentCreated={noop}
        resolveDocumentViewUrl={({ file_id }) => `/portal/documents/${file_id}`}
      />,
    );

    expect(screen.getByText('notes.pdf').closest('a')).toHaveAttribute(
      'href',
      '/portal/documents/file-1',
    );
    expect(screen.getByText('notes.pdf').closest('a')).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('button', { name: /Runbook/ }));
    expect(screen.getByRole('dialog', { name: 'Runbook' })).toHaveAttribute('data-document-id', 'doc-block');
  });
});
