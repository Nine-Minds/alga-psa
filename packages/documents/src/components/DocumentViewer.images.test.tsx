/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { DocumentViewer } from './DocumentViewer';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '' }),
}));

describe('DocumentViewer images', () => {
  // A schema without an image node makes ProseMirror reject the *whole*
  // document, and Tiptap then falls back to an empty one — so a dropped
  // picture would take every paragraph of the article with it.
  it('renders a ProseMirror image without blanking the document', async () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before the screenshot' }] },
        {
          type: 'image',
          attrs: { src: '/api/documents/view/file-1', alt: 'Spooler dialog', width: 480 },
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'After the screenshot' }] },
      ],
    };

    const { container } = render(<DocumentViewer content={doc} />);

    await waitFor(() => {
      expect(container.querySelector('img')).not.toBeNull();
    });

    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/documents/view/file-1');
    expect(img?.getAttribute('alt')).toBe('Spooler dialog');
    expect(img?.getAttribute('width')).toBe('480');
    expect(container.textContent).toContain('Before the screenshot');
    expect(container.textContent).toContain('After the screenshot');
  });

  it('renders a BlockNote image block without blanking the document', async () => {
    const blocknote = [
      {
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: 'Legacy article body', styles: {} }],
      },
      {
        type: 'image',
        props: { url: '/api/documents/view/file-2', caption: 'Console screenshot', previewWidth: 320 },
      },
    ];

    const { container } = render(<DocumentViewer content={blocknote} />);

    await waitFor(() => {
      expect(container.querySelector('img')).not.toBeNull();
    });

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/documents/view/file-2');
    expect(container.textContent).toContain('Legacy article body');
  });
});
