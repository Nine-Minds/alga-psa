/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'react-hot-toast';
import KBArticleEditor from './KBArticleEditor';
import type { IKBArticleWithDocument } from '../../actions/kbArticleActions';

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Stable singletons: fresh refs per hook call re-fire effects keyed on them.
  const translation = {
    t: (_key: string, fallback?: string | { defaultValue?: string }) =>
      (typeof fallback === 'string' ? fallback : fallback?.defaultValue) ?? _key,
  };
  const formatters = {
    formatDate: (value: string | Date) => String(value),
    formatNumber: (value: number) => String(value),
  };
  return {
    useTranslation: () => translation,
    useFormatters: () => formatters,
  };
});

vi.mock('@alga-psa/core/formatters', () => ({
  formatDate: (value: string | Date) => String(value),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

vi.mock('@alga-psa/ui/lib/errorHandling', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/ui/lib/errorHandling')>()),
  handleError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// vi.hoisted: the kbArticleActions mock factory below runs while this
// module's imports evaluate — a plain const would still be in its TDZ then.
const mockArticle: IKBArticleWithDocument = vi.hoisted(() => ({
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
}));

vi.mock('../../actions/kbArticleActions', () => ({
  getArticle: vi.fn().mockResolvedValue(mockArticle),
  updateArticle: vi.fn().mockResolvedValue(mockArticle),
  publishArticle: vi.fn().mockResolvedValue(mockArticle),
  deleteArticle: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@alga-psa/tags', () => ({
  TagManager: () => <div data-testid="tag-manager">Tags</div>,
  findTagsByEntityId: vi.fn().mockResolvedValue([]),
  isTagActionError: () => false,
}));

const editorMocks = vi.hoisted(() => ({
  mounts: 0,
  fallbackJson: { type: 'doc', content: [{ type: 'paragraph' }] } as Record<string, unknown>,
  collabJson: { type: 'doc', content: [] } as Record<string, unknown>,
}));

vi.mock('../DocumentEditor', async () => {
  const React = await import('react');
  return {
    DocumentEditor: ({ editorRef, hideSaveButton }: any) => {
      React.useEffect(() => {
        editorMocks.mounts += 1;
        if (editorRef) editorRef.current = { isDestroyed: false, getJSON: () => editorMocks.fallbackJson };
        return () => {
          if (editorRef) editorRef.current = null;
        };
      }, [editorRef]);
      return (
        <div data-testid="document-editor">
          Document Editor
          {!hideSaveButton && <button id="save-document-button">Save Document</button>}
        </div>
      );
    },
  };
});

vi.mock('../CollaborativeEditor', async () => {
  const React = await import('react');
  return {
    CollaborativeEditor: ({ editorRef, onConnectionStatusChange }: any) => {
      React.useEffect(() => {
        editorMocks.mounts += 1;
        if (editorRef) editorRef.current = { getJSON: () => editorMocks.collabJson };
        onConnectionStatusChange?.('connected');
      }, []);
      return <div data-testid="collab-editor">Collab Editor</div>;
    },
  };
});

vi.mock('../../actions/collaborativeEditingActions', () => ({
  syncCollabSnapshot: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../actions/documentBlockContentActions', () => ({
  updateBlockContent: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  searchUsersForMentions: vi.fn(),
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

    // 'Tags' appears both as the card heading and inside the TagManager stub.
    expect(screen.getAllByText('Tags').length).toBeGreaterThanOrEqual(1);
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

  // A refused write comes back as a value, not a throw. A co-managed seat technician may read a client
  // article but not change it: the editor must say so instead of announcing a status change that did not happen.
  it('reports a refused status change as an error, not a success', async () => {
    const { updateArticle } = await import('../../actions/kbArticleActions');
    vi.mocked(updateArticle).mockResolvedValueOnce({ permissionError: 'Permission denied' } as any);
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();

    render(<KBArticleEditor articleId="article-1" userId="user-1" />);
    const submit = await screen.findByText('Submit for Review');
    fireEvent.click(submit);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to change article status');
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  describe('combined Save', () => {
    const collabProps = { articleId: 'article-1', userId: 'user-1', userName: 'User', tenantId: 'tenant-1' };
    const fallbackProps = { articleId: 'article-1', userId: 'user-1' };

    beforeEach(async () => {
      const actions = await import('../../actions/kbArticleActions');
      const collab = await import('../../actions/collaborativeEditingActions');
      const blocks = await import('../../actions/documentBlockContentActions');
      vi.mocked(actions.getArticle).mockClear();
      vi.mocked(actions.updateArticle).mockClear();
      vi.mocked(actions.publishArticle).mockClear();
      vi.mocked(collab.syncCollabSnapshot).mockReset().mockResolvedValue({ success: true } as any);
      vi.mocked(blocks.updateBlockContent).mockReset().mockResolvedValue({ success: true } as any);
      vi.mocked(actions.updateArticle).mockResolvedValue(mockArticle as any);
      vi.mocked(toast.success).mockClear();
      vi.mocked(toast.error).mockClear();
      editorMocks.mounts = 0;
    });

    it('collab: flushes content then metadata, without remounting the editor or reloading', async () => {
      const { getArticle, updateArticle } = await import('../../actions/kbArticleActions');
      const { syncCollabSnapshot } = await import('../../actions/collaborativeEditingActions');
      const order: string[] = [];
      vi.mocked(syncCollabSnapshot).mockImplementation(async () => {
        order.push('sync');
        return { success: true } as any;
      });
      vi.mocked(updateArticle).mockImplementation(async () => {
        order.push('update');
        return { ...mockArticle, slug: 'new-slug' } as any;
      });

      render(<KBArticleEditor {...collabProps} />);
      const editorEl = await screen.findByTestId('collab-editor');
      // Change metadata while content is (notionally) unsaved.
      fireEvent.change(screen.getByDisplayValue('test-article'), { target: { value: 'new-slug' } });
      vi.mocked(getArticle).mockClear();

      fireEvent.click(document.getElementById('kb-editor-save')!);
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Article saved'));

      expect(order).toEqual(['sync', 'update']);
      expect(vi.mocked(updateArticle)).toHaveBeenCalledWith('article-1', { slug: 'new-slug' });
      expect(getArticle).not.toHaveBeenCalled();
      expect(screen.getByTestId('collab-editor')).toBe(editorEl);
      expect(editorMocks.mounts).toBe(1);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('aborts without updating metadata when the content flush fails (rejects)', async () => {
      const { updateArticle } = await import('../../actions/kbArticleActions');
      const { syncCollabSnapshot } = await import('../../actions/collaborativeEditingActions');
      vi.mocked(syncCollabSnapshot).mockRejectedValue(new Error('boom'));

      render(<KBArticleEditor {...collabProps} />);
      await screen.findByTestId('collab-editor');
      fireEvent.click(document.getElementById('kb-editor-save')!);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Failed to save article content')
      );
      expect(updateArticle).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('aborts without updating metadata when sync reports failure and no editor JSON can be written', async () => {
      const { updateArticle } = await import('../../actions/kbArticleActions');
      const { syncCollabSnapshot } = await import('../../actions/collaborativeEditingActions');
      const { updateBlockContent } = await import('../../actions/documentBlockContentActions');
      vi.mocked(syncCollabSnapshot).mockResolvedValue({ success: false, message: 'nope' } as any);
      vi.mocked(updateBlockContent).mockResolvedValue({ actionError: 'denied' } as any);

      render(<KBArticleEditor {...collabProps} />);
      await screen.findByTestId('collab-editor');
      fireEvent.click(document.getElementById('kb-editor-save-bottom')!);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Failed to save article content')
      );
      expect(updateArticle).not.toHaveBeenCalled();
    });

    it('fallback: persists getJSON via updateBlockContent, then updates metadata; no save-document-button', async () => {
      const { updateArticle } = await import('../../actions/kbArticleActions');
      const { updateBlockContent } = await import('../../actions/documentBlockContentActions');
      const { syncCollabSnapshot } = await import('../../actions/collaborativeEditingActions');

      render(<KBArticleEditor {...fallbackProps} />);
      const editorEl = await screen.findByTestId('document-editor');
      expect(document.getElementById('save-document-button')).toBeNull();

      fireEvent.change(screen.getByDisplayValue('Test Article'), { target: { value: 'Renamed' } });
      fireEvent.click(document.getElementById('kb-editor-save')!);

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Article saved'));
      expect(updateBlockContent).toHaveBeenCalledWith('doc-1', {
        block_data: JSON.stringify(editorMocks.fallbackJson),
        user_id: 'user-1',
      });
      expect(syncCollabSnapshot).not.toHaveBeenCalled();
      expect(updateArticle).toHaveBeenCalledWith('article-1', { title: 'Renamed' });
      expect(vi.mocked(updateBlockContent).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(updateArticle).mock.invocationCallOrder[0]
      );
      expect(screen.getByTestId('document-editor')).toBe(editorEl);
      expect(editorMocks.mounts).toBe(1);
    });

    it('fallback: a failed content write aborts before updateArticle', async () => {
      const { updateArticle } = await import('../../actions/kbArticleActions');
      const { updateBlockContent } = await import('../../actions/documentBlockContentActions');
      vi.mocked(updateBlockContent).mockResolvedValue({ actionError: 'bad' } as any);

      render(<KBArticleEditor {...fallbackProps} />);
      await screen.findByTestId('document-editor');
      fireEvent.click(document.getElementById('kb-editor-save-bottom')!);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Failed to save article content')
      );
      expect(updateArticle).not.toHaveBeenCalled();
    });

    it.each([
      ['collab', collabProps, 'collab-editor'],
      ['fallback', fallbackProps, 'document-editor'],
    ])('%s: both Save buttons exist and each triggers the combined save', async (_mode, props, testId) => {
      const { updateArticle } = await import('../../actions/kbArticleActions');

      render(<KBArticleEditor {...(props as any)} />);
      await screen.findByTestId(testId);
      expect(document.getElementById('kb-editor-save-content')).toBeNull();

      for (const id of ['kb-editor-save', 'kb-editor-save-bottom']) {
        vi.mocked(updateArticle).mockClear();
        const button = document.getElementById(id);
        expect(button).not.toBeNull();
        fireEvent.click(button!);
        await waitFor(() => expect(updateArticle).toHaveBeenCalledTimes(1));
        await waitFor(() => expect((document.getElementById(id) as HTMLButtonElement).disabled).toBe(false));
      }
    });

    it('publish keeps the editor mounted, never shows the spinner, and does not re-seed unsaved metadata', async () => {
      const { getArticle, publishArticle } = await import('../../actions/kbArticleActions');
      vi.mocked(publishArticle).mockResolvedValue({ ...mockArticle, status: 'published' } as any);

      render(<KBArticleEditor {...fallbackProps} />);
      const editorEl = await screen.findByTestId('document-editor');
      fireEvent.change(screen.getByDisplayValue('Test Article'), { target: { value: 'Unsaved title' } });
      vi.mocked(getArticle).mockClear();
      vi.mocked(getArticle).mockResolvedValue({ ...mockArticle, status: 'published' } as any);

      fireEvent.click(screen.getByText('Publish'));
      await waitFor(() => expect(getArticle).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByText('Published', { selector: 'span' })).toBeInTheDocument());

      expect(screen.getByTestId('document-editor')).toBe(editorEl);
      expect(editorMocks.mounts).toBe(1);
      expect(screen.getByDisplayValue('Unsaved title')).toBeInTheDocument();
      vi.mocked(getArticle).mockResolvedValue(mockArticle as any);
    });
  });
});
