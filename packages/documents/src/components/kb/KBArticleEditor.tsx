'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Badge } from '@alga-psa/ui/components/Badge';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  Save,
  ArrowLeft,
  Eye,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
  Calendar,
  Tags,
  Send,
  CheckCircle,
  Archive,
} from 'lucide-react';
import { CollaborativeEditor } from '../CollaborativeEditor';
import { DocumentEditor } from '../DocumentEditor';
import { searchUsersForMentions } from '@alga-psa/user-composition/actions';
import {
  getArticle,
  updateArticle,
  publishArticle,
  IKBArticleWithDocument,
  IUpdateArticleInput,
  ArticleType,
  ArticleAudience,
  ArticleStatus,
} from '../../actions/kbArticleActions';
import { TagManager, findTagsByEntityId } from '@alga-psa/tags';
import type { ITag } from '@alga-psa/types';
import {
  useArticleAudienceOptions,
  useArticleTypeOptions,
  useFormatArticleStatus,
} from '@alga-psa/ui/hooks/useKnowledgeBaseEnumOptions';

const STATUS_COLORS: Record<ArticleStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  review: 'bg-yellow-100 text-yellow-700',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-red-100 text-red-700',
};

const REVIEW_CYCLE_OPTION_DEFAULTS: SelectOption[] = [
  { value: '', label: 'No review cycle' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
];

interface KBArticleEditorProps {
  articleId: string;
  userId: string;
  userName?: string;
  tenantId?: string;
  aiAssistantEnabled?: boolean;
  onBack?: () => void;
  onSave?: () => void;
  categories?: Array<{ id: string; name: string }>;
}

export default function KBArticleEditor({
  articleId,
  userId,
  userName,
  tenantId,
  aiAssistantEnabled = false,
  onBack,
  onSave,
  categories = [],
}: KBArticleEditorProps) {
  const { t } = useTranslation('msp/knowledge-base');
  const { formatDate } = useFormatters();
  const tRef = useRef(t);
  tRef.current = t;

  const [article, setArticle] = useState<IKBArticleWithDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedMetadata, setHasUnsavedMetadata] = useState(false);
  const [articleTags, setArticleTags] = useState<ITag[]>([]);
  const [isFallbackMode, setIsFallbackMode] = useState(!userName || !tenantId);

  // Auto-fallback if CollaborativeEditor can't connect within 5 seconds
  const collabConnectedRef = useRef(false);
  useEffect(() => {
    if (isFallbackMode) return;
    const timer = setTimeout(() => {
      if (!collabConnectedRef.current) {
        console.warn('[KBArticleEditor] Collab connection timeout, switching to fallback editor');
        setIsFallbackMode(true);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [isFallbackMode]);

  // Form state for metadata
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [articleType, setArticleType] = useState<ArticleType>('how_to');
  const [audience, setAudience] = useState<ArticleAudience>('internal');
  const [categoryId, setCategoryId] = useState<string>('');
  const [reviewCycleDays, setReviewCycleDays] = useState<string>('');

  const formatStatus = useFormatArticleStatus();
  const typeOptions: SelectOption[] = useArticleTypeOptions();
  const audienceOptions: SelectOption[] = useArticleAudienceOptions();

  const reviewCycleOptions: SelectOption[] = REVIEW_CYCLE_OPTION_DEFAULTS.map((option) => ({
    ...option,
    label: t(
      option.value ? `shared.reviewCycleOptions.${option.value}` : 'shared.reviewCycleOptions.none',
      { defaultValue: option.label }
    ),
  }));

  const categoryOptions: SelectOption[] = [
    { value: '', label: t('editor.metadata.fields.noCategory', { defaultValue: 'No category' }) },
    ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
  ];

  const loadArticle = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getArticle(articleId);
      if (result && typeof result === 'object' && 'code' in result) {
        toast.error(tRef.current('editor.feedback.permissionDenied', { defaultValue: 'Permission denied' }));
        return;
      }
      const articleData = result as IKBArticleWithDocument | null;
      if (!articleData) {
        toast.error(tRef.current('editor.feedback.notFound', { defaultValue: 'Article not found' }));
        return;
      }
      setArticle(articleData);
      setTitle(articleData.document_name || '');
      setSlug(articleData.slug || '');
      setArticleType(articleData.article_type);
      setAudience(articleData.audience);
      setCategoryId(articleData.category_id || '');
      setReviewCycleDays(articleData.review_cycle_days?.toString() || '');

      // Load tags for the article
      try {
        const tags = await findTagsByEntityId(articleData.article_id, 'knowledge_base_article');
        setArticleTags(tags);
      } catch (tagError) {
        console.error('Failed to load article tags:', tagError);
      }
    } catch (error) {
      handleError(error, tRef.current('editor.feedback.loadError', { defaultValue: 'Failed to load article' }));
    } finally {
      setIsLoading(false);
    }
  }, [articleId]);

  useEffect(() => {
    loadArticle();
  }, [loadArticle]);

  const handleSaveMetadata = async () => {
    if (!article) return;

    setIsSaving(true);
    try {
      const updates: IUpdateArticleInput = {};

      if (title !== article.document_name) {
        updates.title = title;
      }
      if (slug !== article.slug) {
        updates.slug = slug;
      }
      if (articleType !== article.article_type) {
        updates.articleType = articleType;
      }
      if (audience !== article.audience) {
        updates.audience = audience;
      }
      if ((categoryId || null) !== article.category_id) {
        updates.categoryId = categoryId || null;
      }
      const newReviewCycleDays = reviewCycleDays ? parseInt(reviewCycleDays, 10) : null;
      if (newReviewCycleDays !== article.review_cycle_days) {
        updates.reviewCycleDays = newReviewCycleDays;
      }

      if (Object.keys(updates).length === 0) {
        toast.success(t('editor.feedback.noChanges', { defaultValue: 'No changes to save' }));
        return;
      }

      const result = await updateArticle(article.article_id, updates);
      if (typeof result === 'object' && 'code' in result) {
        toast.error(t('editor.feedback.saveError', { defaultValue: 'Failed to save article' }));
        return;
      }
      toast.success(t('editor.feedback.saveSuccess', { defaultValue: 'Article metadata saved' }));
      setHasUnsavedMetadata(false);
      onSave?.();
      // Reload article to get updated data
      await loadArticle();
    } catch (error) {
      handleError(error, t('editor.feedback.saveError', { defaultValue: 'Failed to save article' }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleMetadataChange = () => {
    setHasUnsavedMetadata(true);
  };

  const handleStatusChange = async (newStatus: 'review' | 'published' | 'archived') => {
    if (!article) return;

    setIsSaving(true);
    try {
      if (newStatus === 'published') {
        const result = await publishArticle(article.article_id);
        if (typeof result === 'object' && 'code' in result) {
          toast.error(t('editor.feedback.publishError', { defaultValue: 'Failed to publish article' }));
          return;
        }
        toast.success(t('editor.feedback.publishSuccess', { defaultValue: 'Article published' }));
      } else {
        const result = await updateArticle(article.article_id, { status: newStatus });
        if (typeof result === 'object' && 'code' in result) {
          toast.error(t('editor.feedback.statusChangeError', { defaultValue: 'Failed to change article status' }));
          return;
        }
        toast.success(
          newStatus === 'review'
            ? t('editor.feedback.submitForReviewSuccess', { defaultValue: 'Article submitted for review' })
            : t('editor.feedback.archiveSuccess', { defaultValue: 'Article archived' })
        );
      }
      await loadArticle();
    } catch (error) {
      handleError(error, t('editor.feedback.statusChangeError', { defaultValue: 'Failed to change article status' }));
    } finally {
      setIsSaving(false);
    }
  };

  const isStale = article?.next_review_due && new Date(article.next_review_due) < new Date();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="sm" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">{t('editor.feedback.notFound', { defaultValue: 'Article not found' })}</p>
        {onBack && (
          <Button id="kb-editor-back" variant="outline" onClick={onBack} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('editor.header.back', { defaultValue: 'Back' })}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Main Editor */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {onBack && (
              <Button id="kb-editor-back-nav" variant="ghost" size="sm" onClick={onBack}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <div>
              <h2 className="text-lg font-semibold">{title || t('editor.header.untitled', { defaultValue: 'Untitled Article' })}</h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge className={STATUS_COLORS[article.status]}>
                  {formatStatus(article.status)}
                </Badge>
                {isStale && (
                  <Badge className="bg-orange-100 text-orange-700">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    {t('editor.badges.reviewOverdue', { defaultValue: 'Review Overdue' })}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          {/* Status Actions */}
          <div className="flex items-center gap-2">
            {article.status === 'draft' && (
              <>
                <Button
                  id="kb-editor-submit-review"
                  variant="outline"
                  size="sm"
                  onClick={() => handleStatusChange('review')}
                  disabled={isSaving}
                >
                  <Send className="w-4 h-4 mr-2" />
                  {t('editor.actions.submitForReview', { defaultValue: 'Submit for Review' })}
                </Button>
                <Button
                  id="kb-editor-publish"
                  size="sm"
                  onClick={() => handleStatusChange('published')}
                  disabled={isSaving}
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  {t('editor.actions.publish', { defaultValue: 'Publish' })}
                </Button>
              </>
            )}
            {article.status === 'review' && (
              <Button
                id="kb-editor-publish"
                size="sm"
                onClick={() => handleStatusChange('published')}
                disabled={isSaving}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                {t('editor.actions.publish', { defaultValue: 'Publish' })}
              </Button>
            )}
            {article.status === 'published' && (
              <Button
                id="kb-editor-archive"
                variant="outline"
                size="sm"
                onClick={() => handleStatusChange('archived')}
                disabled={isSaving}
              >
                <Archive className="w-4 h-4 mr-2" />
                {t('editor.actions.archive', { defaultValue: 'Archive' })}
              </Button>
            )}
          </div>
        </div>

        {/* Document Editor */}
        {isFallbackMode ? (
          <DocumentEditor
            documentId={article.document_id}
            userId={userId}
            initialContent={article.block_data ?? null}
          />
        ) : (
          <CollaborativeEditor
            documentId={article.document_id}
            tenantId={tenantId || article.tenant || ''}
            userId={userId}
            userName={userName || userId}
            searchMentions={searchUsersForMentions}
            aiAssistantEnabled={aiAssistantEnabled}
            initialContent={article.block_data ?? undefined}
            onConnectionStatusChange={(status) => {
              if (status === 'connected') collabConnectedRef.current = true;
              if (status === 'disconnected') setIsFallbackMode(true);
            }}
          />
        )}
      </div>

      {/* Metadata Sidebar */}
      <div className="w-full lg:w-80 space-y-4">
        {/* Article Stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('editor.stats.title', { defaultValue: 'Statistics' })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Eye className="w-4 h-4" />
                {t('editor.stats.views', { defaultValue: 'Views' })}
              </span>
              <span className="font-medium">{article.view_count}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <ThumbsUp className="w-4 h-4" />
                {t('editor.stats.helpful', { defaultValue: 'Helpful' })}
              </span>
              <span className="font-medium">{article.helpful_count}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <ThumbsDown className="w-4 h-4" />
                {t('editor.stats.notHelpful', { defaultValue: 'Not helpful' })}
              </span>
              <span className="font-medium">{article.not_helpful_count}</span>
            </div>
            {article.published_at && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  {t('editor.stats.published', { defaultValue: 'Published' })}
                </span>
                <span className="font-medium">{formatDate(article.published_at)}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Metadata Form */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('editor.metadata.title', { defaultValue: 'Metadata' })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Title */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {t('editor.metadata.fields.title', { defaultValue: 'Title' })}
              </label>
              <Input
                type="text"
                value={title}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setTitle(e.target.value);
                  handleMetadataChange();
                }}
              />
            </div>

            {/* Slug */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {t('editor.metadata.fields.slug', { defaultValue: 'URL Slug' })}
              </label>
              <Input
                type="text"
                value={slug}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setSlug(e.target.value);
                  handleMetadataChange();
                }}
              />
            </div>

            {/* Article Type */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {t('editor.metadata.fields.articleType', { defaultValue: 'Article Type' })}
              </label>
              <CustomSelect
                options={typeOptions}
                value={articleType}
                onValueChange={(value) => {
                  setArticleType(value as ArticleType);
                  handleMetadataChange();
                }}
              />
            </div>

            {/* Audience */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {t('editor.metadata.fields.audience', { defaultValue: 'Audience' })}
              </label>
              <CustomSelect
                options={audienceOptions}
                value={audience}
                onValueChange={(value) => {
                  setAudience(value as ArticleAudience);
                  handleMetadataChange();
                }}
              />
            </div>

            {/* Category */}
            {categories.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  {t('editor.metadata.fields.category', { defaultValue: 'Category' })}
                </label>
                <CustomSelect
                  options={categoryOptions}
                  value={categoryId}
                  onValueChange={(value) => {
                    setCategoryId(value);
                    handleMetadataChange();
                  }}
                />
              </div>
            )}

            {/* Review Cycle */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {t('editor.metadata.fields.reviewCycle', { defaultValue: 'Review Cycle' })}
              </label>
              <CustomSelect
                options={reviewCycleOptions}
                value={reviewCycleDays}
                onValueChange={(value) => {
                  setReviewCycleDays(value);
                  handleMetadataChange();
                }}
              />
              {article.next_review_due && (
                <p className={`text-xs mt-1 ${isStale ? 'text-orange-600' : 'text-muted-foreground'}`}>
                  {t('editor.metadata.fields.nextReview', { defaultValue: 'Next review' })}: {formatDate(article.next_review_due)}
                </p>
              )}
            </div>

            {/* Save Button */}
            <Button
              id="kb-editor-save"
              onClick={handleSaveMetadata}
              disabled={!hasUnsavedMetadata || isSaving}
              className="w-full"
            >
              <Save className="w-4 h-4 mr-2" />
              {isSaving
                ? t('editor.actions.saving', { defaultValue: 'Saving...' })
                : t('editor.actions.saveMetadata', { defaultValue: 'Save Metadata' })}
            </Button>
          </CardContent>
        </Card>

        {/* Tags */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Tags className="w-4 h-4" />
              {t('editor.tags.title', { defaultValue: 'Tags' })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TagManager
              id={`kb-article-tags-${article.article_id}`}
              entityId={article.article_id}
              entityType="knowledge_base_article"
              initialTags={articleTags}
              onTagsChange={setArticleTags}
              size="sm"
              useInlineInput
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
