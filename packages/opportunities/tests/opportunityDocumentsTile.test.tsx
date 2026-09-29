/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDocument } from '@alga-psa/types';
import { OpportunityDocumentsTile } from '../src/components/detail/OpportunityDocumentsTile';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, options?: Record<string, unknown>) =>
      (fallback ?? _key).replace('{{count}}', String(options?.count ?? '')),
  }),
}));

const getDocumentsByEntity = vi.fn();

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    getDocumentsByEntity,
    renderDocuments: ({ documentToOpen, entityType, entityId }: any) =>
      documentToOpen ? (
        <div
          role="dialog"
          aria-label={documentToOpen.document_name}
          data-entity-type={entityType}
          data-entity-id={entityId}
        />
      ) : null,
  }),
}));

const documents = [
  { document_id: 'doc-rfp', file_id: 'file-1', document_name: 'rfp.pdf', mime_type: 'application/pdf', file_size: 2048 },
  { document_id: 'doc-notes', file_id: null, document_name: 'Scoping notes', file_size: 0 },
] as unknown as IDocument[];

describe('OpportunityDocumentsTile', () => {
  beforeEach(() => {
    getDocumentsByEntity.mockReset();
  });

  it('lists the documents filed against the opportunity', async () => {
    getDocumentsByEntity.mockResolvedValue({ documents, totalCount: 2, currentPage: 1, totalPages: 1 });

    render(<OpportunityDocumentsTile opportunityId="opp-1" />);

    expect(await screen.findByText('rfp.pdf')).toBeInTheDocument();
    // The association the tile reads is the opportunity's own, not the client's.
    expect(getDocumentsByEntity).toHaveBeenCalledWith('opp-1', 'opportunity');
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    // A block document has no file, so it carries no size chip.
    expect(screen.getByText('Scoping notes')).toBeInTheDocument();
  });

  it('opens a document in the viewer drawer scoped to the opportunity', async () => {
    getDocumentsByEntity.mockResolvedValue({ documents, totalCount: 2, currentPage: 1, totalPages: 1 });

    render(<OpportunityDocumentsTile opportunityId="opp-1" />);

    fireEvent.click(await screen.findByRole('button', { name: /Scoping notes/ }));
    const drawer = screen.getByRole('dialog', { name: 'Scoping notes' });
    expect(drawer).toHaveAttribute('data-entity-type', 'opportunity');
    expect(drawer).toHaveAttribute('data-entity-id', 'opp-1');
  });

  it('invites the first attachment when the deal has none', async () => {
    getDocumentsByEntity.mockResolvedValue({ documents: [], totalCount: 0, currentPage: 1, totalPages: 0 });

    render(<OpportunityDocumentsTile opportunityId="opp-1" />);

    expect(await screen.findByText(/No documents yet/)).toBeInTheDocument();
    expect(screen.getByText('Attach a document')).toBeInTheDocument();
  });

  it('shows the failure rather than an empty tile when the fetch throws', async () => {
    getDocumentsByEntity.mockRejectedValue(new Error('Documents service unavailable'));

    render(<OpportunityDocumentsTile opportunityId="opp-1" />);

    expect(await screen.findByText('Documents service unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/No documents yet/)).not.toBeInTheDocument();
  });
});
