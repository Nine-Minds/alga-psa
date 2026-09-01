/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IKBArticleWithDocument } from '@alga-psa/types';

const deleteArticleMock = vi.fn();
const archiveArticleMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock('../../actions/kbArticleActions', () => ({
  deleteArticle: (...args: unknown[]) => deleteArticleMock(...args),
  archiveArticle: (...args: unknown[]) => archiveArticleMock(...args),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock('@alga-psa/ui/hooks/useKnowledgeBaseEnumOptions', () => ({
  useFormatArticleAudience: () => (value: string) => value,
  useFormatArticleStatus: () => (value: string) => value,
  useFormatArticleType: () => (value: string) => value,
}));

vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => null,
}));

import KBArticleList from './KBArticleList';

function buildArticle(overrides: Partial<IKBArticleWithDocument> = {}): IKBArticleWithDocument {
  return {
    article_id: 'article-1',
    tenant: 'tenant-1',
    document_id: 'doc-1',
    slug: 'article-1',
    article_type: 'how_to',
    audience: 'internal',
    status: 'draft',
    next_review_due: null,
    review_cycle_days: null,
    last_reviewed_at: null,
    last_reviewed_by: null,
    view_count: 0,
    helpful_count: 0,
    not_helpful_count: 0,
    category_id: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    created_by: null,
    updated_by: null,
    published_at: null,
    published_by: null,
    document_name: 'Article 1',
    ...overrides,
  };
}

function renderList(articles: IKBArticleWithDocument[]) {
  const onRefresh = vi.fn();
  render(
    <KBArticleList
      articles={articles}
      total={articles.length}
      totalPages={1}
      articleTags={{}}
      currentPage={1}
      pageSize={10}
      isLoading={false}
      onPageChange={vi.fn()}
      onPageSizeChange={vi.fn()}
      onRefresh={onRefresh}
    />
  );
  return onRefresh;
}

function selectRow(articleId: string) {
  (document.getElementById(`kb-checkbox-${articleId}`) as HTMLInputElement).click();
}

function clickBulkDelete() {
  screen.getByRole('button', { name: 'Delete' }).click();
}

async function confirmDelete() {
  (await screen.findByRole('button', { name: 'Delete permanently' })).click();
}

// The confirm button repeats the bar's label, so wait for the one inside the dialog.
async function confirmInDialog(name: string) {
  const confirmButton = await waitFor(() => {
    const match = screen
      .getAllByRole('button', { name })
      .find((button) => button.closest('[role="dialog"]'));
    if (!match) throw new Error(`no "${name}" button inside a dialog yet`);
    return match;
  });
  confirmButton.click();
}

function deletedIds() {
  return deleteArticleMock.mock.calls.map(([articleId]) => articleId);
}

describe('KBArticleList bulk delete', () => {
  beforeEach(() => {
    deleteArticleMock.mockReset();
    archiveArticleMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('never asks the server to delete a published article caught in the selection', async () => {
    // The server throws for anything that is not a draft or archived article,
    // which used to abort the loop after earlier drafts were already gone.
    deleteArticleMock.mockImplementation(async (articleId: string) => {
      if (articleId === 'published-1') {
        throw new Error('Only draft or archived articles can be deleted. Archive the article first.');
      }
      return { success: true };
    });

    const onRefresh = renderList([
      buildArticle({ article_id: 'draft-a', document_name: 'Draft A' }),
      buildArticle({ article_id: 'published-1', document_name: 'Published', status: 'published' }),
      buildArticle({ article_id: 'draft-b', document_name: 'Draft B' }),
    ]);

    selectRow('draft-a');
    selectRow('published-1');
    selectRow('draft-b');
    clickBulkDelete();

    // The dialog counts only the deletable articles and admits the rest are skipped.
    expect(await screen.findByText('Delete 2 article(s)')).toBeInTheDocument();
    // The message also renders in the dialog's screen-reader description.
    expect(
      screen.getAllByText(/1 selected article\(s\) are published or in review and will be skipped/).length
    ).toBeGreaterThan(0);

    await confirmDelete();
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());

    expect(deletedIds()).toEqual(['draft-a', 'draft-b']);
    expect(toastSuccessMock).toHaveBeenCalledWith('2 article(s) deleted permanently');
    expect(toastErrorMock).not.toHaveBeenCalled();
    // The skipped article stays selected so it can be archived first.
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('refuses the batch when nothing in the selection can be deleted', () => {
    renderList([
      buildArticle({ article_id: 'published-1', status: 'published' }),
      buildArticle({ article_id: 'review-1', status: 'review' }),
    ]);

    selectRow('published-1');
    selectRow('review-1');
    clickBulkDelete();

    expect(deleteArticleMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Published or in-review articles must be archived before they can be deleted'
    );
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument();
  });

  it('keeps deleting after a rejection and reports the partial outcome', async () => {
    // A server-side rejection (stale status, permissions, a race) must neither
    // stop the batch nor let the report pretend nothing was destroyed.
    deleteArticleMock.mockImplementation(async (articleId: string) => {
      if (articleId === 'draft-b') throw new Error('Article not found');
      return { success: true };
    });

    const onRefresh = renderList([
      buildArticle({ article_id: 'draft-a' }),
      buildArticle({ article_id: 'draft-b' }),
      buildArticle({ article_id: 'draft-c' }),
    ]);

    selectRow('draft-a');
    selectRow('draft-b');
    selectRow('draft-c');
    clickBulkDelete();
    await confirmDelete();

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());

    expect(deletedIds()).toEqual(['draft-a', 'draft-b', 'draft-c']);
    expect(toastErrorMock).toHaveBeenCalledWith('Deleted 2 article(s); 1 could not be deleted');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    // Only the article that failed is still selected.
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('reports a permission error from the action without claiming success', async () => {
    deleteArticleMock.mockImplementation(async (articleId: string) =>
      articleId === 'draft-b' ? { code: 'PERMISSION_DENIED', message: 'nope' } : { success: true }
    );

    const onRefresh = renderList([
      buildArticle({ article_id: 'draft-a' }),
      buildArticle({ article_id: 'draft-b' }),
    ]);

    selectRow('draft-a');
    selectRow('draft-b');
    clickBulkDelete();
    await confirmDelete();

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());

    expect(toastErrorMock).toHaveBeenCalledWith('Deleted 1 article(s); 1 could not be deleted');
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('keeps archiving after a rejection and refreshes the stale list', async () => {
    archiveArticleMock.mockImplementation(async (articleId: string) => {
      if (articleId === 'draft-a') throw new Error('Article not found');
      return { article_id: articleId, status: 'archived' };
    });

    const onRefresh = renderList([
      buildArticle({ article_id: 'draft-a' }),
      buildArticle({ article_id: 'draft-b' }),
    ]);

    selectRow('draft-a');
    selectRow('draft-b');
    screen.getByRole('button', { name: 'Archive' }).click();
    await confirmInDialog('Archive');

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());

    expect(archiveArticleMock.mock.calls.map(([articleId]) => articleId)).toEqual(['draft-a', 'draft-b']);
    expect(toastErrorMock).toHaveBeenCalledWith('Archived 1 article(s); 1 could not be archived');
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});
