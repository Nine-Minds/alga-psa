/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getDocumentsByEntity: vi.fn(),
  renderDocuments: vi.fn((props: any) => <div data-testid="viewer">{props.documentToOpen.document_name}</div>),
}));

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'user-1' } } }) }));
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ctx,
}));

import { OpportunityCitationDocument } from '../src/components/detail/OpportunityCitationDocument';

describe('OpportunityCitationDocument', () => {
  beforeEach(() => {
    ctx.getDocument.mockReset();
    ctx.getDocumentsByEntity.mockReset();
    ctx.renderDocuments.mockClear();
  });

  it('opens the one cited document through getDocument, without reading the deal\'s document list', async () => {
    ctx.getDocument.mockResolvedValue({ document_id: 'doc-old', document_name: 'Old contract.pdf' });
    render(<OpportunityCitationDocument opportunityId="opp-1" documentId="doc-old" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('viewer')).toHaveTextContent('Old contract.pdf'));
    expect(ctx.getDocument).toHaveBeenCalledWith('doc-old');
    expect(ctx.getDocumentsByEntity).not.toHaveBeenCalled();
    expect(ctx.renderDocuments).toHaveBeenCalledWith(expect.objectContaining({ drawerOnly: true, entityId: 'opp-1', entityType: 'opportunity' }));
  });

  it.each([
    ['a permission error', { permissionError: 'Permission denied: Cannot read documents' }],
    ['a missing document', null],
  ])('closes without rendering on %s', async (_label, result) => {
    ctx.getDocument.mockResolvedValue(result);
    const onClose = vi.fn();
    render(<OpportunityCitationDocument opportunityId="opp-1" documentId="doc-1" onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument();
  });

  it('closes when the fetch fails', async () => {
    ctx.getDocument.mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    render(<OpportunityCitationDocument opportunityId="opp-1" documentId="doc-1" onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
