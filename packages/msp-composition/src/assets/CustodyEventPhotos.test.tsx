// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustodyEventPhotos } from './CustodyEventPhotos';

const mock = vi.hoisted(() => ({ getDocument: vi.fn(), thumbnail: vi.fn() }));
vi.mock('@alga-psa/documents/actions/documentActions', () => ({ getDocument: mock.getDocument, getDocumentThumbnailUrl: mock.thumbnail }));
vi.mock('@alga-psa/documents/components/Documents', () => ({ default: ({ documentToOpen }: any) => <div>Viewer: {documentToOpen.document_name}</div> }));

beforeEach(() => { mock.getDocument.mockReset(); mock.thumbnail.mockReset(); });

describe('custody event photos', () => {
  it('opens the authorized photo in the document viewer', async () => {
    mock.getDocument.mockResolvedValue({ document_id: 'one', document_name: 'dock.jpg' });
    mock.thumbnail.mockResolvedValue('/photo');
    render(<CustodyEventPhotos documentIds={['one']} />);
    const photo = await screen.findByAltText('');
    fireEvent.load(photo);
    fireEvent.click(await screen.findByRole('button', { name: 'dock.jpg' }));
    expect(screen.getByText('Viewer: dock.jpg')).toBeTruthy();
  });

  it('reveals nothing for refused document reads or failed thumbnails', async () => {
    mock.getDocument.mockResolvedValue({ permissionError: 'denied' });
    mock.thumbnail.mockResolvedValue(null);
    const { container } = render(<CustodyEventPhotos documentIds={['secret']} />);
    await waitFor(() => expect(mock.thumbnail).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    expect(container.querySelector('button')).toBeNull();
  });

  it('removes a tile if the thumbnail endpoint refuses the image', async () => {
    mock.getDocument.mockResolvedValue({ document_id: 'one', document_name: 'private.jpg' });
    mock.thumbnail.mockResolvedValue('/photo');
    const { container } = render(<CustodyEventPhotos documentIds={['one']} />);
    const photo = await screen.findByAltText('');
    fireEvent.error(photo);
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe('');
  });
});
