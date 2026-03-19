/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import KBArticleEditor from './KBArticleEditor';
import type { IKBArticleWithDocument } from '../../actions/kbArticleActions';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@alga-psa/core/formatters', () => ({
  formatDate: (value: string | Date) => String(value),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockArticle: IKBArticleWithDocument = {
  article_id: 'article-1',
  tenant: 'tenant-1',
  document_id: 'doc-1',
  slug: 'test-article',
  article_type: 'how_to',
  audience: 'internal',
  status: 'draft',
  view_count: 10,
  helpful_count: 5,
  not_helpful_count: 2,
  review_cycle_days: 90,
  next_review_due: null,
  last_reviewed_at: null,
  last_reviewed_by: null,
  category_id: null,
  created_at: '2026-02-28T00:00:00Z',
  updated_at: '2026-02-28T00:00:00Z',
  created_by: 'user-1',
  updated_by: 'user-1',
  published_at: null,
  published_by: null,
  document_name: 'Test Article',
};

vi.mock('../../actions/kbArticleActions', () => ({
  getArticle: vi.fn().mockResolvedValue(mockArticle),
  updateArticle: vi.fn().mockResolvedValue(mockArticle),
}));

vi.mock('@alga-psa/tags', () => ({
  TagManager: () => <div data-testid="tag-manager">Tags</div>,
  findTagsByEntityId: vi.fn().mockResolvedValue([]),
}));

vi.mock('../DocumentEditor', () => ({
  DocumentEditor: () => <div data-testid="document-editor">Document Editor</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h3 className={className}>{children}</h3>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ value, options }: { value: string; options: { value: string; label: string }[] }) => {
    const selected = options.find((o: { value: string }) => o.value === value);
    return <div data-testid="custom-select">{selected?.label ?? value}</div>;
  },
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}));

describe('KBArticleEditor', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders KB metadata sidebar with article type, audience, and review cycle', async () => {
    render(
      <KBArticleEditor
        articleId="article-1"
        userId="user-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('document-editor')).toBeInTheDocument();
    });

    // Check metadata sidebar elements
    expect(screen.getByText('Metadata')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('URL Slug')).toBeInTheDocument();
    expect(screen.getByText('Article Type')).toBeInTheDocument();
    expect(screen.getByText('Audience')).toBeInTheDocument();
    expect(screen.getByText('Review Cycle')).toBeInTheDocument();
  });

  it('renders statistics card with view and feedback counts', async () => {
    render(
      <KBArticleEditor
        articleId="article-1"
        userId="user-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Statistics')).toBeInTheDocument();
    });

    expect(screen.getByText('Views')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Helpful')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Not helpful')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders tag manager for article tagging', async () => {
    render(
      <KBArticleEditor
        articleId="article-1"
        userId="user-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('tag-manager')).toBeInTheDocument();
    });

    expect(screen.getByText('Tags')).toBeInTheDocument();
  });

  it('wraps DocumentEditor component for content editing', async () => {
    render(
      <KBArticleEditor
        articleId="article-1"
        userId="user-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('document-editor')).toBeInTheDocument();
    });
  });

  it('renders article status badge', async () => {
    render(
      <KBArticleEditor
        articleId="article-1"
        userId="user-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeInTheDocument();
    });
  });

  it('shows back button when onBack prop is provided', async () => {
    const onBack = vi.fn();

    render(
      <KBArticleEditor
        articleId="article-1"
        userId="user-1"
        onBack={onBack}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '' })).toBeInTheDocument();
    });
  });
});
