'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { TagFilter } from '@alga-psa/ui/components';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  useArticleAudienceOptions,
  useArticleStatusOptions,
  useArticleTypeOptions,
} from '@alga-psa/ui/hooks/useKnowledgeBaseEnumOptions';
import { X, Search } from 'lucide-react';
import { IArticleFilters, ArticleStatus, ArticleAudience, ArticleType } from '../../actions/kbArticleActions';
import type { ITag } from '@alga-psa/types';

interface KBArticleFiltersProps {
  filters: IArticleFilters;
  onFiltersChange: (filters: IArticleFilters) => void;
  onClearFilters?: () => void;
  categories?: Array<{ id: string; name: string }>;
  availableTags?: ITag[];
}

export default function KBArticleFilters({
  filters,
  onFiltersChange,
  onClearFilters,
  categories = [],
  availableTags = [],
}: KBArticleFiltersProps) {
  const { t } = useTranslation('msp/knowledge-base');

  const statusOptions: SelectOption[] = [
    { value: '', label: t('filters.options.status.all', { defaultValue: 'All Statuses' }) },
    ...useArticleStatusOptions(),
  ];

  const audienceOptions: SelectOption[] = [
    { value: '', label: t('filters.options.audience.all', { defaultValue: 'All Audiences' }) },
    ...useArticleAudienceOptions(),
  ];

  const typeOptions: SelectOption[] = [
    { value: '', label: t('filters.options.articleType.all', { defaultValue: 'All Types' }) },
    ...useArticleTypeOptions(),
  ];

  const categoryOptions: SelectOption[] = [
    { value: '', label: t('filters.options.category.all', { defaultValue: 'All Categories' }) },
    ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
  ];

  const hasFilters =
    filters.search ||
    filters.status ||
    filters.audience ||
    filters.articleType ||
    filters.categoryId ||
    (filters.tags && filters.tags.length > 0);

  return (
    <Card className="sticky top-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{t('filters.title', { defaultValue: 'Filters' })}</CardTitle>
          {hasFilters && onClearFilters && (
            <Button
              id="kb-filters-clear"
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="h-7 px-2 text-xs"
            >
              <X className="w-3 h-3 mr-1" />
              {t('filters.actions.clear', { defaultValue: 'Clear' })}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('filters.labels.search', { defaultValue: 'Search' })}
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('filters.placeholders.search', { defaultValue: 'Search articles...' })}
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
            {t('filters.labels.status', { defaultValue: 'Status' })}
          </label>
          <CustomSelect
            options={statusOptions}
            value={filters.status || ''}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, status: (value as ArticleStatus) || undefined })
            }
            placeholder={t('filters.placeholders.status', { defaultValue: 'Select status...' })}
          />
        </div>

        {/* Audience */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('filters.labels.audience', { defaultValue: 'Audience' })}
          </label>
          <CustomSelect
            options={audienceOptions}
            value={filters.audience || ''}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, audience: (value as ArticleAudience) || undefined })
            }
            placeholder={t('filters.placeholders.audience', { defaultValue: 'Select audience...' })}
          />
        </div>

        {/* Article Type */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('filters.labels.articleType', { defaultValue: 'Article Type' })}
          </label>
          <CustomSelect
            options={typeOptions}
            value={filters.articleType || ''}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, articleType: (value as ArticleType) || undefined })
            }
            placeholder={t('filters.placeholders.articleType', { defaultValue: 'Select type...' })}
          />
        </div>

        {/* Category */}
        {categories.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t('filters.labels.category', { defaultValue: 'Category' })}
            </label>
            <CustomSelect
              options={categoryOptions}
              value={filters.categoryId || ''}
              onValueChange={(value) =>
                onFiltersChange({ ...filters, categoryId: value || undefined })
              }
              placeholder={t('filters.placeholders.category', { defaultValue: 'Select category...' })}
            />
          </div>
        )}

        {/* Tags */}
        {availableTags.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t('filters.labels.tags', { defaultValue: 'Tags' })}
            </label>
            <TagFilter
              tags={availableTags}
              selectedTags={filters.tags || []}
              onToggleTag={(tag: string) => {
                const current = filters.tags || [];
                const updated = current.includes(tag)
                  ? current.filter((t) => t !== tag)
                  : [...current, tag];
                onFiltersChange({ ...filters, tags: updated.length > 0 ? updated : undefined });
              }}
              onClearTags={() => onFiltersChange({ ...filters, tags: undefined })}
              placeholder={t('filters.placeholders.tags', { defaultValue: 'Filter by tags...' })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
