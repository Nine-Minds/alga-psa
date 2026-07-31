'use client';

/**
 * Client detail "Hudu" tab (F070–F075): Articles list for the client's mapped
 * Hudu company, with counts, per-record deep-links, a Refresh button, source
 * attribution, and distinct empty/error states for not-connected / unmapped /
 * unreachable. Phase 2 (F223): the Assets section is the asset mapping
 * manager; articles remain pull-only.
 */

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { BookOpen, ExternalLink, RefreshCw } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import HuduAssetMappingManager from './HuduAssetMappingManager';
import {
  getHuduClientContext,
  getHuduCompanyArticles,
  getHuduCompanyAssets,
} from '../../../lib/actions/integrations/huduDataActions';
import type { HuduClientContext } from '../../../lib/actions/integrations/huduDataActions';
import type {
  HuduCompanyDataResult,
  HuduLinkedItem,
} from '../../../lib/integrations/hudu/huduDataTypes';
import type { HuduArticle, HuduAsset } from '../../../lib/integrations/hudu/contracts';

export interface HuduClientTabProps {
  clientId: string;
}

function RecordLink({
  id,
  href,
  children,
}: {
  id: string;
  href: string | null;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <span id={id} className="font-medium text-gray-900">
        {children}
      </span>
    );
  }
  return (
    <a
      id={id}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium text-[rgb(var(--color-primary-600))] hover:underline"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

export function HuduClientTab({ clientId }: HuduClientTabProps) {
  const { t } = useTranslation('msp/integrations');

  const [context, setContext] = useState<HuduClientContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [assets, setAssets] = useState<HuduCompanyDataResult<HuduAsset> | null>(null);
  const [articles, setArticles] = useState<HuduCompanyDataResult<HuduArticle> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, startRefreshTransition] = useTransition();

  const load = useCallback(
    async (refresh: boolean) => {
      setContextError(null);
      try {
        const ctx = await getHuduClientContext(clientId);
        setContext(ctx);
        if (!ctx.connected || !ctx.mapped) {
          setAssets(null);
          setArticles(null);
          return;
        }
        const [assetsResult, articlesResult] = await Promise.all([
          getHuduCompanyAssets(clientId, { refresh }),
          getHuduCompanyArticles(clientId, { refresh }),
        ]);
        setAssets(assetsResult);
        setArticles(articlesResult);
      } catch (error) {
        setContextError(error instanceof Error ? error.message : String(error));
      }
    },
    [clientId]
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void load(false).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleRefresh = () => {
    startRefreshTransition(async () => {
      await load(true);
    });
  };

  const companyUrl =
    (assets?.state === 'ok' ? assets.companyUrl : null) ??
    (articles?.state === 'ok' ? articles.companyUrl : null);

  const listsUnmapped = assets?.state === 'unmapped' || articles?.state === 'unmapped';
  const notConnected = context !== null && !context.connected;
  const unmapped = (context !== null && context.connected && !context.mapped) || listsUnmapped;

  const renderSection = <TItem extends { id: number; name: string }>(
    key: 'assets' | 'articles',
    icon: React.ReactNode,
    title: string,
    emptyText: string,
    result: HuduCompanyDataResult<TItem> | null,
    renderMeta: (item: HuduLinkedItem<TItem>) => string | null
  ) => (
    <Card id={`hudu-client-tab-${key}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
          {result?.state === 'ok' && (
            <Badge id={`hudu-client-tab-${key}-count`} variant="secondary">
              {result.count}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {result?.state === 'ok' && result.count === 0 && (
          <p id={`hudu-client-tab-${key}-empty`} className="text-sm text-gray-500">
            {emptyText}
          </p>
        )}
        {result?.state === 'ok' && result.count > 0 && (
          <ul className="divide-y divide-gray-100">
            {result.items.map((item) => {
              const meta = renderMeta(item);
              return (
                <li key={item.id} className="flex flex-col gap-0.5 py-2">
                  <RecordLink id={`hudu-client-tab-${key}-link-${item.id}`} href={item.hudu_url}>
                    {item.name}
                  </RecordLink>
                  {meta && <span className="text-xs text-gray-500">{meta}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {(result?.state === 'error' || result?.state === 'no_password_access') && (
          <Alert id={`hudu-client-tab-${key}-error`} variant="destructive">
            <AlertDescription>
              {t('integrations.hudu.clientTab.unreachable', {
                defaultValue: 'Hudu could not be reached. Try again later.',
              })}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div id="hudu-client-tab" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {/* F075: visible source attribution + link out. */}
        <div
          id="hudu-client-tab-attribution"
          className="flex items-center gap-2 text-sm text-gray-500"
        >
          <BookOpen className="h-4 w-4 shrink-0" />
          <span>
            {t('integrations.hudu.clientTab.source', { defaultValue: 'Source: Hudu' })}
          </span>
          {companyUrl && (
            <a
              id="hudu-client-tab-attribution-link"
              href={companyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[rgb(var(--color-primary-600))] hover:underline"
            >
              {t('integrations.hudu.clientTab.openInHudu', { defaultValue: 'Open in Hudu' })}
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          )}
        </div>
        <Button
          id="hudu-client-tab-refresh"
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading || isRefreshing}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {t('integrations.hudu.clientTab.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      {isLoading && (
        <p id="hudu-client-tab-loading" className="text-sm text-gray-500">
          {t('integrations.hudu.clientTab.loading', { defaultValue: 'Loading Hudu data...' })}
        </p>
      )}

      {!isLoading && contextError && (
        <Alert id="hudu-client-tab-error" variant="destructive">
          <AlertDescription>
            {t('integrations.hudu.clientTab.unreachable', {
              defaultValue: 'Hudu could not be reached. Try again later.',
            })}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !contextError && notConnected && (
        <Alert id="hudu-client-tab-not-connected">
          <AlertDescription>
            {t('integrations.hudu.clientTab.notConnected', {
              defaultValue:
                'Hudu is not connected. An administrator can connect it under Settings → Integrations.',
            })}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !contextError && !notConnected && unmapped && (
        <Alert id="hudu-client-tab-unmapped">
          <AlertDescription>
            {t('integrations.hudu.clientTab.unmapped', {
              defaultValue:
                'This client is not mapped to a Hudu company yet. Map it under Settings → Integrations → Hudu.',
            })}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !contextError && !notConnected && !unmapped && context?.connected && (
        <div className="space-y-4">
          {/* F223: the Assets section is the mapping manager (it fetches its
              own mapping view); fetch-level errors keep the Phase 1 alert. */}
          <div id="hudu-client-tab-assets">
            {assets?.state === 'ok' ? (
              <HuduAssetMappingManager clientId={clientId} />
            ) : assets?.state === 'error' || assets?.state === 'no_password_access' ? (
              <Alert id="hudu-client-tab-assets-error" variant="destructive">
                <AlertDescription>
                  {t('integrations.hudu.clientTab.unreachable', {
                    defaultValue: 'Hudu could not be reached. Try again later.',
                  })}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          {renderSection<HuduArticle>(
            'articles',
            <BookOpen className="h-4 w-4 shrink-0" />,
            t('integrations.hudu.clientTab.articlesTitle', { defaultValue: 'Articles' }),
            t('integrations.hudu.clientTab.articlesEmpty', {
              defaultValue: 'No Hudu articles for this company.',
            }),
            articles,
            (item) =>
              item.folder_id !== null && item.folder_id !== undefined
                ? `${t('integrations.hudu.clientTab.folder', { defaultValue: 'Folder' })} #${item.folder_id}`
                : null
          )}
        </div>
      )}
    </div>
  );
}

export default HuduClientTab;
