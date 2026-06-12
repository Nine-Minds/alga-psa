'use client';

/**
 * Documents page "Hudu" tab (F233, FR15): cross-company article list mirroring
 * Hudu's fixed 25-item pages — server-side search passthrough (debounced, the
 * documents-filters idiom), prev/next paging, resolved Alga client names with
 * an "Unmapped" badge fallback, and per-article deep-links. Pull-only: nothing
 * here writes to Hudu or persists article content in Alga.
 */

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listHuduArticlesAcrossCompanies } from '../../../lib/actions/integrations/huduGlobalDocsActions';
import type { HuduGlobalArticlesResult } from '../../../lib/actions/integrations/huduGlobalDocsActions';

const SEARCH_DEBOUNCE_MS = 300;

export function HuduDocumentsTab() {
  const { t } = useTranslation('msp/integrations');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<HuduGlobalArticlesResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const next = await listHuduArticlesAcrossCompanies({
          page,
          ...(search ? { search } : {}),
        });
        if (!cancelled) setResult(next);
      } catch (error) {
        if (!cancelled) {
          setResult({
            state: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, search]);

  const hasMore = result?.state === 'ok' && result.hasMore;

  return (
    <div id="hudu-docs-tab" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div id="hudu-docs-attribution" className="flex items-center gap-2 text-sm text-gray-500">
          <BookOpen className="h-4 w-4 shrink-0" />
          <span>{t('integrations.hudu.documentsTab.source', { defaultValue: 'Source: Hudu' })}</span>
        </div>
        <div className="w-72">
          <Input
            id="hudu-docs-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('integrations.hudu.documentsTab.searchPlaceholder', {
              defaultValue: 'Search Hudu articles...',
            })}
          />
        </div>
      </div>

      {isLoading && (
        <p id="hudu-docs-loading" className="text-sm text-gray-500">
          {t('integrations.hudu.documentsTab.loading', { defaultValue: 'Loading Hudu articles...' })}
        </p>
      )}

      {!isLoading && result?.state === 'disconnected' && (
        <Alert id="hudu-docs-disconnected">
          <AlertDescription>
            {t('integrations.hudu.documentsTab.notConnected', {
              defaultValue:
                'Hudu is not connected. An administrator can connect it under Settings → Integrations.',
            })}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && result?.state === 'error' && (
        <Alert id="hudu-docs-error" variant="destructive">
          <AlertDescription>
            {t('integrations.hudu.documentsTab.unreachable', {
              defaultValue: 'Hudu could not be reached. Try again later.',
            })}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && result?.state === 'ok' && (
        <Card id="hudu-docs-list">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 shrink-0" />
              {t('integrations.hudu.documentsTab.title', { defaultValue: 'Hudu articles' })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.articles.length === 0 ? (
              <p id="hudu-docs-empty" className="text-sm text-gray-500">
                {t('integrations.hudu.documentsTab.empty', {
                  defaultValue: 'No Hudu articles found.',
                })}
              </p>
            ) : (
              <table id="hudu-docs-table" className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-gray-500">
                    <th className="py-2 pr-4 font-medium">
                      {t('integrations.hudu.documentsTab.articleColumn', { defaultValue: 'Article' })}
                    </th>
                    <th className="py-2 pr-4 font-medium">
                      {t('integrations.hudu.documentsTab.clientColumn', { defaultValue: 'Client' })}
                    </th>
                    <th className="py-2 pr-4 font-medium">
                      {t('integrations.hudu.documentsTab.companyColumn', {
                        defaultValue: 'Hudu company',
                      })}
                    </th>
                    <th className="py-2 font-medium">
                      {t('integrations.hudu.documentsTab.updatedColumn', { defaultValue: 'Updated' })}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.articles.map((article) => (
                    <tr key={article.id} id={`hudu-docs-row-${article.id}`}>
                      <td className="py-2 pr-4">
                        {article.url ? (
                          <a
                            id={`hudu-docs-link-${article.id}`}
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-[rgb(var(--color-primary-600))] hover:underline"
                          >
                            {article.name}
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          </a>
                        ) : (
                          <span
                            id={`hudu-docs-link-${article.id}`}
                            className="font-medium text-gray-900"
                          >
                            {article.name}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {article.client_name ? (
                          <span id={`hudu-docs-client-${article.id}`}>{article.client_name}</span>
                        ) : (
                          <Badge id={`hudu-docs-unmapped-${article.id}`} variant="secondary">
                            {t('integrations.hudu.documentsTab.unmapped', {
                              defaultValue: 'Unmapped',
                            })}
                          </Badge>
                        )}
                      </td>
                      <td id={`hudu-docs-company-${article.id}`} className="py-2 pr-4 text-gray-500">
                        {article.company_name ?? '—'}
                      </td>
                      <td id={`hudu-docs-updated-${article.id}`} className="py-2 text-gray-500">
                        {article.updated_at
                          ? new Date(article.updated_at).toLocaleDateString()
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          id="hudu-docs-prev"
          variant="outline"
          size="sm"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={isLoading || page <= 1}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {t('integrations.hudu.documentsTab.previous', { defaultValue: 'Previous' })}
        </Button>
        <span id="hudu-docs-page" className="text-sm text-gray-500">
          {t('integrations.hudu.documentsTab.pageLabel', { defaultValue: 'Page' })} {page}
        </span>
        <Button
          id="hudu-docs-next"
          variant="outline"
          size="sm"
          onClick={() => setPage((current) => current + 1)}
          disabled={isLoading || !hasMore}
        >
          {t('integrations.hudu.documentsTab.next', { defaultValue: 'Next' })}
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default HuduDocumentsTab;
