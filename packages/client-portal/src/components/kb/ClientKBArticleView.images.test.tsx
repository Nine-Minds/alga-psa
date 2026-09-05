/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import ClientKBArticleView from './ClientKBArticleView';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock('@alga-psa/ui/hooks/useKnowledgeBaseEnumOptions', () => ({
  useFormatArticleType: () => (value: string) => value,
}));

const { getClientKBArticle } = vi.hoisted(() => ({ getClientKBArticle: vi.fn() }));

vi.mock('../../actions/client-portal-actions/client-kb', () => ({
  getClientKBArticle: (...args: unknown[]) => getClientKBArticle(...args),
  recordClientKBFeedback: vi.fn(),
}));

const article = (blockData: unknown) => ({
  article_id: 'article-1',
  document_name: 'Printer Troubleshooting',
  article_type: 'how_to',
  status: 'published',
  view_count: 1,
  helpful_count: 0,
  not_helpful_count: 0,
  block_data: blockData,
});

describe('ClientKBArticleView images', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders BlockNote image blocks with their caption', async () => {
    getClientKBArticle.mockResolvedValue(
      article([
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        {
          type: 'image',
          props: { url: '/api/documents/view/file-1', caption: 'Spooler dialog', previewWidth: 480 },
        },
      ])
    );

    render(<ClientKBArticleView articleIdOrSlug="article-1" />);

    const image = await waitFor(() => screen.getByAltText('Spooler dialog'));
    expect(image.getAttribute('src')).toBe('/api/documents/view/file-1');
    expect(image.getAttribute('width')).toBe('480');
    expect(screen.getByText('Spooler dialog')).toBeTruthy();
  });

  it('renders ProseMirror image nodes inside a doc wrapper', async () => {
    getClientKBArticle.mockResolvedValue(
      article(
        JSON.stringify({
          type: 'doc',
          content: [
            { type: 'image', attrs: { src: '/api/documents/view/file-2', alt: 'Queue window' } },
          ],
        })
      )
    );

    render(<ClientKBArticleView articleIdOrSlug="article-1" />);

    const image = await waitFor(() => screen.getByAltText('Queue window'));
    expect(image.getAttribute('src')).toBe('/api/documents/view/file-2');
  });

  it('skips an image node with no source', async () => {
    getClientKBArticle.mockResolvedValue(
      article([{ type: 'image', props: { caption: 'broken' } }])
    );

    render(<ClientKBArticleView articleIdOrSlug="article-1" />);

    await waitFor(() => expect(getClientKBArticle).toHaveBeenCalled());
    expect(document.querySelector('img')).toBeNull();
  });
});
