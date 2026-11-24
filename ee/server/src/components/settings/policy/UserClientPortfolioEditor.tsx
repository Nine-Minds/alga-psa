'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { TIER_FEATURES } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useTierFeature } from 'server/src/context/TierContext';
import {
  getPortfolioClientNamesAction,
  getUserClientPortfolioAction,
  setUserClientPortfolioAction,
  type UserClientPortfolioEntry,
} from 'ee/server/src/lib/actions/auth/clientPortfolioActions';

/**
 * The client portfolio of one MSP user: the clients they work for. A `client_portfolio` bundle rule limits the
 * user to these clients, so one bundle serves every restricted user. Shown on the user's record and Pro-gated
 * like the rest of the authorization settings (the actions refuse without the tier as well).
 */
export default function UserClientPortfolioEditor({ userId }: { userId: string }) {
  const { t } = useTranslation('msp/admin');
  const hasPortfolioEditor = useTierFeature(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
  const [saved, setSaved] = useState<UserClientPortfolioEntry[]>([]);
  const [draft, setDraft] = useState<UserClientPortfolioEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const entries = await getUserClientPortfolioAction({ userId });
      setSaved(entries);
      setDraft(entries);
    } catch (loadError) {
      console.error('Failed to load client portfolio', loadError);
      setError(t('policyManagement.portfolio.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    if (hasPortfolioEditor) void load();
  }, [hasPortfolioEditor, load]);

  if (!hasPortfolioEditor) return null;

  const addClient = async (clientId: string | null) => {
    if (!clientId || draft.some((entry) => entry.clientId === clientId)) return;
    try {
      const [entry] = await getPortfolioClientNamesAction({ clientIds: [clientId] });
      if (entry) setDraft((current) => [...current, entry].sort((a, b) => a.clientName.localeCompare(b.clientName)));
    } catch (lookupError) {
      console.error('Failed to look up client', lookupError);
      setError(t('policyManagement.portfolio.errors.lookup'));
    }
  };

  const dirty =
    draft.length !== saved.length || draft.some((entry) => !saved.some((s) => s.clientId === entry.clientId));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const stored = await setUserClientPortfolioAction({ userId, clientIds: draft.map((entry) => entry.clientId) });
      setSaved(stored);
      setDraft(stored);
      toast.success(t('policyManagement.portfolio.saved'));
    } catch (saveError) {
      console.error('Failed to save client portfolio', saveError);
      setError(t('policyManagement.portfolio.errors.save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="user-client-portfolio-editor" className="mt-4">
      <CardHeader>
        <CardTitle>{t('policyManagement.portfolio.title')}</CardTitle>
        <CardDescription>{t('policyManagement.portfolio.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <ClientPicker
          id="user-client-portfolio-add-client"
          selectedClientId={null}
          excludeIds={draft.map((entry) => entry.clientId)}
          onSelect={(clientId) => void addClient(clientId)}
          placeholder={t('policyManagement.portfolio.addClient')}
          disabled={loading || saving}
        />

        <div className="flex flex-wrap gap-2" id="user-client-portfolio-clients">
          {loading ? (
            <span className="text-xs text-muted-foreground">{t('policyManagement.portfolio.loading')}</span>
          ) : draft.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t('policyManagement.portfolio.empty')}</span>
          ) : (
            draft.map((entry) => (
              <div
                key={entry.clientId}
                className="flex items-center gap-2 rounded-full border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] px-3 py-1 text-xs text-[rgb(var(--color-primary-700))] dark:bg-[rgb(var(--color-primary-400)/0.18)]"
              >
                <span>{entry.clientName}</span>
                <button
                  id={`user-client-portfolio-remove-${entry.clientId}`}
                  type="button"
                  className="hover:text-[rgb(var(--color-primary-900))]"
                  aria-label={t('policyManagement.portfolio.removeClient', { client: entry.clientName })}
                  onClick={() => setDraft((current) => current.filter((item) => item.clientId !== entry.clientId))}
                >
                  {t('policyManagement.editor.scopes.remove')}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end">
          <Button id="user-client-portfolio-save" onClick={() => void save()} disabled={!dirty || saving || loading}>
            {saving ? t('policyManagement.portfolio.saving') : t('policyManagement.portfolio.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
