'use client';

/**
 * "Pick from Hudu" for the ticket template editor's Documentation links. Opens a searchable list of
 * the tenant's Hudu articles (the same one-page-at-a-time listing as the Documents "Hudu" tab) and
 * hands the chosen article's id, absolute URL and name back to the editor, which stores them as a
 * plain snapshot. Nothing is written to Hudu and Hudu is never called when a ticket is created.
 */

import React, { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listHuduArticlesAcrossCompanies } from '../../../lib/actions/integrations/huduGlobalDocsActions';
import type { HuduGlobalArticlesResult } from '../../../lib/actions/integrations/huduGlobalDocsActions';

const SEARCH_DEBOUNCE_MS = 300;

export interface HuduPickedArticle {
  external_id: string;
  url: string;
  title: string;
}

export interface HuduArticlePickerProps {
  id: string;
  disabled?: boolean;
  onPick: (article: HuduPickedArticle) => void;
}

export function HuduArticlePicker({ id, disabled = false, onPick }: HuduArticlePickerProps) {
  const { t } = useTranslation('features/tickets');
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<HuduGlobalArticlesResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const next = await listHuduArticlesAcrossCompanies({ page, ...(search ? { search } : {}) });
        if (!cancelled) setResult(next);
      } catch (error) {
        if (!cancelled) {
          setResult({ state: 'error', error: error instanceof Error ? error.message : String(error) });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, page, search]);

  return (
    <>
      <Button id={`${id}-open`} type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <BookOpen className="mr-1 h-4 w-4" />
        {t('templates.links.pickFromHudu', 'Pick from Hudu')}
      </Button>
      <Dialog
        id={`${id}-dialog`}
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t('templates.links.huduPickerTitle', 'Pick a Hudu article')}
        className="max-w-2xl"
      >
        <DialogContent>
          <div className="space-y-3">
            <Input
              id={`${id}-search`}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('templates.links.huduSearch', 'Search Hudu articles...')}
            />
            {loading && <p className="text-sm text-[rgb(var(--color-text-500))]">{t('templates.links.huduLoading', 'Loading Hudu articles...')}</p>}
            {!loading && result?.state === 'disconnected' && (
              <Alert id={`${id}-disconnected`}>
                <AlertDescription>
                  {t('templates.links.huduDisconnected', 'Hudu is not connected. You can still add a link by entering its details.')}
                </AlertDescription>
              </Alert>
            )}
            {!loading && result?.state === 'error' && (
              <Alert id={`${id}-error`} variant="destructive">
                <AlertDescription>{t('templates.links.huduError', 'Hudu could not be reached. Try again later.')}</AlertDescription>
              </Alert>
            )}
            {!loading && result?.state === 'ok' && (
              result.articles.length === 0 ? (
                <p className="text-sm text-[rgb(var(--color-text-500))]">{t('templates.links.huduEmpty', 'No Hudu articles found.')}</p>
              ) : (
                <ul className="divide-y">
                  {result.articles.map((article) => (
                    <li key={article.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{article.name}</p>
                        {(article.company_name || article.client_name) && (
                          <p className="truncate text-xs text-[rgb(var(--color-text-500))]">
                            {article.client_name ?? article.company_name}
                          </p>
                        )}
                      </div>
                      <Button
                        id={`${id}-pick-${article.id}`}
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!article.url}
                        onClick={() => {
                          if (!article.url) return;
                          onPick({ external_id: String(article.id), url: article.url, title: article.name });
                          setOpen(false);
                        }}
                      >
                        {t('templates.links.huduSelect', 'Select')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            )}
            {result?.state === 'ok' && (page > 1 || result.hasMore) && (
              <div className="flex justify-end gap-2">
                <Button id={`${id}-prev`} type="button" size="sm" variant="ghost" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                  {t('templates.links.huduPrev', 'Previous')}
                </Button>
                <Button id={`${id}-next`} type="button" size="sm" variant="ghost" disabled={!result.hasMore || loading} onClick={() => setPage((p) => p + 1)}>
                  {t('templates.links.huduNext', 'Next')}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default HuduArticlePicker;
