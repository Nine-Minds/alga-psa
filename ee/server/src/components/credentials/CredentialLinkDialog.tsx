'use client';

/**
 * "Link existing" credential picker for entity-scoped credentials sections.
 *
 * Lists credentials compatible with the same-client rule (a client-bound
 * section passes its owning client; a clientless section passes none and sees
 * every credential), excluding rows already attached, and links the chosen
 * one via the entity-side association action. Mirrors the documents
 * DocumentSelector pattern (packages/documents/src/components/DocumentSelector.tsx).
 *
 * // LEVERAGE: pattern entity-attachments — documents' link-existing picker
 * // (DocumentSelector) and this credential picker are the same "search a
 * // compatible pool, exclude what's already attached, associate on save"
 * // dialog. A shared entity-attachments engine is a follow-up card (plan
 * // §scope expansion, decision 2).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Link2 } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listCredentials } from '../../lib/actions/credentials/credentialActions';
import type { CredentialSummary } from '../../lib/credentials/contracts';

interface CredentialLinkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Same-client filter: the entity's owning client (null = all clients). */
  clientId?: string | null;
  /** Rows already attached to the entity; excluded from the pool. */
  excludeCredentialIds?: string[];
  onSelect: (credential: CredentialSummary) => Promise<void>;
}

export function CredentialLinkDialog({
  isOpen,
  onClose,
  clientId,
  excludeCredentialIds = [],
  onSelect,
}: CredentialLinkDialogProps) {
  const { t } = useTranslation('msp/credentials');
  const [candidates, setCandidates] = useState<CredentialSummary[] | null>(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setCandidates(null);
    setSearch('');
    setError(false);
    setIsLoading(true);
    listCredentials({ clientId: clientId ?? undefined })
      .then((rows) => {
        if (!cancelled) setCandidates(rows);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, clientId]);

  const excluded = useMemo(() => new Set(excludeCredentialIds), [excludeCredentialIds]);

  const visible = useMemo(() => {
    if (!candidates) return [];
    const term = search.trim().toLowerCase();
    return candidates.filter((item) => {
      if (excluded.has(item.id)) return false;
      if (term) {
        const haystack = [item.name, item.username, item.url].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [candidates, search, excluded]);

  const handleSelect = async (credential: CredentialSummary) => {
    setLinkingId(credential.id);
    setError(false);
    try {
      await onSelect(credential);
    } catch {
      setError(true);
    } finally {
      setLinkingId(null);
    }
  };

  return (
    // The Dialog shell owns the chrome: title bar, close X, scrollable body,
    // sticky footer. Sizing lives on the shell (not an inner wrapper), so the
    // panel and its content agree on width, and Cancel can't scroll away.
    <Dialog
      id="credential-link-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('credentials.link.title')}
      className="max-w-lg"
      footer={
        <Button id="credential-link-cancel" variant="outline" onClick={onClose}>
          {t('credentials.link.cancel')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Input
          id="credential-link-search"
          placeholder={t('credentials.link.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {isLoading && (
          <p className="text-sm text-[rgb(var(--color-text-500))]">{t('credentials.screen.loading')}</p>
        )}
        {error && (
          <Alert id="credential-link-error" variant="destructive">
            <AlertDescription>{t('credentials.link.loadFailed')}</AlertDescription>
          </Alert>
        )}
        {candidates && visible.length === 0 && (
          <p id="credential-link-empty" className="text-sm text-[rgb(var(--color-text-500))]">
            {t('credentials.link.empty')}
          </p>
        )}
        {visible.length > 0 && (
          <ul id="credential-link-list" className="divide-y divide-[rgb(var(--color-border-100))]">
            {visible.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-medium text-[rgb(var(--color-text-900))]">
                    <span id={`credential-link-name-${item.id}`} className="min-w-0 truncate">
                      {item.name}
                    </span>
                    {/* Badge the marked case only, as everywhere else. */}
                    {item.source === 'hudu' && (
                      <Badge variant="secondary">{t('credentials.screen.sourceHudu')}</Badge>
                    )}
                  </span>
                  {item.username && (
                    <span className="truncate text-xs text-[rgb(var(--color-text-500))]">{item.username}</span>
                  )}
                </div>
                <Button
                  id={`credential-link-select-${item.id}`}
                  variant="outline"
                  size="sm"
                  onClick={() => handleSelect(item)}
                  disabled={linkingId === item.id}
                >
                  <Link2 className="mr-1 h-3.5 w-3.5" />
                  {t('credentials.link.attach')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

export default CredentialLinkDialog;
