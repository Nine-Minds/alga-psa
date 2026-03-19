'use client';

import React, { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  Send,
  CheckCircle,
  Archive,
  Edit,
  ArrowRight,
} from 'lucide-react';
import {
  publishArticle,
  archiveArticle,
  ArticleStatus,
  IKBArticleWithDocument,
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

interface KBPublishingControlsProps {
  article: IKBArticleWithDocument;
  onStatusChange?: () => void;
  onSubmitForReview?: () => void;
}

export default function KBPublishingControls({
  article,
  onStatusChange,
  onSubmitForReview,
}: KBPublishingControlsProps) {
  const { t } = useTranslation('features/documents');
  const [isPublishing, setIsPublishing] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      const result = await publishArticle(article.article_id);
      if (typeof result === 'object' && 'code' in result) {
        toast.error(t('kb.publishError', 'Failed to publish article'));
        return;
      }
      toast.success(t('kb.publishSuccess', 'Article published successfully'));
      onStatusChange?.();
    } catch (error) {
      handleError(error, t('kb.publishError', 'Failed to publish article'));
    } finally {
      setIsPublishing(false);
      setPublishDialogOpen(false);
    }
  };

  const handleArchive = async () => {
    setIsArchiving(true);
    try {
      const result = await archiveArticle(article.article_id);
      if (typeof result === 'object' && 'code' in result) {
        toast.error(t('kb.archiveError', 'Failed to archive article'));
        return;
      }
      toast.success(t('kb.archiveSuccess', 'Article archived'));
      onStatusChange?.();
    } catch (error) {
      handleError(error, t('kb.archiveError', 'Failed to archive article'));
    } finally {
      setIsArchiving(false);
      setArchiveDialogOpen(false);
    }
  };

  const getAvailableTransitions = (): Array<{
    action: 'submit_review' | 'publish' | 'archive' | 'revert_draft';
    label: string;
    icon: React.ReactNode;
    variant: 'default' | 'outline' | 'destructive';
    targetStatus: ArticleStatus;
  }> => {
    const transitions: Array<{
      action: 'submit_review' | 'publish' | 'archive' | 'revert_draft';
      label: string;
      icon: React.ReactNode;
      variant: 'default' | 'outline' | 'destructive';
      targetStatus: ArticleStatus;
    }> = [];

    switch (article.status) {
      case 'draft':
        if (onSubmitForReview) {
          transitions.push({
            action: 'submit_review',
            label: t('kb.submitForReview', 'Submit for Review'),
            icon: <Send className="w-4 h-4 mr-2" />,
            variant: 'outline',
            targetStatus: 'review',
          });
        }
        transitions.push({
          action: 'publish',
          label: t('kb.publish', 'Publish'),
          icon: <CheckCircle className="w-4 h-4 mr-2" />,
          variant: 'default',
          targetStatus: 'published',
        });
        break;
      case 'review':
        transitions.push({
          action: 'publish',
          label: t('kb.approveAndPublish', 'Approve & Publish'),
          icon: <CheckCircle className="w-4 h-4 mr-2" />,
          variant: 'default',
          targetStatus: 'published',
        });
        break;
      case 'published':
        transitions.push({
          action: 'archive',
          label: t('kb.archive', 'Archive'),
          icon: <Archive className="w-4 h-4 mr-2" />,
          variant: 'destructive',
          targetStatus: 'archived',
        });
        break;
      case 'archived':
        // Can republish an archived article
        transitions.push({
          action: 'publish',
          label: t('kb.republish', 'Republish'),
          icon: <CheckCircle className="w-4 h-4 mr-2" />,
          variant: 'default',
          targetStatus: 'published',
        });
        break;
    }

    // Can always archive non-archived articles
    if (article.status !== 'archived' && article.status !== 'published') {
      transitions.push({
        action: 'archive',
        label: t('kb.archive', 'Archive'),
        icon: <Archive className="w-4 h-4 mr-2" />,
        variant: 'destructive',
        targetStatus: 'archived',
      });
    }

    return transitions;
  };

  const transitions = getAvailableTransitions();

  const handleTransition = (action: string) => {
    switch (action) {
      case 'submit_review':
        onSubmitForReview?.();
        break;
      case 'publish':
        setPublishDialogOpen(true);
        break;
      case 'archive':
        setArchiveDialogOpen(true);
        break;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('kb.publishing', 'Publishing')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('kb.currentStatus', 'Current Status')}</span>
          <Badge className={STATUS_COLORS[article.status]}>
            {STATUS_LABELS[article.status]}
          </Badge>
        </div>

        {/* Status Flow Visualization */}
        <div className="flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground">
          <span className={article.status === 'draft' ? 'font-bold text-gray-700' : ''}>
            Draft
          </span>
          <ArrowRight className="w-3 h-3" />
          <span className={article.status === 'review' ? 'font-bold text-yellow-700' : ''}>
            Review
          </span>
          <ArrowRight className="w-3 h-3" />
          <span className={article.status === 'published' ? 'font-bold text-green-700' : ''}>
            Published
          </span>
        </div>

        {/* Transition Buttons */}
        <div className="space-y-2">
          {transitions.map((transition) => (
            <Button
              id={`kb-publish-${transition.action}`}
              key={transition.action}
              variant={transition.variant}
              className="w-full"
              onClick={() => handleTransition(transition.action)}
              disabled={isPublishing || isArchiving}
            >
              {transition.icon}
              {transition.label}
            </Button>
          ))}
        </div>

        {/* Audience Warning */}
        {article.status !== 'published' && (article.audience === 'client' || article.audience === 'public') && (
          <p className="text-xs text-muted-foreground">
            {t(
              'kb.audienceWarning',
              'Publishing will make this article visible to {{audience}} users.',
              { audience: article.audience }
            )}
          </p>
        )}
      </CardContent>

      {/* Publish Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={publishDialogOpen}
        onClose={() => setPublishDialogOpen(false)}
        onConfirm={handlePublish}
        title={t('kb.confirmPublish', 'Publish Article')}
        message={
          article.audience === 'client' || article.audience === 'public'
            ? t(
                'kb.publishMessageAudience',
                `This will publish the article and make it visible to ${article.audience} users. Are you sure?`
              )
            : t('kb.publishMessage', 'Are you sure you want to publish this article?')
        }
        confirmLabel={t('kb.publish', 'Publish')}
        isConfirming={isPublishing}
      />

      {/* Archive Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={archiveDialogOpen}
        onClose={() => setArchiveDialogOpen(false)}
        onConfirm={handleArchive}
        title={t('kb.confirmArchive', 'Archive Article')}
        message={t(
          'kb.archiveMessage',
          'This will archive the article and remove it from client visibility. Are you sure?'
        )}
        confirmLabel={t('kb.archive', 'Archive')}
        isConfirming={isArchiving}
      />
    </Card>
  );
}
