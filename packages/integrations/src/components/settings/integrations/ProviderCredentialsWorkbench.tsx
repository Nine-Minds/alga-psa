'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  Cloud,
  ExternalLink,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import type {
  getGoogleIntegrationStatus,
  getMicrosoftIntegrationStatus,
} from '@alga-psa/integrations/actions';
import { GoogleIntegrationSettings } from './GoogleIntegrationSettings';
import { MicrosoftIntegrationSettings } from './MicrosoftIntegrationSettings';

type ProviderKey = 'google' | 'microsoft';
type GoogleIntegrationStatus = Awaited<ReturnType<typeof getGoogleIntegrationStatus>>;
type MicrosoftIntegrationStatus = Awaited<ReturnType<typeof getMicrosoftIntegrationStatus>>;
type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

interface ProviderCredentialsWorkbenchProps {
  canUseTeams?: boolean;
  isEnterpriseEdition?: boolean;
}

interface ProviderBadge {
  label: string;
  variant: BadgeVariant;
}

function getGoogleBadge(status: GoogleIntegrationStatus | null, t: TranslateFn): ProviderBadge {
  if (!status) {
    return {
      label: t('integrations.providersWorkbench.badges.loading', { defaultValue: 'Loading' }),
      variant: 'secondary',
    };
  }

  if (!status.success) {
    return {
      label: t('integrations.providersWorkbench.badges.needsAttention', { defaultValue: 'Needs attention' }),
      variant: 'error',
    };
  }

  const config = status.config;
  if (!config) {
    return {
      label: t('integrations.providersWorkbench.badges.notConfigured', { defaultValue: 'Not configured' }),
      variant: 'secondary',
    };
  }

  const ready = Boolean(
    config.projectId
      && config.gmailClientId
      && config.gmailClientSecretMasked
      && config.calendarClientId
      && config.calendarClientSecretMasked
      && config.hasServiceAccountKey
  );
  const partiallyConfigured = Boolean(
    config.projectId
      || config.gmailClientId
      || config.gmailClientSecretMasked
      || config.calendarClientId
      || config.calendarClientSecretMasked
      || config.hasServiceAccountKey
  );

  if (ready) {
    return {
      label: t('integrations.providersWorkbench.badges.ready', { defaultValue: 'Ready' }),
      variant: 'success',
    };
  }

  if (partiallyConfigured) {
    return {
      label: t('integrations.providersWorkbench.badges.needsSetup', { defaultValue: 'Needs setup' }),
      variant: 'warning',
    };
  }

  return {
    label: t('integrations.providersWorkbench.badges.notConfigured', { defaultValue: 'Not configured' }),
    variant: 'secondary',
  };
}

function getMicrosoftBadge(status: MicrosoftIntegrationStatus | null, t: TranslateFn): ProviderBadge {
  if (!status) {
    return {
      label: t('integrations.providersWorkbench.badges.loading', { defaultValue: 'Loading' }),
      variant: 'secondary',
    };
  }

  if (!status.success) {
    return {
      label: t('integrations.providersWorkbench.badges.needsAttention', { defaultValue: 'Needs attention' }),
      variant: 'error',
    };
  }

  const profiles = status.profiles ?? [];
  const hasReadyProfile = profiles.some((profile) => !profile.isArchived && profile.readiness.ready);
  const hasAnyProfile = profiles.length > 0;

  if (hasReadyProfile) {
    return {
      label: t('integrations.providersWorkbench.badges.ready', { defaultValue: 'Ready' }),
      variant: 'success',
    };
  }

  if (hasAnyProfile) {
    return {
      label: t('integrations.providersWorkbench.badges.needsSetup', { defaultValue: 'Needs setup' }),
      variant: 'warning',
    };
  }

  return {
    label: t('integrations.providersWorkbench.badges.notConfigured', { defaultValue: 'Not configured' }),
    variant: 'secondary',
  };
}

export function ProviderCredentialsWorkbench({
  canUseTeams = true,
  isEnterpriseEdition = true,
}: ProviderCredentialsWorkbenchProps) {
  const { t } = useTranslation('msp/integrations');
  const router = useRouter();
  const [selectedProvider, setSelectedProvider] = React.useState<ProviderKey>('google');
  const [googleStatus, setGoogleStatus] = React.useState<GoogleIntegrationStatus | null>(null);
  const [microsoftStatus, setMicrosoftStatus] = React.useState<MicrosoftIntegrationStatus | null>(null);

  const providerOptions = [
    {
      id: 'google' as const,
      icon: Mail,
      label: t('integrations.providersWorkbench.google.label', { defaultValue: 'Google' }),
      description: t('integrations.providersWorkbench.google.description', { defaultValue: 'Staff sign-in with Google, Gmail inbound email, and Google Calendar.' }),
      badge: getGoogleBadge(googleStatus, t),
    },
    {
      id: 'microsoft' as const,
      icon: ShieldCheck,
      label: t('integrations.providersWorkbench.microsoft.label', { defaultValue: 'Microsoft' }),
      description: isEnterpriseEdition
        ? t('integrations.providersWorkbench.microsoft.descriptionEe', { defaultValue: 'Staff sign-in with Microsoft, Outlook email, Outlook calendar sync, and Teams.' })
        : t('integrations.providersWorkbench.microsoft.descriptionCe', { defaultValue: 'Staff sign-in with Microsoft.' }),
      badge: getMicrosoftBadge(microsoftStatus, t),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-[rgb(var(--color-border-200))] pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Cloud className="h-4 w-4" />
            {t('integrations.providersWorkbench.eyebrow', { defaultValue: 'Provider setup' })}
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">
              {t('integrations.providersWorkbench.title', { defaultValue: 'Google or Microsoft setup' })}
            </h2>
            <p className="mt-2 text-sm text-[rgb(var(--color-text-600))]">
              {isEnterpriseEdition
                ? t('integrations.providersWorkbench.descriptionEe', {
                    defaultValue: 'Most companies set up one: Google or Microsoft. Set up both only if your company uses both.',
                  })
                : t('integrations.providersWorkbench.descriptionCe', {
                    defaultValue: 'Most companies set up one: Google or Microsoft. Set up both only if your company uses both.',
                  })}
            </p>
          </div>
        </div>
        <Button
          id="msp-sso-moved-link"
          type="button"
          variant="outline"
          onClick={() => router.push('/msp/security-settings?tab=single-sign-on')}
          className="shrink-0"
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          {t('integrations.sso.msp.moved.cta', { defaultValue: 'Open Single Sign-On' })}
        </Button>
      </div>

      <div
        id="provider-credentials-selector"
        role="tablist"
        aria-label={t('integrations.providersWorkbench.selectorLabel', { defaultValue: 'Google or Microsoft setup options' })}
        className="grid gap-3 md:grid-cols-2"
      >
        {providerOptions.map((option) => {
          const Icon = option.icon;
          const selected = selectedProvider === option.id;

          return (
            <button
              key={option.id}
              id={`provider-credentials-${option.id}-tab`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`provider-credentials-${option.id}-panel`}
              onClick={() => setSelectedProvider(option.id)}
              className={`min-h-[112px] rounded-lg border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                selected
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/20'
                  : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] hover:bg-muted/40'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className={selected ? 'h-4 w-4 shrink-0 text-primary' : 'h-4 w-4 shrink-0 text-[rgb(var(--color-text-500))]'} />
                  <span className="truncate text-sm font-semibold text-[rgb(var(--color-text-900))]">
                    {option.label}
                  </span>
                </div>
                <Badge variant={option.badge.variant} size="sm" className="shrink-0">
                  {option.badge.label}
                </Badge>
              </div>
              <p className="mt-3 text-sm text-[rgb(var(--color-text-600))]">
                {option.description}
              </p>
            </button>
          );
        })}
      </div>

      <div
        id="provider-credentials-google-panel"
        role="tabpanel"
        aria-labelledby="provider-credentials-google-tab"
        hidden={selectedProvider !== 'google'}
      >
        <GoogleIntegrationSettings onStatusChange={setGoogleStatus} />
      </div>

      <div
        id="provider-credentials-microsoft-panel"
        role="tabpanel"
        aria-labelledby="provider-credentials-microsoft-tab"
        hidden={selectedProvider !== 'microsoft'}
      >
        <MicrosoftIntegrationSettings canUseTeams={canUseTeams} onStatusChange={setMicrosoftStatus} />
      </div>
    </div>
  );
}
