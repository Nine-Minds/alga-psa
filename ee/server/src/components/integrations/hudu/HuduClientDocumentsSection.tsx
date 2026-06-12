'use client';

/**
 * "Hudu Documentation" section in the client Documents tab (F228/F230):
 * collapsed-by-default, link-only list of the mapped company's Hudu articles
 * (name + updated_at + deep-link), reusing the Phase 1 cached per-company
 * articles action. Fetch/render errors stay inside the section; the native
 * documents UI above is never affected.
 */

import React, { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { BookOpen, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getHuduCompanyArticles } from '../../../lib/actions/integrations/huduDataActions';
import type { HuduCompanyDataResult } from '../../../lib/actions/integrations/huduDataActions';
import type { HuduArticle } from '../../../lib/integrations/hudu/contracts';

export interface HuduClientDocumentsSectionProps {
  clientId: string;
}

function formatUpdatedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

export function HuduClientDocumentsSection({ clientId }: HuduClientDocumentsSectionProps) {
  const { t } = useTranslation('msp/integrations');

  const [articles, setArticles] = useState<HuduCompanyDataResult<HuduArticle> | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setArticles(null);
    (async () => {
      try {
        const result = await getHuduCompanyArticles(clientId, { refresh: false });
        if (!cancelled) setArticles(result);
      } catch (error) {
        if (!cancelled) {
          setArticles({
            state: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // FR13: same gate as the client Hudu tab — a fetch-level unmap renders nothing.
  if (articles?.state === 'unmapped') return null;

  const failed = articles?.state === 'error' || articles?.state === 'no_password_access';

  return (
    <div id="hudu-client-docs" className="mt-6 border-t border-gray-200 pt-4">
      <button
        id="hudu-client-docs-toggle"
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-gray-900"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />
        )}
        <BookOpen className="h-4 w-4 shrink-0 text-gray-500" />
        <span id="hudu-client-docs-title">
          {t('integrations.hudu.documents.sectionTitle', { defaultValue: 'Hudu Documentation' })}
        </span>
        {articles?.state === 'ok' && (
          <span id="hudu-client-docs-count" className="font-normal text-gray-500">
            ({articles.count})
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 pl-6">
          {articles === null && (
            <p id="hudu-client-docs-loading" className="text-sm text-gray-500">
              {t('integrations.hudu.documents.loading', { defaultValue: 'Loading Hudu articles...' })}
            </p>
          )}

          {failed && (
            <Alert id="hudu-client-docs-error" variant="destructive">
              <AlertDescription>
                {t('integrations.hudu.documents.unreachable', {
                  defaultValue: 'Hudu could not be reached. Try again later.',
                })}
              </AlertDescription>
            </Alert>
          )}

          {articles?.state === 'ok' && articles.count === 0 && (
            <p id="hudu-client-docs-empty" className="text-sm text-gray-500">
              {t('integrations.hudu.documents.empty', { defaultValue: 'No Hudu articles' })}
            </p>
          )}

          {articles?.state === 'ok' && articles.count > 0 && (
            <ul className="divide-y divide-gray-100">
              {articles.items.map((item) => {
                const updated = formatUpdatedAt(item.updated_at);
                return (
                  <li key={item.id} className="flex flex-col gap-0.5 py-2">
                    {item.hudu_url ? (
                      <a
                        id={`hudu-client-doc-${item.id}`}
                        href={item.hudu_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-[rgb(var(--color-primary-600))] hover:underline"
                      >
                        {item.name}
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      </a>
                    ) : (
                      <span id={`hudu-client-doc-${item.id}`} className="font-medium text-gray-900">
                        {item.name}
                      </span>
                    )}
                    {updated && (
                      <span
                        id={`hudu-client-doc-${item.id}-updated`}
                        className="text-xs text-gray-500"
                      >
                        {updated}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default HuduClientDocumentsSection;
