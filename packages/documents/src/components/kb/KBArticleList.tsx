'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
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
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatDate } from '@alga-psa/core/formatters';
import {
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Send,
  CheckCircle,
  Archive,
  BookOpen,
  Eye,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
} from 'lucide-react';
import {
  getArticles,
  archiveArticle,
  IKBArticleWithDocument,
  IArticleFilters,
  ArticleStatus,
  ArticleAudience,
  ArticleType,
} from '../../actions/kbArticleActions';

const STATUS_COLORS: Record<ArticleStatus, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  review: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  published: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  archived: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const STATUS_LABELS: Record<ArticleStatus, string> = {
  draft: 'Draft',
  review: 'In Review',
  published: 'Published',
  archived: 'Archived',
};

const AUDIENCE_COLORS: Record<ArticleAudience, string> = {
  internal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  client: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  public: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
};

const AUDIENCE_LABELS: Record<ArticleAudience, string> = {
  internal: 'Internal',
  client: 'Client',
  public: 'Public',
};

const TYPE_LABELS: Record<ArticleType, string> = {
  how_to: 'How-To',
  faq: 'FAQ',
  troubleshooting: 'Troubleshooting',
  reference: 'Reference',
};

interface KBArticleListProps {
  filters?: IArticleFilters;
  onEdit?: (article: IKBArticleWithDocument) => void;
  onCreateNew?: () => void;
  onSubmitForReview?: (article: IKBArticleWithDocument) => void;
  onPublish?: (article: IKBArticleWithDocument) => void;
}

export default function KBArticleList({
  filters = {},
  onEdit,
  onCreateNew,
  onSubmitForReview,
  onPublish,
}: KBArticleListProps) {
  const { t } = useTranslation('common');
  const [articles, setArticles] = useState<IKBArticleWithDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  // Archive confirmation dialog state
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [articleToArchive, setArticleToArchive] = useState<IKBArticleWithDocument | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const loadArticles = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getArticles(currentPage, pageSize, filters);
      if ('code' in result && result.code === 'PERMISSION_DENIED') {
        toast.error(t('kb.permissionDenied', 'Permission denied'));
        setArticles([]);
        return;
      }
      const data = result as { articles: IKBArticleWithDocument[]; total: number; totalPages: number };
      setArticles(data.articles);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (error) {
      handleError(error, t('kb.loadError', 'Failed to load articles'));
      setArticles([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, filters, t]);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  const handleArchive = async () => {
    if (!articleToArchive) return;

    setIsArchiving(true);
    try {
      const result = await archiveArticle(articleToArchive.article_id);
      if (typeof result === 'object' && 'code' in result) {
        toast.error(t('kb.archiveError', 'Failed to archive article'));
        return;
      }
      toast.success(t('kb.archiveSuccess', 'Article archived'));
      await loadArticles();
    } catch (error) {
      handleError(error, t('kb.archiveError', 'Failed to archive article'));
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t('kb.articles', 'Knowledge Base Articles')}</h3>
          <p className="text-sm text-muted-foreground">
            {total} {t('kb.articleCount', 'article(s)')}
          </p>
        </div>
        {onCreateNew && (
          <Button onClick={onCreateNew} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            {t('kb.newArticle', 'New Article')}
          </Button>
        )}
      </div>

      {/* Table */}
      {articles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground mb-4">{t('kb.empty', 'No articles found')}</p>
            {onCreateNew && (
              <Button onClick={onCreateNew} variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                {t('kb.createFirst', 'Create Your First Article')}
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
                <TableHead>{t('kb.title', 'Title')}</TableHead>
                <TableHead>{t('kb.type', 'Type')}</TableHead>
                <TableHead>{t('kb.audience', 'Audience')}</TableHead>
                <TableHead>{t('kb.status', 'Status')}</TableHead>
                <TableHead>{t('kb.stats', 'Stats')}</TableHead>
                <TableHead>{t('kb.updated', 'Updated')}</TableHead>
                <TableHead className="w-16">{t('kb.actions', 'Actions')}</TableHead>
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
                        <AlertCircle
                          className="w-4 h-4 text-orange-500"
                          title={t('kb.reviewOverdue', 'Review overdue')}
                        />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {TYPE_LABELS[article.article_type] || article.article_type}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={AUDIENCE_COLORS[article.audience]}>
                      {AUDIENCE_LABELS[article.audience]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLORS[article.status]}>
                      {STATUS_LABELS[article.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1" title={t('kb.views', 'Views')}>
                        <Eye className="w-3 h-3" />
                        {article.view_count}
                      </span>
                      <span className="flex items-center gap-1" title={t('kb.helpful', 'Helpful')}>
                        <ThumbsUp className="w-3 h-3" />
                        {article.helpful_count}
                      </span>
                      <span className="flex items-center gap-1" title={t('kb.notHelpful', 'Not helpful')}>
                        <ThumbsDown className="w-3 h-3" />
                        {article.not_helpful_count}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {article.updated_at ? formatDate(article.updated_at) : '-'}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {onEdit && (
                          <DropdownMenuItem onClick={() => onEdit(article)}>
                            <Pencil className="w-4 h-4 mr-2" />
                            {t('kb.edit', 'Edit')}
                          </DropdownMenuItem>
                        )}
                        {article.status === 'draft' && onSubmitForReview && (
                          <DropdownMenuItem onClick={() => onSubmitForReview(article)}>
                            <Send className="w-4 h-4 mr-2" />
                            {t('kb.submitForReview', 'Submit for Review')}
                          </DropdownMenuItem>
                        )}
                        {(article.status === 'draft' || article.status === 'review') && onPublish && (
                          <DropdownMenuItem onClick={() => onPublish(article)}>
                            <CheckCircle className="w-4 h-4 mr-2" />
                            {t('kb.publish', 'Publish')}
                          </DropdownMenuItem>
                        )}
                        {article.status !== 'archived' && (
                          <DropdownMenuItem
                            onClick={() => confirmArchive(article)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Archive className="w-4 h-4 mr-2" />
                            {t('kb.archive', 'Archive')}
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {t('kb.showing', 'Showing')} {(currentPage - 1) * pageSize + 1}-
            {Math.min(currentPage * pageSize, total)} {t('kb.of', 'of')} {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              {t('kb.previous', 'Previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              {t('kb.next', 'Next')}
            </Button>
          </div>
        </div>
      )}

      {/* Archive Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={archiveDialogOpen}
        onClose={() => {
          setArchiveDialogOpen(false);
          setArticleToArchive(null);
        }}
        onConfirm={handleArchive}
        title={t('kb.archiveTitle', 'Archive Article')}
        message={t(
          'kb.archiveMessage',
          `Are you sure you want to archive "${articleToArchive?.document_name || articleToArchive?.slug}"? This will remove it from client visibility.`
        )}
        confirmLabel={t('kb.archive', 'Archive')}
        isConfirming={isArchiving}
      />
    </div>
  );
}
