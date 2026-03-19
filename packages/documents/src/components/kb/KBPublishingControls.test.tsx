/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import KBPublishingControls from './KBPublishingControls';
import type { IKBArticleWithDocument, ArticleStatus } from '../../actions/kbArticleActions';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, any>) =>
      typeof fallback === 'string' ? fallback : (fallback?.defaultValue ?? _key),
  }),
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

vi.mock('../../actions/kbArticleActions', () => ({
  publishArticle: vi.fn().mockResolvedValue({}),
  archiveArticle: vi.fn().mockResolvedValue({}),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, variant, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className} data-testid="status-badge">{children}</span>
  ),
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, title, onConfirm, onClose }: any) =>
    isOpen ? (
      <div data-testid="confirmation-dialog">
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null,
}));

function buildArticle(status: ArticleStatus, audience: 'internal' | 'client' | 'public' = 'internal'): IKBArticleWithDocument {
  return {
    article_id: 'article-1',
    tenant: 'tenant-1',
    document_id: 'doc-1',
    slug: 'test-article',
    article_type: 'how_to',
    audience,
    status,
    view_count: 0,
    helpful_count: 0,
    not_helpful_count: 0,
    review_cycle_days: null,
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
}

describe('KBPublishingControls', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Draft status', () => {
    it('renders Publish and Archive buttons for draft article', () => {
      render(<KBPublishingControls article={buildArticle('draft')} />);

      expect(screen.getByText('Draft')).toBeInTheDocument();
      expect(screen.getByText('Publish')).toBeInTheDocument();
      expect(screen.getByText('Archive')).toBeInTheDocument();
    });

    it('renders Submit for Review button when onSubmitForReview is provided', () => {
      const onSubmitForReview = vi.fn();
      render(
        <KBPublishingControls
          article={buildArticle('draft')}
          onSubmitForReview={onSubmitForReview}
        />
      );

      const submitButton = screen.getByText('Submit for Review');
      expect(submitButton).toBeInTheDocument();

      fireEvent.click(submitButton);
      expect(onSubmitForReview).toHaveBeenCalled();
    });
  });

  describe('Review status', () => {
    it('renders Approve & Publish and Archive buttons for review article', () => {
      render(<KBPublishingControls article={buildArticle('review')} />);

      expect(screen.getByText('In Review')).toBeInTheDocument();
      expect(screen.getByText('Approve & Publish')).toBeInTheDocument();
      expect(screen.getByText('Archive')).toBeInTheDocument();
    });
  });

  describe('Published status', () => {
    it('renders Archive button for published article', () => {
      render(<KBPublishingControls article={buildArticle('published')} />);

      expect(screen.getByText('Published')).toBeInTheDocument();
      expect(screen.getByText('Archive')).toBeInTheDocument();
      expect(screen.queryByText('Publish')).not.toBeInTheDocument();
    });
  });

  describe('Archived status', () => {
    it('renders Republish button for archived article', () => {
      render(<KBPublishingControls article={buildArticle('archived')} />);

      expect(screen.getByText('Archived')).toBeInTheDocument();
      expect(screen.getByText('Republish')).toBeInTheDocument();
      expect(screen.queryByText('Archive')).not.toBeInTheDocument();
    });
  });

  describe('Status flow visualization', () => {
    it('renders status flow with current status highlighted', () => {
      render(<KBPublishingControls article={buildArticle('review')} />);

      // Check that the status flow is rendered
      expect(screen.getByText('Draft')).toBeInTheDocument();
      expect(screen.getByText('Review')).toBeInTheDocument();
      // Check for Published text (there may be multiple instances from badge and flow)
      const publishedTexts = screen.getAllByText('Published');
      expect(publishedTexts.length).toBeGreaterThan(0);
    });
  });

  describe('Confirmation dialogs', () => {
    it('shows publish confirmation dialog when Publish is clicked', () => {
      render(<KBPublishingControls article={buildArticle('draft')} />);

      fireEvent.click(screen.getByText('Publish'));

      expect(screen.getByTestId('confirmation-dialog')).toBeInTheDocument();
      expect(screen.getByText('Publish Article')).toBeInTheDocument();
    });

    it('shows archive confirmation dialog when Archive is clicked', () => {
      render(<KBPublishingControls article={buildArticle('draft')} />);

      fireEvent.click(screen.getByText('Archive'));

      expect(screen.getByTestId('confirmation-dialog')).toBeInTheDocument();
      expect(screen.getByText('Archive Article')).toBeInTheDocument();
    });
  });

  describe('Audience warning', () => {
    it('shows warning for client audience articles when not published', () => {
      render(<KBPublishingControls article={buildArticle('draft', 'client')} />);

      expect(
        screen.getByText(/Publishing will make this article visible to/)
      ).toBeInTheDocument();
    });

    it('does not show warning for internal audience articles', () => {
      render(<KBPublishingControls article={buildArticle('draft', 'internal')} />);

      expect(
        screen.queryByText(/Publishing will make this article visible to/)
      ).not.toBeInTheDocument();
    });
  });
});
