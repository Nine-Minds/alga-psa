'use client';

/**
 * Client detail "Passwords" tab (F080–F083): metadata-only list of the mapped
 * Hudu company's asset passwords with per-row inline Reveal (live GET, audited
 * server-side) and Open-in-Hudu links. SECURITY (NFR1): revealed values live
 * ONLY in transient component state — cleared on Hide, on Refresh, and gone on
 * unmount — and are never logged, cached, or persisted anywhere.
 */

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { BookOpen, Copy, ExternalLink, Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getHuduClientContext,
  getHuduCompanyPasswords,
  revealHuduPassword,
} from '../../../lib/actions/integrations/huduDataActions';
import type { HuduClientContext } from '../../../lib/actions/integrations/huduDataActions';
import type { HuduCompanyDataResult } from '../../../lib/integrations/hudu/huduDataTypes';
import type { HuduAssetPasswordSummary } from '../../../lib/integrations/hudu/contracts';

export interface HuduClientPasswordsTabProps {
  clientId: string;
}

type RevealErrorKey = 'revealNoAccess' | 'revealNotFound' | 'revealFailed';

export function HuduClientPasswordsTab({ clientId }: HuduClientPasswordsTabProps) {
  const { t } = useTranslation('msp/integrations');

  const [context, setContext] = useState<HuduClientContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [passwords, setPasswords] = useState<HuduCompanyDataResult<HuduAssetPasswordSummary> | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, startRefreshTransition] = useTransition();

  // SECURITY: the only place revealed values ever live. Keyed by password id;
  // entries are deleted on Hide/Refresh and the whole map dies with the
  // component on unmount. Never copied to any store/context and never logged.
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});
  const [revealingIds, setRevealingIds] = useState<Record<string, boolean>>({});
  const [revealErrors, setRevealErrors] = useState<Record<string, RevealErrorKey>>({});

  const load = useCallback(
    async (refresh: boolean) => {
      setContextError(null);
      setRevealedValues({});
      setRevealErrors({});
      try {
        const ctx = await getHuduClientContext(clientId);
        setContext(ctx);
        if (!ctx.connected || !ctx.mapped) {
          setPasswords(null);
          return;
        }
        setPasswords(await getHuduCompanyPasswords(clientId, { refresh }));
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

  const handleReveal = async (passwordId: number) => {
    const key = String(passwordId);
    setRevealingIds((prev) => ({ ...prev, [key]: true }));
    setRevealErrors((prev) => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      const result = await revealHuduPassword(clientId, passwordId);
      if (result.state === 'ok') {
        setRevealedValues((prev) => ({ ...prev, [key]: result.value }));
      } else {
        setRevealErrors((prev) => ({
          ...prev,
          [key]:
            result.state === 'no_password_access'
              ? 'revealNoAccess'
              : result.state === 'not_found'
                ? 'revealNotFound'
                : 'revealFailed',
        }));
      }
    } catch {
      setRevealErrors((prev) => ({ ...prev, [key]: 'revealFailed' }));
    } finally {
      setRevealingIds((prev) => {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleHide = (passwordId: number) => {
    const key = String(passwordId);
    setRevealedValues((prev) => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const handleCopy = (passwordId: number) => {
    const value = revealedValues[String(passwordId)];
    if (value !== undefined) {
      void navigator.clipboard.writeText(value);
    }
  };

  const companyUrl = passwords?.state === 'ok' ? passwords.companyUrl : null;
  const notConnected = context !== null && !context.connected;
  const unmapped =
    (context !== null && context.connected && !context.mapped) || passwords?.state === 'unmapped';

  const revealErrorText: Record<RevealErrorKey, string> = {
    revealNoAccess: t('integrations.hudu.passwordsTab.revealNoAccess', {
      defaultValue: 'The Hudu API key does not have password access enabled.',
    }),
    revealNotFound: t('integrations.hudu.passwordsTab.revealNotFound', {
      defaultValue: 'This password could not be found in Hudu.',
    }),
    revealFailed: t('integrations.hudu.passwordsTab.revealFailed', {
      defaultValue: 'The password could not be revealed. Try again later.',
    }),
  };

  return (
    <div id="hudu-passwords-tab" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div
          id="hudu-passwords-tab-attribution"
          className="flex items-center gap-2 text-sm text-gray-500"
        >
          <BookOpen className="h-4 w-4 shrink-0" />
          <span>{t('integrations.hudu.passwordsTab.source', { defaultValue: 'Source: Hudu' })}</span>
          {companyUrl && (
            <a
              id="hudu-passwords-tab-attribution-link"
              href={companyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[rgb(var(--color-primary-600))] hover:underline"
            >
              {t('integrations.hudu.passwordsTab.openInHudu', { defaultValue: 'Open in Hudu' })}
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          )}
        </div>
        <Button
          id="hudu-passwords-tab-refresh"
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading || isRefreshing}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {t('integrations.hudu.passwordsTab.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      {isLoading && (
        <p id="hudu-passwords-tab-loading" className="text-sm text-gray-500">
          {t('integrations.hudu.passwordsTab.loading', { defaultValue: 'Loading Hudu passwords...' })}
        </p>
      )}

      {!isLoading && contextError && (
        <Alert id="hudu-passwords-tab-error" variant="destructive">
          <AlertDescription>
            {t('integrations.hudu.passwordsTab.unreachable', {
              defaultValue: 'Hudu could not be reached. Try again later.',
            })}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !contextError && notConnected && (
        <Alert id="hudu-passwords-tab-not-connected">
          <AlertDescription>
            {t('integrations.hudu.passwordsTab.notConnected', {
              defaultValue:
                'Hudu is not connected. An administrator can connect it under Settings → Integrations.',
            })}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !contextError && !notConnected && unmapped && (
        <Alert id="hudu-passwords-tab-unmapped">
          <AlertDescription>
            {t('integrations.hudu.passwordsTab.unmapped', {
              defaultValue:
                'This client is not mapped to a Hudu company yet. Map it under Settings → Integrations → Hudu.',
            })}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !contextError && passwords?.state === 'no_password_access' && (
        <Alert id="hudu-passwords-tab-no-access" variant="destructive">
          <AlertDescription>
            {t('integrations.hudu.passwordsTab.noPasswordAccess', {
              defaultValue:
                'The Hudu API key does not have password access enabled, so passwords cannot be listed. Generate a key with password access in Hudu admin.',
            })}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !contextError && passwords?.state === 'error' && (
        <Alert id="hudu-passwords-tab-list-error" variant="destructive">
          <AlertDescription>
            {t('integrations.hudu.passwordsTab.unreachable', {
              defaultValue: 'Hudu could not be reached. Try again later.',
            })}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !contextError && passwords?.state === 'ok' && (
        <Card id="hudu-passwords-tab-list">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 shrink-0" />
              {t('integrations.hudu.passwordsTab.title', { defaultValue: 'Passwords' })}
              <Badge id="hudu-passwords-tab-count" variant="secondary">
                {passwords.count}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {passwords.count === 0 && (
              <p id="hudu-passwords-tab-empty" className="text-sm text-gray-500">
                {t('integrations.hudu.passwordsTab.empty', {
                  defaultValue: 'No Hudu passwords for this company.',
                })}
              </p>
            )}
            {passwords.count > 0 && (
              <ul className="divide-y divide-gray-100">
                {passwords.items.map((item) => {
                  const key = String(item.id);
                  const value = revealedValues[key];
                  const errorKey = revealErrors[key];
                  return (
                    <li key={item.id} className="flex items-start justify-between gap-4 py-2">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span
                          id={`hudu-passwords-tab-name-${item.id}`}
                          className="font-medium text-gray-900"
                        >
                          {item.name}
                        </span>
                        {item.username && (
                          <span
                            id={`hudu-passwords-tab-username-${item.id}`}
                            className="text-xs text-gray-500"
                          >
                            {item.username}
                          </span>
                        )}
                        {value !== undefined && (
                          <div className="flex items-center gap-2">
                            <code
                              id={`hudu-passwords-tab-value-${item.id}`}
                              className="rounded bg-gray-100 px-2 py-1 font-mono text-sm text-gray-900"
                            >
                              {value}
                            </code>
                            <Button
                              id={`hudu-passwords-tab-copy-${item.id}`}
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCopy(item.id)}
                            >
                              <Copy className="mr-1 h-3.5 w-3.5" />
                              {t('integrations.hudu.passwordsTab.copy', { defaultValue: 'Copy' })}
                            </Button>
                          </div>
                        )}
                        {errorKey && (
                          <span
                            id={`hudu-passwords-tab-reveal-error-${item.id}`}
                            role="alert"
                            className="text-xs text-red-600"
                          >
                            {revealErrorText[errorKey]}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {item.hudu_url && (
                          <a
                            id={`hudu-passwords-tab-open-${item.id}`}
                            href={item.hudu_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-[rgb(var(--color-primary-600))] hover:underline"
                          >
                            {t('integrations.hudu.passwordsTab.openInHudu', {
                              defaultValue: 'Open in Hudu',
                            })}
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          </a>
                        )}
                        {value === undefined ? (
                          <Button
                            id={`hudu-passwords-tab-reveal-${item.id}`}
                            variant="outline"
                            size="sm"
                            onClick={() => handleReveal(item.id)}
                            disabled={revealingIds[key] === true}
                          >
                            <Eye className="mr-1 h-3.5 w-3.5" />
                            {t('integrations.hudu.passwordsTab.reveal', { defaultValue: 'Reveal' })}
                          </Button>
                        ) : (
                          <Button
                            id={`hudu-passwords-tab-hide-${item.id}`}
                            variant="outline"
                            size="sm"
                            onClick={() => handleHide(item.id)}
                          >
                            <EyeOff className="mr-1 h-3.5 w-3.5" />
                            {t('integrations.hudu.passwordsTab.hide', { defaultValue: 'Hide' })}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default HuduClientPasswordsTab;
