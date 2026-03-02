'use client';

import React, { useState, useCallback } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { getCurrentUser } from '@alga-psa/auth/actions/action';
import {
  BookOpen,
  Clock,
  Plus,
} from 'lucide-react';
import KBArticleList from './KBArticleList';
import KBArticleFilters from './KBArticleFilters';
import KBArticleEditor from './KBArticleEditor';
import KBReviewDashboard from './KBReviewDashboard';
import {
  IKBArticleWithDocument,
  IArticleFilters,
  createArticle,
} from '../../actions/kbArticleActions';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';

type ViewMode = 'list' | 'editor' | 'review';

export default function KnowledgeBasePage() {
  const { t } = useTranslation('common');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeTab, setActiveTab] = useState<string>('articles');
  const [editingArticleId, setEditingArticleId] = useState<string | null>(null);
  const [filters, setFilters] = useState<IArticleFilters>({});
  const [listKey, setListKey] = useState(0);
  const [userId, setUserId] = useState<string>('');

  // Load user ID on mount
  React.useEffect(() => {
    const loadUser = async () => {
      try {
        const user = await getCurrentUser();
        if (user?.user_id) {
          setUserId(user.user_id);
        }
      } catch (error) {
        console.error('Failed to get user:', error);
      }
    };
    loadUser();
  }, []);

  const handleCreateNew = useCallback(async () => {
    try {
      // Create a new article and open editor
      const result = await createArticle({
        title: t('kb.newArticleTitle', 'New Article'),
        articleType: 'how_to',
        audience: 'internal',
      });

      if ('code' in result) {
        toast.error(t('kb.createError', 'Failed to create article'));
        return;
      }

      const article = result as IKBArticleWithDocument;
      setEditingArticleId(article.article_id);
      setViewMode('editor');
    } catch (error) {
      handleError(error, t('kb.createError', 'Failed to create article'));
    }
  }, [t]);

  const handleEdit = useCallback((article: IKBArticleWithDocument) => {
    setEditingArticleId(article.article_id);
    setViewMode('editor');
  }, []);

  const handleBack = useCallback(() => {
    setViewMode('list');
    setEditingArticleId(null);
    // Refresh the list
    setListKey((k) => k + 1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({});
  }, []);

  // Render based on view mode
  if (viewMode === 'editor' && editingArticleId && userId) {
    return (
      <div className="p-6 bg-gray-50 dark:bg-[rgb(var(--color-border-50))] min-h-screen">
        <KBArticleEditor
          articleId={editingArticleId}
          userId={userId}
          onBack={handleBack}
          onSave={handleBack}
        />
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 dark:bg-[rgb(var(--color-border-50))] min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BookOpen className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">
              {t('kb.pageTitle', 'Knowledge Base')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('kb.pageSubtitle', 'Create and manage knowledge base articles')}
            </p>
          </div>
        </div>
        <Button onClick={handleCreateNew}>
          <Plus className="w-4 h-4 mr-2" />
          {t('kb.newArticle', 'New Article')}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="articles">
            <BookOpen className="w-4 h-4 mr-2" />
            {t('kb.tabArticles', 'Articles')}
          </TabsTrigger>
          <TabsTrigger value="review">
            <Clock className="w-4 h-4 mr-2" />
            {t('kb.tabReview', 'Review Dashboard')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="articles" className="m-0">
          <div className="flex gap-6">
            {/* Filters Sidebar */}
            <div className="w-64 flex-shrink-0">
              <KBArticleFilters
                filters={filters}
                onFiltersChange={setFilters}
                onClearFilters={handleClearFilters}
              />
            </div>

            {/* Article List */}
            <div className="flex-1 min-w-0">
              <KBArticleList
                key={listKey}
                filters={filters}
                onEdit={handleEdit}
                onCreateNew={handleCreateNew}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="review" className="m-0">
          <KBReviewDashboard
            onEditArticle={handleEdit}
            onReviewArticle={handleEdit}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
