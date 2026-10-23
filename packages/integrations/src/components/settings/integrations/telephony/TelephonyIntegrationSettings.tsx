'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Phone } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getTelephonyOverview,
  setTelephonyAutoTicketPolicy,
  setTelephonyProviderEnabled,
} from '../../../../actions/integrations/telephonyActions';
import type { TelephonyOverview, TelephonyProviderCard } from '../../../../actions/integrations/telephonyActions';
import { getTelephonyProviderRegistryEntry } from '../../../../lib/telephony/providerRegistry';
import { TelephonyStatusBadge } from './TelephonyStatusBadge';
import { TelephonyUnavailableCard } from './TelephonyUnavailableCard';
import { TeamsPhoneIntegrationSettings } from './TeamsPhoneIntegrationSettings';
import { ThreecxIntegrationSettings } from './ThreecxIntegrationSettings';

const PROVIDER_LABEL_DEFAULTS: Record<string, string> = {
  'teams-phone': 'Teams Phone',
  '3cx': '3CX',
};

const PROVIDER_DESCRIPTION_DEFAULTS: Record<string, string> = {
  'teams-phone':
    'Journal Teams Phone calls as interactions once each call ends. Call history, not live screen pop.',
  '3cx':
    'Journal 3CX calls as interactions and recognise callers in the 3CX client through the CRM template.',
};

function ProviderMark() {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(var(--color-primary-500))] text-white shadow-sm ring-1 ring-border">
      <Phone className="h-5 w-5" />
    </div>
  );
}

export function TelephonyIntegrationSettings() {
  const { t } = useTranslation('msp/integrations');
  const searchParams = useSearchParams();
  const [overview, setOverview] = useState<TelephonyOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getTelephonyOverview();
      setOverview(next);
      setError(next.available ? null : next.error ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const requestedProvider = searchParams?.get('telephony_provider') ?? null;
  // The contact-queue deep link lands on ?threecxPending=<id>; open 3CX straight
  // away so the dialog it carries is not hidden behind the chooser.
  const threecxPending = searchParams?.get('threecxPending') ?? null;

  const resolveRequestedSelection = (): string | null => {
    if (requestedProvider && getTelephonyProviderRegistryEntry(requestedProvider)) {
      return requestedProvider;
    }
    if (threecxPending) {
      return '3cx';
    }
    return null;
  };

  const [selected, setSelected] = useState<string | null>(() => resolveRequestedSelection());
  const [showProviderChooser, setShowProviderChooser] = useState(() => resolveRequestedSelection() === null);

  useEffect(() => {
    const requested = resolveRequestedSelection();
    if (requested) {
      setSelected(requested);
      setShowProviderChooser(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedProvider, threecxPending]);

  const providers = overview?.providers ?? [];
  const canManage = Boolean(overview?.canManage);

  // The 3CX surface is self-gating on the server (edition + Pro tier); the
  // chooser honours that so an unentitled tenant is never offered a card that
  // leads to an empty page.
  const visibleProviders = useMemo(
    () =>
      providers.filter((provider) => {
        if (provider.provider !== '3cx') return true;
        return provider.providerAvailability?.enabled !== false;
      }),
    [providers],
  );

  const providerLabel = (provider: string) => {
    const entry = getTelephonyProviderRegistryEntry(provider);
    return entry
      ? t(entry.labelKey, { defaultValue: PROVIDER_LABEL_DEFAULTS[provider] ?? provider })
      : provider;
  };

  const providerDescription = (provider: string) => {
    const entry = getTelephonyProviderRegistryEntry(provider);
    return entry ? t(entry.descriptionKey, { defaultValue: PROVIDER_DESCRIPTION_DEFAULTS[provider] ?? '' }) : '';
  };

  const toggleProvider = async (provider: string, enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await setTelephonyProviderEnabled({ provider, enabled });
      if (!result.success) {
        setError(result.error ?? null);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoTicket = async (provider: string, autoCreateTickets: boolean) => {
    setBusy(true);
    try {
      await setTelephonyAutoTicketPolicy({ provider, autoCreateTickets });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const updateUrlSelection = (nextSelection: string) => {
    const currentSearchParams = new URLSearchParams(window.location.search);
    currentSearchParams.delete('tab');
    currentSearchParams.set('category', 'communication');
    currentSearchParams.set('telephony_provider', nextSelection);
    const newUrl = `${window.location.pathname}?${currentSearchParams.toString()}`;
    window.history.pushState({}, '', newUrl);
  };

  // An authorization refusal carries no entitlement reason. Telling someone who
  // may not see the call log to go buy an add-on would be the wrong answer.
  if (overview && !overview.success) {
    return (
      <Card id="telephony-forbidden-card">
        <CardHeader>
          <CardTitle>{t('integrations.telephony.paywall.title', { defaultValue: 'Telephony' })}</CardTitle>
          <CardDescription id="telephony-forbidden-message">
            {t('integrations.telephony.forbidden', {
              defaultValue: 'You do not have permission to view telephony settings for this tenant.',
            })}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (overview && !overview.available) {
    return <TelephonyUnavailableCard reason={overview.reason} message={overview.error} />;
  }

  const selectedProvider: TelephonyProviderCard | undefined = selected
    ? providers.find((provider) => provider.provider === selected)
    : undefined;

  return (
    <div className="space-y-6" id="telephony-integrations-setup">
      {showProviderChooser ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {visibleProviders.map((provider) => (
            <Card
              key={provider.provider}
              className="relative overflow-hidden transition-shadow hover:shadow-md"
              id={`telephony-provider-card-${provider.provider}`}
            >
              <CardHeader className="space-y-3 p-4 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <ProviderMark />
                  <TelephonyStatusBadge status={provider.status} />
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-base leading-tight">{providerLabel(provider.provider)}</CardTitle>
                  <CardDescription className="min-h-10 text-sm leading-5">
                    {providerDescription(provider.provider)}
                  </CardDescription>
                </div>
              </CardHeader>

              {!provider.prerequisiteMet && (
                <CardContent className="px-4 pb-3 pt-0 text-xs text-muted-foreground">
                  <p id={`telephony-provider-prerequisite-${provider.provider}`}>
                    {t('integrations.telephony.providers.teamsPhone.prerequisite', {
                      defaultValue:
                        'Configure the Microsoft Teams integration first — Teams Phone reuses its Microsoft profile.',
                    })}
                  </p>
                </CardContent>
              )}

              <CardFooter className="px-4 pb-4 pt-0">
                <Button
                  id={`telephony-provider-configure-${provider.provider}`}
                  className="w-full"
                  variant={provider.provider === selected ? 'default' : 'outline'}
                  onClick={() => {
                    setSelected(provider.provider);
                    setShowProviderChooser(false);
                    updateUrlSelection(provider.provider);
                  }}
                >
                  {provider.provider === selected
                    ? t('integrations.telephony.setup.selectedAction', { defaultValue: 'Selected' })
                    : t('integrations.telephony.setup.configure', { defaultValue: 'Configure' })}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <>
          {selected && (
            <Card id="telephony-integration-current-provider">
              <div className="flex flex-wrap items-center gap-4 px-6 py-4">
                <ProviderMark />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('integrations.telephony.setup.currentIntegration', { defaultValue: 'Telephony provider' })}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="text-lg font-semibold text-foreground">{providerLabel(selected)}</p>
                    {selectedProvider && <TelephonyStatusBadge status={selectedProvider.status} />}
                  </div>
                </div>
                <Button
                  id="telephony-integration-change-provider"
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowProviderChooser(true)}
                >
                  {t('integrations.telephony.setup.changeIntegration', { defaultValue: 'Choose another' })}
                </Button>
              </div>
            </Card>
          )}

          <div id="telephony-integrations-active-config">
            {selected === '3cx' ? (
              <ThreecxIntegrationSettings />
            ) : selectedProvider?.provider === 'teams-phone' ? (
              <TeamsPhoneIntegrationSettings
                provider={selectedProvider}
                canManage={canManage}
                busy={busy}
                onToggleEnabled={(enabled) => void toggleProvider(selectedProvider.provider, enabled)}
                onToggleAutoTicket={(autoCreateTickets) =>
                  void toggleAutoTicket(selectedProvider.provider, autoCreateTickets)
                }
              />
            ) : null}
          </div>
        </>
      )}

      {error && (
        <p className="text-sm text-[rgb(var(--color-accent-600))]" id="telephony-error-message">
          {error}
        </p>
      )}
    </div>
  );
}

export default TelephonyIntegrationSettings;
