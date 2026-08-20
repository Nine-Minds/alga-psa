'use client';

/**
 * Shared load + reveal state for credential lists: the global/entity
 * CredentialsScreen and the compact bento tile body both consume this hook,
 * so the security-sensitive reveal handling exists exactly once.
 *
 * SECURITY (NFR1): revealed values live ONLY in this hook's transient state,
 * keyed by row id — cleared on hide, on reload, and gone on unmount — and are
 * never logged, cached, or persisted client-side. Every reveal round-trips
 * the server. `copyPassword` on an unrevealed row fetches the value
 * transiently for the clipboard and never stores or renders it.
 */

import { useCallback, useEffect, useState, useTransition } from 'react';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getCredentialsContext,
  listCredentials,
  revealCredential,
} from '../../lib/actions/credentials/credentialActions';
import type { CredentialsContext } from '../../lib/actions/credentials/credentialActions';
import type {
  CredentialAssociationEntityType,
  CredentialRevealResult,
  CredentialSummary,
} from '../../lib/credentials/contracts';

export type RevealState = {
  password: string;
  otpCode: CredentialRevealResult['otpCode'];
};

export type RevealErrorKey = 'failed' | 'noAccess' | 'notFound';

const REVEAL_ERROR_KEY: Record<string, RevealErrorKey> = {
  no_access: 'noAccess',
  not_found: 'notFound',
};

export function useCredentialsList({
  enabled,
  clientId,
  entityType,
  entityId,
}: {
  /** Gate for the initial fetch (feature flag). */
  enabled: boolean;
  clientId?: string;
  entityType?: CredentialAssociationEntityType;
  entityId?: string;
}) {
  const { t } = useTranslation('msp/credentials');

  const [context, setContext] = useState<CredentialsContext | null>(null);
  const [credentials, setCredentials] = useState<CredentialSummary[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [loadError, setLoadError] = useState(false);

  // SECURITY: the only place revealed values ever live.
  const [revealedValues, setRevealedValues] = useState<Record<string, RevealState>>({});
  const [revealingIds, setRevealingIds] = useState<Record<string, boolean>>({});
  const [revealErrors, setRevealErrors] = useState<Record<string, RevealErrorKey>>({});

  const load = useCallback(async () => {
    setLoadError(false);
    setRevealedValues({});
    setRevealErrors({});
    try {
      const ctx = await getCredentialsContext();
      setContext(ctx);
      if (!ctx.tierOk) {
        setCredentials([]);
        return;
      }
      setCredentials(await listCredentials({ clientId, entityType, entityId }));
    } catch {
      setLoadError(true);
    }
  }, [clientId, entityType, entityId]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setIsLoading(true);
    void load().finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, load]);

  const refresh = useCallback(() => {
    startRefreshTransition(async () => {
      await load();
    });
  }, [load]);

  const clearRevealing = (id: string) =>
    setRevealingIds((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });

  const reveal = useCallback(async (id: string) => {
    setRevealingIds((prev) => ({ ...prev, [id]: true }));
    setRevealErrors((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      const result = await revealCredential(id);
      if (result.state === 'ok') {
        setRevealedValues((prev) => ({
          ...prev,
          [id]: { password: result.password ?? '', otpCode: result.otpCode ?? null },
        }));
      } else {
        setRevealErrors((prev) => ({ ...prev, [id]: REVEAL_ERROR_KEY[result.state] ?? 'failed' }));
      }
    } catch {
      setRevealErrors((prev) => ({ ...prev, [id]: 'failed' }));
    } finally {
      clearRevealing(id);
    }
  }, []);

  const hide = useCallback((id: string) => {
    setRevealedValues((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  /**
   * Copy the password. Already-revealed rows copy from state; unrevealed rows
   * fetch the value transiently for the clipboard without displaying it (the
   * audit trail rides the reveal action either way).
   */
  const copyPassword = useCallback(
    async (id: string) => {
      const revealed = revealedValues[id];
      if (revealed !== undefined) {
        if (revealed.password === '') {
          toast.error(t('credentials.table.noPassword'));
          return;
        }
        await navigator.clipboard.writeText(revealed.password);
        toast.success(t('credentials.table.copied'));
        return;
      }
      setRevealingIds((prev) => ({ ...prev, [id]: true }));
      setRevealErrors((prev) => {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      });
      try {
        const result = await revealCredential(id);
        if (result.state !== 'ok') {
          setRevealErrors((prev) => ({ ...prev, [id]: REVEAL_ERROR_KEY[result.state] ?? 'failed' }));
          return;
        }
        if (!result.password) {
          toast.error(t('credentials.table.noPassword'));
          return;
        }
        await navigator.clipboard.writeText(result.password);
        toast.success(t('credentials.table.copied'));
      } catch {
        setRevealErrors((prev) => ({ ...prev, [id]: 'failed' }));
      } finally {
        clearRevealing(id);
      }
    },
    [revealedValues, t]
  );

  const copyOtp = useCallback(
    (id: string) => {
      const code = revealedValues[id]?.otpCode?.code;
      if (code !== undefined) {
        void navigator.clipboard.writeText(code);
        toast.success(t('credentials.table.copied'));
      }
    },
    [revealedValues, t]
  );

  return {
    context,
    credentials,
    isLoading,
    isRefreshing,
    loadError,
    load,
    refresh,
    revealedValues,
    revealingIds,
    revealErrors,
    reveal,
    hide,
    copyPassword,
    copyOtp,
  };
}
