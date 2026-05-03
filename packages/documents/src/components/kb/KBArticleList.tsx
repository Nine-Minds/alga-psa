'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import Pagination from '@alga-psa/ui/components/Pagination';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  useFormatArticleAudience,
  useFormatArticleStatus,
  useFormatArticleType,
} from '@alga-psa/ui/hooks/useKnowledgeBaseEnumOptions';
import {
  Plus,
  MoreVertical,
  Pencil,
  Send,
  CheckCircle,
  Archive,
  BookOpen,
  Eye,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import {
  archiveArticle,
  deleteArticle,
  IKBArticleWithDocument,
  ArticleStatus,
  ArticleAudience,
  ArticleType,
} from '../../actions/kbArticleActions';
import { TagManager } from '@alga-psa/tags/components';
import type { ITag } from '@alga-psa/types';

const STATUS_COLORS: Record<ArticleStatus, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  review: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  published: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  archived: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const AUDIENCE_COLORS: Record<ArticleAudience, string> = {
  internal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  client: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  public: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
};

interface KBArticleListProps {
  articles: IKBArticleWithDocument[];
  total: number;
  totalPages: number;
  articleTags: Record<string, ITag[]>;
  currentPage: number;
  pageSize: number;
  isLoading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
  onEdit?: (article: IKBArticleWithDocument) => void;
  onCreateNew?: () => void;
  onSubmitForReview?: (article: IKBArticleWithDocument) => void;
  onPublish?: (article: IKBArticleWithDocument) => void;
}

export default function KBArticleList({
  articles,
  total,
  totalPages,
  articleTags: initialArticleTags,
  currentPage,
  pageSize,
  isLoading,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  onEdit,
  onCreateNew,
  onSubmitForReview,
  onPublish,
}: KBArticleListProps) {
  const { t } = useTranslation('msp/knowledge-base');
  const { formatDate } = useFormatters();

  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());

  // Local tags ref for optimistic updates from TagManager
  const articleTagsRef = useRef<Record<string, ITag[]>>(initialArticleTags);
  const [tagsVersion, setTagsVersion] = useState(0);

  // Sync ref when parent data changes
  React.useEffect(() => {
    articleTagsRef.current = initialArticleTags;
    setTagsVersion((v) => v + 1);
  }, [initialArticleTags]);

  // Archive confirmation dialog state
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [articleToArchive, setArticleToArchive] = useState<IKBArticleWithDocument | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [articleToDelete, setArticleToDelete] = useState<IKBArticleWithDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const getStatusLabel = useFormatArticleStatus();
  const getAudienceLabel = useFormatArticleAudience();
  const getTypeLabel = useFormatArticleType();

  const handleTagsChange = useCallback((articleId: string, tags: ITag[]) => {
    articleTagsRef.current[articleId] = tags;
    setTagsVersion((v) => v + 1);
  }, []);

  const handleArchive = async () => {
    if (!articleToArchive) return;

    setIsArchiving(true);
    try {
      const result = await archiveArticle(articleToArchive.article_id);
      if (typeof result === 'object' && 'code' in result) {
        toast.error(t('list.feedback.archiveError', { defaultValue: 'Failed to archive article' }));
        return;
      }
      toast.success(t('list.feedback.archiveSuccess', { defaultValue: 'Article archived' }));
      onRefresh();
    } catch (error) {
      handleError(error, t('list.feedback.archiveError', { defaultValue: 'Failed to archive article' }));
    } finally {
      setIsArchiving(false);
      setArchiveDialogOpen(false);
      setArticleToArchive(null);
    }
  };

  const confirmArchive = (article: IKBArticleWithDocument) => {
    setArticleToArchive(article);
    setArchiveDialogOpen(true);
  };

  const confirmDelete = (article: IKBArticleWithDocument) => {
    setArticleToDelete(article);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!articleToDelete) return;

    setIsDeleting(true);
    try {
      const result = await deleteArticle(articleToDelete.article_id);
      if (typeof result === 'object' && 'code' in result) {
        toast.error(t('list.feedback.deleteError', { defaultValue: 'Failed to delete article' }));
        return;
      }
      toast.success(t('list.feedback.deleteSuccess', { defaultValue: 'Article deleted permanently' }));
      onRefresh();
    } catch (error) {
      handleError(error, t('list.feedback.deleteError', { defaultValue: 'Failed to delete article' }));
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setArticleToDelete(null);
    }
  };

  const toggleSelection = (articleId: string) => {
    const newSelected = new Set(selectedArticles);
    if (newSelected.has(articleId)) {
      newSelected.delete(articleId);
    } else {
      newSelected.add(articleId);
    }
    setSelectedArticles(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedArticles.size === articles.length) {
      setSelectedArticles(new Set());
    } else {
      setSelectedArticles(new Set(articles.map((a) => a.article_id)));
    }
  };

  const isStale = (article: IKBArticleWithDocument): boolean => {
    if (!article.next_review_due) return false;
    return new Date(article.next_review_due) < new Date();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Spinner size="sm" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t('list.title', { defaultValue: 'Knowledge Base Articles' })}</h3>
          <p className="text-sm text-muted-foreground">
            {t('list.countSummary', { defaultValue: '{{count}} article(s)', count: total })}
          </p>
        </div>
        {onCreateNew && (
          <Button id="kb-list-create" onClick={onCreateNew} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            {t('page.actions.newArticle', { defaultValue: 'New Article' })}
          </Button>
        )}
      </div>

      {/* Table */}
      {articles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground mb-4">{t('list.empty', { defaultValue: 'No articles found' })}</p>
            {onCreateNew && (
              <Button id="kb-list-create-empty" onClick={onCreateNew} variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                {t('list.createFirst', { defaultValue: 'Create Your First Article' })}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    id="kb-select-all"
                    checked={selectedArticles.size === articles.length && articles.length > 0}
                    onChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>{t('list.table.title', { defaultValue: 'Title' })}</TableHead>
                <TableHead>{t('list.table.type', { defaultValue: 'Type' })}</TableHead>
                <TableHead>{t('list.table.audience', { defaultValue: 'Audience' })}</TableHead>
                <TableHead>{t('list.table.status', { defaultValue: 'Status' })}</TableHead>
                <TableHead>{t('list.table.tags', { defaultValue: 'Tags' })}</TableHead>
                <TableHead>{t('list.table.stats', { defaultValue: 'Stats' })}</TableHead>
                <TableHead>{t('list.table.updated', { defaultValue: 'Updated' })}</TableHead>
                <TableHead className="w-16">{t('list.table.actions', { defaultValue: 'Actions' })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articles.map((article) => (
                <TableRow
                  key={article.article_id}
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))]"
                  onClick={() => onEdit?.(article)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      id={`kb-checkbox-${article.article_id}`}
                      checked={selectedArticles.has(article.article_id)}
                      onChange={() => toggleSelection(article.article_id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-gray-400" />
                      <span className="font-medium">{article.document_name || article.slug}</span>
                      {isStale(article) && (
                        <span title={t('list.stale.reviewOverdue', { defaultValue: 'Review overdue' })}>
                          <AlertCircle className="w-4 h-4 text-orange-500" />
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {getTypeLabel(article.article_type)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={AUDIENCE_COLORS[article.audience]}>
                      {getAudienceLabel(article.audience)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLORS[article.status]}>
                      {getStatusLabel(article.status)}
                    </Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <TagManager
                      entityId={article.article_id}
                      entityType="knowledge_base_article"
                      initialTags={articleTagsRef.current[article.article_id] || []}
                      onTagsChange={(tags) => handleTagsChange(article.article_id, tags)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1" title={t('list.stats.views', { defaultValue: 'Views' })}>
                        <Eye className="w-3 h-3" />
                        {article.view_count}
                      </span>
                      <span className="flex items-center gap-1" title={t('list.stats.helpful', { defaultValue: 'Helpful' })}>
                        <ThumbsUp className="w-3 h-3" />
                        {article.helpful_count}
                      </span>
                      <span className="flex items-center gap-1" title={t('list.stats.notHelpful', { defaultValue: 'Not helpful' })}>
                        <ThumbsDown className="w-3 h-3" />
                        {article.not_helpful_count}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {article.updated_at ? formatDate(article.updated_at) : t('shared.fallbacks.emptyDate', { defaultValue: '-' })}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button id={`kb-article-menu-${article.article_id}`} variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {onEdit && (
                          <DropdownMenuItem onClick={() => onEdit(article)}>
                            <Pencil className="w-4 h-4 mr-2" />
                            {t('list.actions.edit', { defaultValue: 'Edit' })}
                          </DropdownMenuItem>
                        )}
                        {article.status === 'draft' && onSubmitForReview && (
                          <DropdownMenuItem onClick={() => onSubmitForReview(article)}>
                            <Send className="w-4 h-4 mr-2" />
                            {t('list.actions.submitForReview', { defaultValue: 'Submit for Review' })}
                          </DropdownMenuItem>
                        )}
                        {(article.status === 'draft' || article.status === 'review') && onPublish && (
                          <DropdownMenuItem onClick={() => onPublish(article)}>
                            <CheckCircle className="w-4 h-4 mr-2" />
                            {t('list.actions.publish', { defaultValue: 'Publish' })}
                          </DropdownMenuItem>
                        )}
                        {article.status !== 'archived' && (
                          <DropdownMenuItem
                            onClick={() => confirmArchive(article)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Archive className="w-4 h-4 mr-2" />
                            {t('list.actions.archive', { defaultValue: 'Archive' })}
                          </DropdownMenuItem>
                        )}
                        {(article.status === 'draft' || article.status === 'archived') && (
                          <DropdownMenuItem
                            id={`kb-article-delete-${article.article_id}`}
                            onClick={() => confirmDelete(article)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t('list.actions.delete', { defaultValue: 'Delete permanently' })}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      <Pagination
        id="kb-article-list-pagination"
        currentPage={currentPage}
        totalItems={total}
        itemsPerPage={pageSize}
        onPageChange={onPageChange}
        onItemsPerPageChange={(size) => {
          onPageSizeChange(size);
        }}
        itemsPerPageOptions={[
          { value: '10', label: t('list.pagination.itemsPerPage.10', { defaultValue: '10 items/page' }) },
          { value: '20', label: t('list.pagination.itemsPerPage.20', { defaultValue: '20 items/page' }) },
          { value: '50', label: t('list.pagination.itemsPerPage.50', { defaultValue: '50 items/page' }) },
        ]}
        variant="clients"
        itemLabel={t('list.itemLabel', { defaultValue: 'articles' })}
      />

      {/* Archive Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={archiveDialogOpen}
        onClose={() => {
          setArchiveDialogOpen(false);
          setArticleToArchive(null);
        }}
        onConfirm={handleArchive}
        title={t('list.dialogs.archive.title', { defaultValue: 'Archive Article' })}
        message={t('list.dialogs.archive.message', {
          defaultValue: 'Are you sure you want to archive "{{title}}"? This will remove it from client visibility.',
          title: articleToArchive?.document_name || articleToArchive?.slug || '',
        })}
        confirmLabel={t('list.actions.archive', { defaultValue: 'Archive' })}
        isConfirming={isArchiving}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        id="kb-article-delete-dialog"
        isOpen={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setArticleToDelete(null);
        }}
        onConfirm={handleDelete}
        title={t('list.dialogs.delete.title', { defaultValue: 'Delete Article' })}
        message={t('list.dialogs.delete.message', {
          defaultValue:
            'Are you sure you want to permanently delete "{{title}}"? This will remove the article and its content, and cannot be undone.',
          title: articleToDelete?.document_name || articleToDelete?.slug || '',
        })}
        confirmLabel={t('list.actions.delete', { defaultValue: 'Delete permanently' })}
        isConfirming={isDeleting}
      />
    </div>
  );
}
