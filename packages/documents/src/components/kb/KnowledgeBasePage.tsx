'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Tabs, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import {
  BookOpen,
  Clock,
  Plus,
  Download,
} from 'lucide-react';
import KBArticleList from './KBArticleList';
import KBArticleFilters from './KBArticleFilters';
import KBArticleEditor from './KBArticleEditor';
import KBReviewDashboard from './KBReviewDashboard';
import KBImportDialog from './KBImportDialog';
import {
  IKBArticleWithDocument,
  IArticleFilters,
  createArticle,
  getArticlesWithTags,
} from '../../actions/kbArticleActions';
import type { ITag } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';

type TabValue = 'articles' | 'review';

const KB_BASE_PATH = '/msp/knowledge-base';

interface KnowledgeBasePageProps {
  activeTab?: TabValue;
  aiAssistantEnabled?: boolean;
}

export default function KnowledgeBasePage({ activeTab = 'articles', aiAssistantEnabled = false }: KnowledgeBasePageProps) {
  const { t } = useTranslation('msp/knowledge-base');
  const tRef = useRef(t);
  tRef.current = t;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const editingArticleId = searchParams?.get('article') ?? null;

  const [filters, setFilters] = useState<IArticleFilters>({});
  const [listKey, setListKey] = useState(0);
  const [userId, setUserId] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const [tenantId, setTenantId] = useState<string>('');
  const [userLoadError, setUserLoadError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // Article list data state
  const [articles, setArticles] = useState<IKBArticleWithDocument[]>([]);
  const [articleTags, setArticleTags] = useState<Record<string, ITag[]>>({});
  const [availableTags, setAvailableTags] = useState<ITag[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isLoadingArticles, setIsLoadingArticles] = useState(true);

  const updateUrl = useCallback((params: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams?.toString() ?? '');
    for (const [key, value] of Object.entries(params)) {
      if (value === null) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    }
    const qs = newParams.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [router, pathname, searchParams]);

  // Fetch articles when filters, page, pageSize, or listKey change
  const fetchArticles = useCallback(async () => {
    setIsLoadingArticles(true);
    try {
      const result = await getArticlesWithTags(currentPage, pageSize, filters);
      if (typeof result === 'object' && 'code' in result) {
        toast.error(tRef.current('page.feedback.loadError', { defaultValue: 'Failed to load articles' }));
        return;
      }
      const data = result as {
        articles: IKBArticleWithDocument[];
        total: number;
        totalPages: number;
        articleTags: Record<string, ITag[]>;
        availableTags: ITag[];
      };
      setArticles(data.articles);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setArticleTags(data.articleTags);
      setAvailableTags(data.availableTags);
    } catch (error) {
      handleError(error, tRef.current('page.feedback.loadError', { defaultValue: 'Failed to load articles' }));
    } finally {
      setIsLoadingArticles(false);
    }
  }, [currentPage, pageSize, filters]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles, listKey]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  }, []);

  const handleRefresh = useCallback(() => {
    setListKey((k) => k + 1);
  }, []);

  // Load user on mount
  React.useEffect(() => {
    const loadUser = async () => {
      try {
        const user = await getCurrentUser();
        if (user?.user_id) {
          setUserId(user.user_id);
          const nameParts = [user.first_name, user.last_name].filter(Boolean);
          setUserName(nameParts.join(' ').trim() || user.email || 'User');
          setTenantId(user.tenant ?? '');
        } else {
          setUserLoadError(t('page.feedback.userLoadError', { defaultValue: 'Failed to load user. Article editing is unavailable.' }));
        }
      } catch (error) {
        console.error('Failed to get user:', error);
        setUserLoadError(t('page.feedback.userLoadError', { defaultValue: 'Failed to load user. Article editing is unavailable.' }));
      }
    };
    loadUser();
  }, [t]);

  const handleTabChange = useCallback((tab: string) => {
    if (tab === 'review') {
      router.push(`${KB_BASE_PATH}/review`);
    } else {
      router.push(KB_BASE_PATH);
    }
  }, [router]);

  const handleCreateNew = useCallback(async () => {
    try {
      const result = await createArticle({
        title: t('page.newArticleTitle', { defaultValue: 'New Article' }),
        articleType: 'how_to',
        audience: 'internal',
      });

      if ('code' in result) {
        toast.error(t('page.feedback.createError', { defaultValue: 'Failed to create article' }));
        return;
      }

      const article = result as IKBArticleWithDocument;
      updateUrl({ article: article.article_id });
    } catch (error) {
      handleError(error, t('page.feedback.createError', { defaultValue: 'Failed to create article' }));
    }
  }, [t, updateUrl]);

  const handleEdit = useCallback((article: IKBArticleWithDocument) => {
    router.push(`${KB_BASE_PATH}?article=${article.article_id}`);
  }, [router]);

  const handleBack = useCallback(() => {
    router.push(KB_BASE_PATH);
    setListKey((k) => k + 1);
  }, [router]);

  const handleClearFilters = useCallback(() => {
    setFilters({});
  }, []);

  // Render editor if article is selected
  if (editingArticleId && userId) {
    return (
      <div className="p-6">
        <KBArticleEditor
          articleId={editingArticleId}
          userId={userId}
          userName={userName}
          tenantId={tenantId}
          aiAssistantEnabled={aiAssistantEnabled}
          onBack={handleBack}
          onSave={handleBack}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BookOpen className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">
              {t('page.title', { defaultValue: 'Knowledge Base' })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('page.subtitle', { defaultValue: 'Create and manage knowledge base articles' })}
            </p>
          </div>
        </div>
        {activeTab === 'articles' && (
          <div className="flex items-center gap-2">
            <Button
              id="kb-import-articles"
              variant="outline"
              onClick={() => setImportDialogOpen(true)}
              disabled={!userId}
            >
              <Download className="w-4 h-4 mr-2" />
              {t('page.actions.import', { defaultValue: 'Import' })}
            </Button>
            <Button id="kb-new-article" onClick={handleCreateNew} disabled={!userId}>
              <Plus className="w-4 h-4 mr-2" />
              {t('page.actions.newArticle', { defaultValue: 'New Article' })}
            </Button>
          </div>
        )}
      </div>

      {userLoadError && (
        <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {userLoadError}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="articles">
            <BookOpen className="w-4 h-4 mr-2" />
            {t('page.tabs.articles', { defaultValue: 'Articles' })}
          </TabsTrigger>
          <TabsTrigger value="review">
            <Clock className="w-4 h-4 mr-2" />
            {t('page.tabs.reviewDashboard', { defaultValue: 'Review Dashboard' })}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === 'articles' && (
        <div className="flex gap-6">
          {/* Filters Sidebar */}
          <div className="w-64 flex-shrink-0">
            <KBArticleFilters
              filters={filters}
              onFiltersChange={(f) => { setFilters(f); setCurrentPage(1); }}
              onClearFilters={handleClearFilters}
              availableTags={availableTags}
            />
          </div>

          {/* Article List */}
          <div className="flex-1 min-w-0">
            <KBArticleList
              key={listKey}
              articles={articles}
              total={total}
              totalPages={totalPages}
              articleTags={articleTags}
              currentPage={currentPage}
              pageSize={pageSize}
              isLoading={isLoadingArticles}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              onRefresh={handleRefresh}
              onEdit={handleEdit}
              onCreateNew={handleCreateNew}
            />
          </div>
        </div>
      )}

      {activeTab === 'review' && (
        <KBReviewDashboard
          onEditArticle={handleEdit}
          onReviewArticle={handleEdit}
        />
      )}

      <KBImportDialog
        isOpen={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImportComplete={() => setListKey((k) => k + 1)}
      />
    </div>
  );
}
