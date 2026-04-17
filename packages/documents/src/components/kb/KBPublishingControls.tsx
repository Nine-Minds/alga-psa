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
  useFormatArticleAudience,
  useFormatArticleStatus,
} from '@alga-psa/ui/hooks/useKnowledgeBaseEnumOptions';
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
  const { t } = useTranslation('msp/knowledge-base');
  const [isPublishing, setIsPublishing] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  const getStatusLabel = useFormatArticleStatus();
  const getAudienceLabel = useFormatArticleAudience();

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      const result = await publishArticle(article.article_id);
      if (typeof result === 'object' && 'code' in result) {
        toast.error(t('publishing.feedback.publishError', { defaultValue: 'Failed to publish article' }));
        return;
      }
      toast.success(t('publishing.feedback.publishSuccess', { defaultValue: 'Article published successfully' }));
      onStatusChange?.();
    } catch (error) {
      handleError(error, t('publishing.feedback.publishError', { defaultValue: 'Failed to publish article' }));
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
        toast.error(t('publishing.feedback.archiveError', { defaultValue: 'Failed to archive article' }));
        return;
      }
      toast.success(t('publishing.feedback.archiveSuccess', { defaultValue: 'Article archived' }));
      onStatusChange?.();
    } catch (error) {
      handleError(error, t('publishing.feedback.archiveError', { defaultValue: 'Failed to archive article' }));
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
            label: t('publishing.actions.submitForReview', { defaultValue: 'Submit for Review' }),
            icon: <Send className="w-4 h-4 mr-2" />,
            variant: 'outline',
            targetStatus: 'review',
          });
        }
        transitions.push({
          action: 'publish',
          label: t('publishing.actions.publish', { defaultValue: 'Publish' }),
          icon: <CheckCircle className="w-4 h-4 mr-2" />,
          variant: 'default',
          targetStatus: 'published',
        });
        break;
      case 'review':
        transitions.push({
          action: 'publish',
          label: t('publishing.actions.approveAndPublish', { defaultValue: 'Approve & Publish' }),
          icon: <CheckCircle className="w-4 h-4 mr-2" />,
          variant: 'default',
          targetStatus: 'published',
        });
        break;
      case 'published':
        transitions.push({
          action: 'archive',
          label: t('publishing.actions.archive', { defaultValue: 'Archive' }),
          icon: <Archive className="w-4 h-4 mr-2" />,
          variant: 'destructive',
          targetStatus: 'archived',
        });
        break;
      case 'archived':
        // Can republish an archived article
        transitions.push({
          action: 'publish',
          label: t('publishing.actions.republish', { defaultValue: 'Republish' }),
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
        label: t('publishing.actions.archive', { defaultValue: 'Archive' }),
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
        <CardTitle className="text-sm font-medium">{t('publishing.title', { defaultValue: 'Publishing' })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('publishing.currentStatus', { defaultValue: 'Current Status' })}</span>
          <Badge className={STATUS_COLORS[article.status]}>
            {getStatusLabel(article.status)}
          </Badge>
        </div>

        {/* Status Flow Visualization */}
        <div className="flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground">
          <span className={article.status === 'draft' ? 'font-bold text-gray-700' : ''}>
            {t('publishing.flow.draft', { defaultValue: 'Draft' })}
          </span>
          <ArrowRight className="w-3 h-3" />
          <span className={article.status === 'review' ? 'font-bold text-yellow-700' : ''}>
            {t('publishing.flow.review', { defaultValue: 'Review' })}
          </span>
          <ArrowRight className="w-3 h-3" />
          <span className={article.status === 'published' ? 'font-bold text-green-700' : ''}>
            {t('publishing.flow.published', { defaultValue: 'Published' })}
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
            {t('publishing.warnings.audience', {
              defaultValue: 'Publishing will make this article visible to {{audience}} users.',
              audience: getAudienceLabel(article.audience),
            })}
          </p>
        )}
      </CardContent>

      {/* Publish Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={publishDialogOpen}
        onClose={() => setPublishDialogOpen(false)}
        onConfirm={handlePublish}
        title={t('publishing.dialogs.publish.title', { defaultValue: 'Publish Article' })}
        message={
          article.audience === 'client' || article.audience === 'public'
            ? t('publishing.dialogs.publish.messageWithAudience', {
                defaultValue: 'This will publish the article and make it visible to {{audience}} users. Are you sure?',
                audience: getAudienceLabel(article.audience),
              })
            : t('publishing.dialogs.publish.message', { defaultValue: 'Are you sure you want to publish this article?' })
        }
        confirmLabel={t('publishing.actions.publish', { defaultValue: 'Publish' })}
        isConfirming={isPublishing}
      />

      {/* Archive Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={archiveDialogOpen}
        onClose={() => setArchiveDialogOpen(false)}
        onConfirm={handleArchive}
        title={t('publishing.dialogs.archive.title', { defaultValue: 'Archive Article' })}
        message={t('publishing.dialogs.archive.message', {
          defaultValue: 'This will archive the article and remove it from client visibility. Are you sure?',
        })}
        confirmLabel={t('publishing.actions.archive', { defaultValue: 'Archive' })}
        isConfirming={isArchiving}
      />
    </Card>
  );
}
