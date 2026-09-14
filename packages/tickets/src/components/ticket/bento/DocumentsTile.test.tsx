/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IDocument } from '@alga-psa/types';
import { DocumentsTile } from './DocumentsTile';

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

    const fileLessHref = screen.getByText('Runbook').closest('a')?.getAttribute('href');
    expect(fileLessHref).toBe('/msp/documents?doc=doc-block');
    expect(fileLessHref).not.toContain('/api/documents/download/');
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
    expect(screen.getByText('Runbook').closest('a')).toHaveAttribute(
      'href',
      '/msp/documents?doc=doc-block',
    );
  });
});
