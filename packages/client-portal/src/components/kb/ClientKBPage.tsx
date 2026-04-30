'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatArticleType } from '@alga-psa/ui/hooks/useKnowledgeBaseEnumOptions';
import { Button } from '@alga-psa/ui/components/Button';
import { CollapseToggleButton } from '@alga-psa/ui/components/CollapseToggleButton';
import { Input } from '@alga-psa/ui/components/Input';
import Spinner from '@alga-psa/ui/components/Spinner';
import { TagFilter } from '@alga-psa/ui/components';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  Search,
  ChevronRight,
  ChevronDown,
  BookOpen,
  HelpCircle,
  Wrench,
  FileText,
  Folder,
  FolderOpen,
  Eye,
  ThumbsUp,
} from 'lucide-react';
import {
  getClientKBArticles,
  getClientKBCategories,
  getClientKBTags,
  ClientKBFilters,
  PaginatedClientKBArticles,
  ClientKBCategory,
} from '../../actions/client-portal-actions/client-kb';
import type { IKBArticleWithDocument, ArticleType } from '@alga-psa/types';
import type { ITag } from '@alga-psa/types';

const TYPE_ICONS: Record<ArticleType, React.ReactNode> = {
  how_to: <BookOpen className="w-5 h-5 text-blue-500" />,
  faq: <HelpCircle className="w-5 h-5 text-purple-500" />,
  troubleshooting: <Wrench className="w-5 h-5 text-orange-500" />,
  reference: <FileText className="w-5 h-5 text-gray-500" />,
};


interface CategoryTreeNodeProps {
  category: ClientKBCategory;
  allCategories: ClientKBCategory[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  level?: number;
}

function CategoryTreeNode({
  category,
  allCategories,
  selectedId,
  onSelect,
  level = 0,
}: CategoryTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const children = allCategories.filter((c) => c.parent_id === category.id);
  const hasChildren = children.length > 0;
  const isSelected = selectedId === category.id;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer rounded transition-colors ${
          isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onSelect(category.id)}
      >
        {hasChildren && (
          <button
            id={`kb-category-toggle-${category.id}`}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="p-0.5 hover:bg-muted rounded"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        )}
        {!hasChildren && <span className="w-4" />}
        {isExpanded && hasChildren ? (
          <FolderOpen className="w-4 h-4 text-amber-500" />
        ) : hasChildren ? (
          <Folder className="w-4 h-4 text-amber-500" />
        ) : (
          <FileText className="w-4 h-4 text-gray-400" />
        )}
        <span className="text-sm truncate">{category.name}</span>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {children.map((child) => (
            <CategoryTreeNode
              key={child.id}
              category={child}
              allCategories={allCategories}
              selectedId={selectedId}
              onSelect={onSelect}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ArticleCardProps {
  article: IKBArticleWithDocument;
  onClick: () => void;
}

function ArticleCard({ article, onClick }: ArticleCardProps) {
  const formatArticleType = useFormatArticleType('features/documents');
  return (
    <Card
      className="hover:shadow-md transition-shadow cursor-pointer"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 p-2 bg-muted rounded-lg">
            {TYPE_ICONS[article.article_type] || <FileText className="w-5 h-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium line-clamp-2">
              {article.document_name || article.slug}
            </h4>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="text-xs">
                {formatArticleType(article.article_type)}
              </Badge>
              <span className="flex items-center gap-1">
                <Eye className="w-3 h-3" />
                {article.view_count}
              </span>
              <span className="flex items-center gap-1">
                <ThumbsUp className="w-3 h-3" />
                {article.helpful_count}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ClientKBPageProps {
  onArticleClick?: (article: IKBArticleWithDocument) => void;
}

export default function ClientKBPage({ onArticleClick }: ClientKBPageProps) {
  const { t } = useTranslation('features/documents');
  const formatArticleType = useFormatArticleType('features/documents');

  const [articles, setArticles] = useState<IKBArticleWithDocument[]>([]);
  const [categories, setCategories] = useState<ClientKBCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [isCategorySidebarCollapsed, setIsCategorySidebarCollapsed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availableTags, setAvailableTags] = useState<ITag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const pageSize = 20;

  const loadArticles = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const filters: ClientKBFilters = {};
      if (searchTerm) {
        filters.search = searchTerm;
      }
      if (selectedCategory) {
        filters.categoryId = selectedCategory;
      }
      if (selectedTags.length > 0) {
        filters.tags = selectedTags;
      }

      const result = await getClientKBArticles(page, pageSize, filters);
      setArticles(result.articles);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    } catch (error) {
      console.error('Failed to load articles:', error);
      setLoadError(t('kb.loadError', 'Failed to load articles. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, searchTerm, selectedCategory, selectedTags, t]);

  const loadCategories = useCallback(async () => {
    try {
      const result = await getClientKBCategories();
      setCategories(result);
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  }, []);

  const loadTags = useCallback(async () => {
    try {
      const result = await getClientKBTags();
      setAvailableTags(result as ITag[]);
    } catch (error) {
      console.error('Failed to load tags:', error);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
    void loadTags();
  }, [loadCategories, loadTags]);

  useEffect(() => {
    void loadArticles();
  }, [loadArticles]);

  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
    setPage(1);
  }, []);

  const handleCategorySelect = useCallback(
    (id: string | null) => {
      setSelectedCategory(id === selectedCategory ? null : id);
      setPage(1);
    },
    [selectedCategory]
  );

  const handleArticleClick = useCallback(
    (article: IKBArticleWithDocument) => {
      if (onArticleClick) {
        onArticleClick(article);
      }
    },
    [onArticleClick]
  );

  // Build root categories (no parent)
  const rootCategories = categories.filter((c) => !c.parent_id);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Category Sidebar */}
        {categories.length > 0 && (
          <div
            className={`flex-shrink-0 transition-all ${
              isCategorySidebarCollapsed ? 'w-10' : 'w-64'
            }`}
          >
            <Card className="h-full">
              <CardContent className="p-2 h-full overflow-auto">
                {isCategorySidebarCollapsed ? (
                  <CollapseToggleButton
                    id="kb-expand-categories"
                    isCollapsed={true}
                    collapsedLabel="Show categories"
                    expandedLabel="Collapse categories"
                    expandDirection="right"
                    onClick={() => setIsCategorySidebarCollapsed(false)}
                    className="mx-auto"
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between px-2 py-1 mb-2">
                      <span className="text-sm font-medium">
                        {t('kb.categories', 'Categories')}
                      </span>
                      <CollapseToggleButton
                        id="kb-collapse-categories"
                        isCollapsed={false}
                        collapsedLabel="Show categories"
                        expandedLabel="Collapse categories"
                        expandDirection="right"
                        onClick={() => setIsCategorySidebarCollapsed(true)}
                      />
                    </div>
                    <div
                      className={`py-1.5 px-2 cursor-pointer rounded transition-colors ${
                        selectedCategory === null
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-muted'
                      }`}
                      onClick={() => handleCategorySelect(null)}
                    >
                      <span className="text-sm">
                        {t('kb.allArticles', 'All Articles')}
                      </span>
                    </div>
                    {rootCategories.map((category) => (
                      <CategoryTreeNode
                        key={category.id}
                        category={category}
                        allCategories={categories}
                        selectedId={selectedCategory}
                        onSelect={handleCategorySelect}
                      />
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Search and Filters */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('kb.searchPlaceholder', 'Search articles...')}
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {availableTags.length > 0 && (
              <TagFilter
                tags={availableTags}
                selectedTags={selectedTags}
                onToggleTag={(tag: string) => {
                  setSelectedTags((prev) =>
                    prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                  );
                  setPage(1);
                }}
                onClearTags={() => {
                  setSelectedTags([]);
                  setPage(1);
                }}
                placeholder={t('kb.filterByTags', 'Filter by tags...')}
              />
            )}
            <span className="text-sm text-muted-foreground">
              {t('kb.articleCount', '{{count}} articles', { count: total })}
            </span>
          </div>

          {/* Error State */}
          {loadError && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              {loadError}
            </div>
          )}

          {/* Article Grid */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <Spinner size="sm" />
              </div>
            ) : articles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <BookOpen className="w-12 h-12 mb-2 opacity-50" />
                <p>{t('kb.noArticles', 'No articles found')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {articles.map((article) => (
                  <ArticleCard
                    key={article.article_id}
                    article={article}
                    onClick={() => handleArticleClick(article)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t">
              <Button
                id="kb-previous-page"
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                {t('common:pagination.previous', 'Previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('common:pagination.pageOf', 'Page {{current}} of {{total}}', {
                  current: page,
                  total: totalPages,
                })}
              </span>
              <Button
                id="kb-next-page"
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                {t('common:pagination.next', 'Next')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
