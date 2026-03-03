'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { X, Search, Tags } from 'lucide-react';
import { IArticleFilters, ArticleStatus, ArticleAudience, ArticleType } from '../../actions/kbArticleActions';
import { findAllTagsByType } from '@alga-psa/tags';
import type { ITag } from '@alga-psa/types';

const STATUS_OPTIONS: SelectOption[] = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'review', label: 'In Review' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

const AUDIENCE_OPTIONS: SelectOption[] = [
  { value: '', label: 'All Audiences' },
  { value: 'internal', label: 'Internal' },
  { value: 'client', label: 'Client' },
  { value: 'public', label: 'Public' },
];

const TYPE_OPTIONS: SelectOption[] = [
  { value: '', label: 'All Types' },
  { value: 'how_to', label: 'How-To' },
  { value: 'faq', label: 'FAQ' },
  { value: 'troubleshooting', label: 'Troubleshooting' },
  { value: 'reference', label: 'Reference' },
];

interface KBArticleFiltersProps {
  filters: IArticleFilters;
  onFiltersChange: (filters: IArticleFilters) => void;
  onClearFilters?: () => void;
  categories?: Array<{ id: string; name: string }>;
}

export default function KBArticleFilters({
  filters,
  onFiltersChange,
  onClearFilters,
  categories = [],
}: KBArticleFiltersProps) {
  const { t } = useTranslation('common');
  const [availableTags, setAvailableTags] = useState<ITag[]>([]);

  // Load available tags for knowledge_base_article
  useEffect(() => {
    const loadTags = async () => {
      try {
        const tags = await findAllTagsByType('knowledge_base_article');
        // Get unique tags by tag_text
        const uniqueTags = tags.reduce((acc: ITag[], tag) => {
          if (!acc.some(t => t.tag_text === tag.tag_text)) {
            acc.push(tag);
          }
          return acc;
        }, []);
        setAvailableTags(uniqueTags);
      } catch (error) {
        console.error('Failed to load tags:', error);
      }
    };
    loadTags();
  }, []);

  const categoryOptions: SelectOption[] = [
    { value: '', label: t('kb.allCategories', 'All Categories') },
    ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
  ];

  const tagOptions: SelectOption[] = [
    { value: '', label: t('kb.allTags', 'All Tags') },
    ...availableTags.map((tag) => ({ value: tag.tag_id, label: tag.tag_text })),
  ];

  const hasFilters =
    filters.search ||
    filters.status ||
    filters.audience ||
    filters.articleType ||
    filters.categoryId ||
    (filters.tagIds && filters.tagIds.length > 0);

  return (
    <Card className="sticky top-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{t('kb.filters', 'Filters')}</CardTitle>
          {hasFilters && onClearFilters && (
            <Button
              id="kb-filters-clear"
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="h-7 px-2 text-xs"
            >
              <X className="w-3 h-3 mr-1" />
              {t('kb.clearFilters', 'Clear')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('kb.search', 'Search')}
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('kb.searchPlaceholder', 'Search articles...')}
              value={filters.search || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, search: e.target.value || undefined })
              }
              className="pl-8"
            />
          </div>
        </div>

        {/* Status */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('kb.status', 'Status')}
          </label>
          <CustomSelect
            options={STATUS_OPTIONS}
            value={filters.status || ''}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, status: (value as ArticleStatus) || undefined })
            }
            placeholder={t('kb.selectStatus', 'Select status...')}
          />
        </div>

        {/* Audience */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('kb.audience', 'Audience')}
          </label>
          <CustomSelect
            options={AUDIENCE_OPTIONS}
            value={filters.audience || ''}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, audience: (value as ArticleAudience) || undefined })
            }
            placeholder={t('kb.selectAudience', 'Select audience...')}
          />
        </div>

        {/* Article Type */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('kb.articleType', 'Article Type')}
          </label>
          <CustomSelect
            options={TYPE_OPTIONS}
            value={filters.articleType || ''}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, articleType: (value as ArticleType) || undefined })
            }
            placeholder={t('kb.selectType', 'Select type...')}
          />
        </div>

        {/* Category */}
        {categories.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t('kb.category', 'Category')}
            </label>
            <CustomSelect
              options={categoryOptions}
              value={filters.categoryId || ''}
              onValueChange={(value) =>
                onFiltersChange({ ...filters, categoryId: value || undefined })
              }
              placeholder={t('kb.selectCategory', 'Select category...')}
            />
          </div>
        )}

        {/* Tags */}
        {availableTags.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block flex items-center gap-1.5">
              <Tags className="w-3 h-3" />
              {t('kb.tags', 'Tags')}
            </label>
            <CustomSelect
              options={tagOptions}
              value={filters.tagIds?.[0] || ''}
              onValueChange={(value) =>
                onFiltersChange({ ...filters, tagIds: value ? [value] : undefined })
              }
              placeholder={t('kb.selectTag', 'Select tag...')}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
