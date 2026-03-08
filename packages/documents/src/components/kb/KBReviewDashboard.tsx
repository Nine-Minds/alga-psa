'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatDate } from '@alga-psa/core/formatters';
import {
  Clock,
  AlertCircle,
  BookOpen,
  CheckCircle,
  XCircle,
  Eye,
} from 'lucide-react';
import {
  getArticles,
  getStaleArticles,
  IKBArticleWithDocument,
} from '../../actions/kbArticleActions';

interface KBReviewDashboardProps {
  onEditArticle?: (article: IKBArticleWithDocument) => void;
  onReviewArticle?: (article: IKBArticleWithDocument) => void;
}

export default function KBReviewDashboard({
  onEditArticle,
  onReviewArticle,
}: KBReviewDashboardProps) {
  const { t } = useTranslation('features/documents');
  const tRef = useRef(t);
  tRef.current = t;

  const [articlesInReview, setArticlesInReview] = useState<IKBArticleWithDocument[]>([]);
  const [staleArticles, setStaleArticles] = useState<IKBArticleWithDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Load articles in review
      const reviewResult = await getArticles(1, 50, { status: 'review' });
      if (!('code' in reviewResult)) {
        setArticlesInReview((reviewResult as { articles: IKBArticleWithDocument[] }).articles);
      }

      // Load stale articles (past review due date)
      const staleResult = await getStaleArticles();
      if (!('code' in staleResult)) {
        setStaleArticles(staleResult as IKBArticleWithDocument[]);
      }
    } catch (error) {
      handleError(error, tRef.current('kb.loadError', 'Failed to load review data'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Spinner size="sm" />
      </div>
    );
  }

  const hasReviewWork = articlesInReview.length > 0 || staleArticles.length > 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-yellow-100 dark:bg-yellow-900/40">
                <Clock className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{articlesInReview.length}</p>
                <p className="text-sm text-muted-foreground">
                  {t('kb.awaitingReview', 'Awaiting Review')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-orange-100 dark:bg-orange-900/40">
                <AlertCircle className="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{staleArticles.length}</p>
                <p className="text-sm text-muted-foreground">
                  {t('kb.overdueReviews', 'Overdue Reviews')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {!hasReviewWork && (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500 opacity-75" />
            <p className="text-muted-foreground">
              {t('kb.noReviewWork', 'All caught up! No articles need review.')}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Articles Awaiting Review */}
      {articlesInReview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-yellow-500" />
              {t('kb.awaitingReviewTitle', 'Articles Awaiting Review')}
              <Badge variant="secondary">{articlesInReview.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {articlesInReview.map((article) => (
                <div
                  key={article.article_id}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-[rgb(var(--color-border-200))] hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))]"
                >
                  <div className="flex items-center gap-3">
                    <BookOpen className="w-4 h-4 text-gray-400" />
                    <div>
                      <p className="font-medium">{article.document_name || article.slug}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('kb.submittedOn', 'Submitted')}: {formatDate(article.updated_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {onEditArticle && (
                      <Button id={`kb-review-edit-${article.article_id}`} variant="ghost" size="sm" onClick={() => onEditArticle(article)}>
                        <Eye className="w-4 h-4 mr-1" />
                        {t('kb.view', 'View')}
                      </Button>
                    )}
                    {onReviewArticle && (
                      <Button id={`kb-review-review-${article.article_id}`} variant="default" size="sm" onClick={() => onReviewArticle(article)}>
                        <CheckCircle className="w-4 h-4 mr-1" />
                        {t('kb.review', 'Review')}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overdue Reviews */}
      {staleArticles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-orange-500" />
              {t('kb.overdueReviewsTitle', 'Overdue for Review')}
              <Badge variant="error">{staleArticles.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {staleArticles.map((article) => (
                <div
                  key={article.article_id}
                  className="flex items-center justify-between p-3 rounded-lg border border-orange-200 dark:border-orange-900/40 bg-orange-50 dark:bg-orange-900/10"
                >
                  <div className="flex items-center gap-3">
                    <AlertCircle className="w-4 h-4 text-orange-500" />
                    <div>
                      <p className="font-medium">{article.document_name || article.slug}</p>
                      <p className="text-xs text-orange-600 dark:text-orange-400">
                        {t('kb.dueOn', 'Due')}: {article.next_review_due ? formatDate(article.next_review_due) : '-'}
                        {' '}&bull;{' '}
                        {t('kb.lastReviewed', 'Last reviewed')}: {article.last_reviewed_at ? formatDate(article.last_reviewed_at) : t('kb.never', 'Never')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {onEditArticle && (
                      <Button id={`kb-stale-edit-${article.article_id}`} variant="outline" size="sm" onClick={() => onEditArticle(article)}>
                        <Eye className="w-4 h-4 mr-1" />
                        {t('kb.reviewNow', 'Review Now')}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
