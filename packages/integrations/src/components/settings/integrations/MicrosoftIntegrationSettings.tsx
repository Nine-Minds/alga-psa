'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  archiveMicrosoftProfile,
  createMicrosoftProfile,
  getMicrosoftIntegrationStatus,
  listMicrosoftConsumerBindings,
  resetMicrosoftProvidersToDisconnected,
  setDefaultMicrosoftProfile,
  setMicrosoftConsumerBinding,
  updateMicrosoftProfile,
} from '@alga-psa/integrations/actions';
import {
  getVisibleMicrosoftConsumerTypes,
  isMicrosoftConsumerEnterpriseEdition,
} from '../../../lib/microsoftConsumerVisibility';
import { resolveTeamsAvailability } from '../../../lib/teamsAvailability';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Star,
} from 'lucide-react';

type MicrosoftIntegrationStatus = Awaited<ReturnType<typeof getMicrosoftIntegrationStatus>>;
type MicrosoftConsumerBindingsResult = Awaited<ReturnType<typeof listMicrosoftConsumerBindings>>;
type MicrosoftProfile = NonNullable<MicrosoftIntegrationStatus['profiles']>[number];
type MicrosoftConsumerBinding = NonNullable<MicrosoftConsumerBindingsResult['bindings']>[number];
type MicrosoftConsumerType = MicrosoftConsumerBinding['consumerType'];
type ProfileDialogMode = 'create' | 'edit';

interface ProfileFormState {
  displayName: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  setAsDefault: boolean;
}

interface MicrosoftConsumerDescriptor {
  consumerType: MicrosoftConsumerType;
  consumerLabel: string;
  description: string;
  reconnectMessage?: string;
}

const DEFAULT_FORM_STATE: ProfileFormState = {
  displayName: '',
  clientId: '',
  clientSecret: '',
  tenantId: 'common',
  setAsDefault: false,
};

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function getReadinessMessages(profile: MicrosoftProfile, t: TranslateFn): string[] {
  const messages: string[] = [];

  if (profile.isArchived) {
    messages.push(t('integrations.microsoft.settings.readiness.archived', { defaultValue: 'Archived profiles cannot be used for new Microsoft bindings.' }));
  }
  if (!profile.readiness.clientIdConfigured) {
    messages.push(t('integrations.microsoft.settings.readiness.clientIdMissing', { defaultValue: 'Client ID is missing.' }));
  }
  if (!profile.readiness.clientSecretConfigured) {
    messages.push(t('integrations.microsoft.settings.readiness.clientSecretMissing', { defaultValue: 'Client secret has not been configured.' }));
  }
  if (!profile.readiness.tenantIdConfigured) {
    messages.push(t('integrations.microsoft.settings.readiness.tenantIdMissing', { defaultValue: 'Tenant ID is missing.' }));
  }

  return messages;
}

function getProfileStatusBadge(profile: MicrosoftProfile, t: TranslateFn): {
  label: string;
  variant: 'success' | 'warning' | 'secondary';
} {
  if (profile.isArchived) {
    return { label: t('integrations.microsoft.settings.statusBadges.archived', { defaultValue: 'Archived' }), variant: 'secondary' };
  }

  if (profile.readiness.ready) {
    return { label: t('integrations.microsoft.settings.statusBadges.ready', { defaultValue: 'Ready' }), variant: 'success' };
  }

  return { label: t('integrations.microsoft.settings.statusBadges.needsAttention', { defaultValue: 'Needs Attention' }), variant: 'warning' };
}

function getTeamsApplicationIdUri(baseUrl?: string, clientId?: string): string | null {
  if (!baseUrl || !clientId) {
    return null;
  }

  try {
    const url = new URL(baseUrl);
    return `api://${url.host}/teams/${clientId}`;
  } catch {
    return null;
  }
}

function GuidanceBlock({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={`${title}-${item.label}`} className="rounded-md border bg-muted/20 p-2">
            <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
            <div className="mt-1 break-all font-mono text-xs">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getConsumerDescriptors(showTeamsUi: boolean, t: TranslateFn): MicrosoftConsumerDescriptor[] {
  const visibleConsumers = getVisibleMicrosoftConsumerTypes(isMicrosoftConsumerEnterpriseEdition()).filter(
    (consumerType) => showTeamsUi || consumerType !== 'teams'
  );

  return visibleConsumers.map((consumerType) => {
    switch (consumerType) {
      case 'msp_sso':
        return {
          consumerType,
          consumerLabel: t('integrations.microsoft.settings.consumers.mspSso.label', { defaultValue: 'MSP SSO' }),
          description: t('integrations.microsoft.settings.consumers.mspSso.description', { defaultValue: 'Choose which Microsoft profile backs MSP SSO login domains, Microsoft sign-in, and tenant discovery.' }),
        };
      case 'email':
        return {
          consumerType,
          consumerLabel: t('integrations.microsoft.settings.consumers.email.label', { defaultValue: 'Email' }),
          description: t('integrations.microsoft.settings.consumers.email.description', { defaultValue: 'Choose which Microsoft profile Outlook inbound email should use.' }),
          reconnectMessage: t('integrations.microsoft.settings.consumers.email.reconnect', { defaultValue: 'Existing Outlook email connections may need re-authorization after changing the bound profile.' }),
        };
      case 'calendar':
        return {
          consumerType,
          consumerLabel: t('integrations.microsoft.settings.consumers.calendar.label', { defaultValue: 'Calendar' }),
          description: t('integrations.microsoft.settings.consumers.calendar.description', { defaultValue: 'Choose which Microsoft profile Outlook calendar sync should use.' }),
          reconnectMessage: t('integrations.microsoft.settings.consumers.calendar.reconnect', { defaultValue: 'Existing Microsoft calendar connections may need re-authorization after changing the bound profile.' }),
        };
      case 'teams':
        return {
          consumerType,
          consumerLabel: t('integrations.microsoft.settings.consumers.teams.label', { defaultValue: 'Teams' }),
          description: t('integrations.microsoft.settings.consumers.teams.description', { defaultValue: 'Choose which Microsoft profile Microsoft Teams installation and auth flows should use.' }),
        };
    }
  });
}

function getVisibleProfileConsumers(profile: MicrosoftProfile, showTeamsUi: boolean): string[] {
  return showTeamsUi
    ? profile.consumers
    : profile.consumers.filter((consumer) => consumer !== 'Teams');
}

function getBindingWarning(
  consumerLabel: string,
  binding: MicrosoftConsumerBinding | undefined,
  profile: MicrosoftProfile | undefined,
  t: TranslateFn
): string | null {
  if (!binding || !binding.profileId) {
    return t('integrations.microsoft.settings.bindings.warningNoBinding', { defaultValue: 'No {{consumer}} binding is configured yet.', consumer: consumerLabel });
  }

  if (!profile) {
    return t('integrations.microsoft.settings.bindings.warningProfileMissing', { defaultValue: '{{consumer}} is bound to a profile that is no longer available. Rebind it to an active profile.', consumer: consumerLabel });
  }

  if (profile.isArchived) {
    return t('integrations.microsoft.settings.bindings.warningArchived', { defaultValue: '{{consumer}} is still bound to an archived profile. Rebind it to an active profile.', consumer: consumerLabel });
  }

  if (!profile.readiness.ready) {
    return t('integrations.microsoft.settings.bindings.warningNotReady', { defaultValue: '{{consumer}} is bound to {{profile}}, but that profile still needs configuration.', consumer: consumerLabel, profile: profile.displayName });
  }

  return null;
}

function getBindingSummary(
  consumerLabel: string,
  binding: MicrosoftConsumerBinding | undefined,
  profile: MicrosoftProfile | undefined,
  t: TranslateFn
): string {
  if (!binding || !binding.profileId) {
    return t('integrations.microsoft.settings.bindings.summaryNone', { defaultValue: 'No Microsoft profile is currently bound to {{consumer}}.', consumer: consumerLabel });
  }

  if (!profile) {
    return t('integrations.microsoft.settings.bindings.summaryUnavailable', { defaultValue: '{{consumer}} is bound to an unavailable profile.', consumer: consumerLabel });
  }

  return t('integrations.microsoft.settings.bindings.summaryBound', { defaultValue: '{{consumer}} is bound to {{profile}}.', consumer: consumerLabel, profile: profile.displayName });
}

function getGuidanceBlocks(
  status: MicrosoftIntegrationStatus | null,
  profile: MicrosoftProfile,
  showTeamsUi: boolean,
  t: TranslateFn
) {
  const teamsApplicationIdUri = showTeamsUi
    ? getTeamsApplicationIdUri(status?.baseUrl, profile.clientId)
    : null;
  const unavailable = t('integrations.microsoft.settings.guidance.unavailable', { defaultValue: 'Unavailable' });
  const notConfigured = t('integrations.microsoft.settings.guidance.notConfigured', { defaultValue: 'Not configured' });

  const blocks: Array<{ title: string; items: Array<{ label: string; value: string }> }> = [
    {
      title: t('integrations.microsoft.settings.guidance.mspSsoTitle', { defaultValue: 'MSP SSO Guidance' }),
      items: [
        { label: t('integrations.microsoft.settings.guidance.redirectUri', { defaultValue: 'Redirect URI' }), value: status?.redirectUris?.sso || unavailable },
        { label: t('integrations.microsoft.settings.guidance.scopes', { defaultValue: 'Scopes' }), value: (status?.scopes?.sso || []).join(', ') || unavailable },
      ],
    },
  ];

  if (isMicrosoftConsumerEnterpriseEdition()) {
    blocks.push(
      {
        title: t('integrations.microsoft.settings.guidance.emailTitle', { defaultValue: 'Email Guidance' }),
        items: [
          { label: t('integrations.microsoft.settings.guidance.emailRedirect', { defaultValue: 'Inbound email redirect URI' }), value: status?.redirectUris?.email || unavailable },
          { label: t('integrations.microsoft.settings.guidance.scopes', { defaultValue: 'Scopes' }), value: (status?.scopes?.email || []).join(', ') || unavailable },
        ],
      },
      {
        title: t('integrations.microsoft.settings.guidance.calendarTitle', { defaultValue: 'Calendar Guidance' }),
        items: [
          { label: t('integrations.microsoft.settings.guidance.calendarRedirect', { defaultValue: 'Calendar sync redirect URI' }), value: status?.redirectUris?.calendar || unavailable },
          { label: t('integrations.microsoft.settings.guidance.scopes', { defaultValue: 'Scopes' }), value: (status?.scopes?.calendar || []).join(', ') || unavailable },
        ],
      }
    );
  }

  if (showTeamsUi) {
    blocks.push({
      title: t('integrations.microsoft.settings.guidance.teamsTitle', { defaultValue: 'Teams Guidance' }),
      items: [
        { label: t('integrations.microsoft.settings.guidance.teamsTabRedirect', { defaultValue: 'Personal tab redirect URI' }), value: status?.redirectUris?.teamsTab || unavailable },
        { label: t('integrations.microsoft.settings.guidance.teamsBotRedirect', { defaultValue: 'Personal bot redirect URI' }), value: status?.redirectUris?.teamsBot || unavailable },
        {
          label: t('integrations.microsoft.settings.guidance.teamsMessageRedirect', { defaultValue: 'Message extension redirect URI' }),
          value: status?.redirectUris?.teamsMessageExtension || unavailable,
        },
        { label: t('integrations.microsoft.settings.guidance.teamsScopes', { defaultValue: 'Teams scopes' }), value: (status?.scopes?.teams || []).join(', ') || unavailable },
        { label: t('integrations.microsoft.settings.guidance.applicationIdUri', { defaultValue: 'Application ID URI' }), value: teamsApplicationIdUri || t('integrations.microsoft.settings.guidance.requiresBaseUrl', { defaultValue: 'Requires base URL and client ID' }) },
      ],
    });
  }

  blocks.push({
    title: t('integrations.microsoft.settings.guidance.currentProfileTitle', { defaultValue: 'Current Profile Values' }),
    items: [
      { label: t('integrations.microsoft.settings.guidance.clientId', { defaultValue: 'Client ID' }), value: profile.clientId || notConfigured },
      { label: t('integrations.microsoft.settings.guidance.tenantId', { defaultValue: 'Tenant ID' }), value: profile.tenantId },
    ],
  });

  return blocks;
}

export function MicrosoftIntegrationSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const teamsUiFlag = useFeatureFlag('teams-integration-ui', { defaultValue: false });
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [settingDefaultId, setSettingDefaultId] = React.useState<string | null>(null);
  const [savingBindingConsumer, setSavingBindingConsumer] = React.useState<MicrosoftConsumerType | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<MicrosoftIntegrationStatus | null>(null);
  const [bindings, setBindings] = React.useState<MicrosoftConsumerBinding[]>([]);
  const [dialogMode, setDialogMode] = React.useState<ProfileDialogMode | null>(null);
  const [editingProfile, setEditingProfile] = React.useState<MicrosoftProfile | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<MicrosoftProfile | null>(null);
  const [isArchiving, setIsArchiving] = React.useState(false);
  const [formState, setFormState] = React.useState<ProfileFormState>(DEFAULT_FORM_STATE);
  const [formError, setFormError] = React.useState<string | null>(null);

  const isEnterpriseEdition = isMicrosoftConsumerEnterpriseEdition();
  const profiles = status?.success ? status.profiles ?? [] : [];
  const hasProfiles = profiles.length > 0;
  const activeProfiles = profiles.filter((profile) => !profile.isArchived);
  const profileById = React.useMemo(
    () => new Map(profiles.map((profile) => [profile.profileId, profile])),
    [profiles]
  );
  const bindingByConsumer = React.useMemo(
    () => new Map(bindings.map((binding) => [binding.consumerType, binding])),
    [bindings]
  );
  const teamsAvailability = resolveTeamsAvailability({
    flagEnabled: teamsUiFlag.enabled,
    isEnterpriseEdition,
    requireTenantContext: false,
  });
  const showTeamsUi = teamsAvailability.enabled;
  const consumerDescriptors = React.useMemo(
    () => getConsumerDescriptors(showTeamsUi, t),
    [showTeamsUi, t]
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    const [statusResult, bindingsResult] = await Promise.all([
      getMicrosoftIntegrationStatus(),
      listMicrosoftConsumerBindings(),
    ]);

    setStatus(statusResult);

    if (!statusResult.success) {
      setBindings([]);
      setError(statusResult.error || t('integrations.microsoft.settings.errors.loadStatus', { defaultValue: 'Failed to load Microsoft settings' }));
      setLoading(false);
      return;
    }

    if (!bindingsResult.success) {
      setBindings([]);
      setError(bindingsResult.error || t('integrations.microsoft.settings.errors.loadBindings', { defaultValue: 'Failed to load Microsoft bindings' }));
      setLoading(false);
      return;
    }

    setBindings(bindingsResult.bindings ?? []);
    setLoading(false);
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const closeDialog = React.useCallback(() => {
    setDialogMode(null);
    setEditingProfile(null);
    setFormState(DEFAULT_FORM_STATE);
    setFormError(null);
  }, []);

  const openCreateDialog = React.useCallback(() => {
    setDialogMode('create');
    setEditingProfile(null);
    setFormError(null);
    setFormState({
      ...DEFAULT_FORM_STATE,
      tenantId: status?.config?.tenantId || 'common',
      setAsDefault: !profiles.some((profile) => profile.isDefault && !profile.isArchived),
    });
  }, [profiles, status?.config?.tenantId]);

  const openEditDialog = React.useCallback((profile: MicrosoftProfile) => {
    setDialogMode('edit');
    setEditingProfile(profile);
    setFormError(null);
    setFormState({
      displayName: profile.displayName,
      clientId: profile.clientId || '',
      clientSecret: '',
      tenantId: profile.tenantId || 'common',
      setAsDefault: profile.isDefault,
    });
  }, []);

  const setFormValue = React.useCallback(
    <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) => {
      setFormState((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const validateForm = React.useCallback(() => {
    if (!formState.displayName.trim()) return t('integrations.microsoft.settings.validation.displayNameRequired', { defaultValue: 'Microsoft profile display name is required' });
    if (!formState.clientId.trim()) return t('integrations.microsoft.settings.validation.clientIdRequired', { defaultValue: 'Microsoft OAuth Client ID is required' });
    if (!formState.tenantId.trim()) return t('integrations.microsoft.settings.validation.tenantIdRequired', { defaultValue: 'Microsoft Tenant ID is required' });
    if (dialogMode === 'create' && !formState.clientSecret.trim()) {
      return t('integrations.microsoft.settings.validation.clientSecretRequired', { defaultValue: 'Microsoft OAuth Client Secret is required' });
    }

    return null;
  }, [dialogMode, formState.clientId, formState.clientSecret, formState.displayName, formState.tenantId, t]);

  const handleSave = React.useCallback(async () => {
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    try {
      setSaving(true);
      setFormError(null);

      const payload = {
        displayName: formState.displayName,
        clientId: formState.clientId,
        clientSecret: formState.clientSecret,
        tenantId: formState.tenantId,
      };

      const result =
        dialogMode === 'create'
          ? await createMicrosoftProfile({
              ...payload,
              setAsDefault: formState.setAsDefault,
            })
          : await updateMicrosoftProfile({
              profileId: editingProfile?.profileId || '',
              ...payload,
            });

      if (!result.success) {
        const message = result.error || t('integrations.microsoft.settings.errors.saveProfile', { defaultValue: 'Failed to save Microsoft profile' });
        setFormError(message);
        toast({
          title: t('integrations.microsoft.settings.toasts.saveFailedTitle', { defaultValue: 'Unable to save Microsoft profile' }),
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: dialogMode === 'create'
          ? t('integrations.microsoft.settings.toasts.profileCreated', { defaultValue: 'Microsoft profile created' })
          : t('integrations.microsoft.settings.toasts.profileUpdated', { defaultValue: 'Microsoft profile updated' }),
        description:
          dialogMode === 'create'
            ? t('integrations.microsoft.settings.toasts.profileCreatedDescription', { defaultValue: 'The Microsoft profile is ready to be bound to visible Microsoft consumers.' })
            : t('integrations.microsoft.settings.toasts.profileUpdatedDescription', { defaultValue: 'The Microsoft profile changes were saved successfully.' }),
      });
      closeDialog();
      await load();
    } finally {
      setSaving(false);
    }
  }, [closeDialog, dialogMode, editingProfile?.profileId, formState, load, toast, validateForm, t]);

  const handleArchive = React.useCallback(async () => {
    if (!archiveTarget) {
      return;
    }

    try {
      setIsArchiving(true);

      const result = await archiveMicrosoftProfile(archiveTarget.profileId);
      if (!result.success) {
        const message = result.error || t('integrations.microsoft.settings.errors.archive', { defaultValue: 'Failed to archive Microsoft profile' });
        setError(message);
        toast({
          title: t('integrations.microsoft.settings.toasts.archiveFailedTitle', { defaultValue: 'Unable to archive Microsoft profile' }),
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: t('integrations.microsoft.settings.toasts.archivedTitle', { defaultValue: 'Microsoft profile archived' }),
        description: t('integrations.microsoft.settings.toasts.archivedDescription', { defaultValue: '{{name}} was archived successfully.', name: archiveTarget.displayName }),
      });
      setArchiveTarget(null);
      await load();
    } finally {
      setIsArchiving(false);
    }
  }, [archiveTarget, load, toast, t]);

  const handleSetDefault = React.useCallback(
    async (profile: MicrosoftProfile) => {
      try {
        setSettingDefaultId(profile.profileId);
        const result = await setDefaultMicrosoftProfile(profile.profileId);
        if (!result.success) {
          const message = result.error || t('integrations.microsoft.settings.errors.setDefault', { defaultValue: 'Failed to set default Microsoft profile' });
          setError(message);
          toast({
            title: t('integrations.microsoft.settings.toasts.setDefaultFailedTitle', { defaultValue: 'Unable to set default profile' }),
            description: message,
            variant: 'destructive',
          });
          return;
        }

        toast({
          title: t('integrations.microsoft.settings.toasts.defaultUpdatedTitle', { defaultValue: 'Default Microsoft profile updated' }),
          description: t('integrations.microsoft.settings.toasts.defaultUpdatedDescription', { defaultValue: '{{name}} is now the default Microsoft profile record.', name: profile.displayName }),
        });
        await load();
      } finally {
        setSettingDefaultId(null);
      }
    },
    [load, toast, t]
  );

  const handleResetProviders = React.useCallback(async () => {
    try {
      setResetting(true);
      const result = await resetMicrosoftProvidersToDisconnected();
      if (!result.success) {
        const message = result.error || t('integrations.microsoft.settings.errors.resetProviders', { defaultValue: 'Failed to reset Microsoft providers' });
        setError(message);
        toast({
          title: t('integrations.microsoft.settings.toasts.resetFailedTitle', { defaultValue: 'Reset failed' }),
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: t('integrations.microsoft.settings.toasts.resetTitle', { defaultValue: 'Microsoft providers reset' }),
        description: t('integrations.microsoft.settings.toasts.resetDescription', { defaultValue: 'Existing Outlook email and calendar connections now require re-authorization.' }),
      });
      await load();
    } finally {
      setResetting(false);
    }
  }, [load, toast, t]);

  const handleBindingChange = React.useCallback(
    async (consumer: MicrosoftConsumerDescriptor, profileId: string) => {
      if (!profileId) {
        return;
      }

      const currentBinding = bindingByConsumer.get(consumer.consumerType);
      if (currentBinding?.profileId === profileId) {
        return;
      }

      try {
        setSavingBindingConsumer(consumer.consumerType);
        const result = await setMicrosoftConsumerBinding({
          consumerType: consumer.consumerType,
          profileId,
        });

        if (!result.success) {
          const message = result.error || t('integrations.microsoft.settings.errors.updateBinding', { defaultValue: 'Failed to update Microsoft binding' });
          setError(message);
          toast({
            title: t('integrations.microsoft.settings.toasts.bindingFailedTitle', { defaultValue: 'Unable to update {{consumer}} binding', consumer: consumer.consumerLabel }),
            description: message,
            variant: 'destructive',
          });
          return;
        }

        const reconnectMessage = consumer.reconnectMessage
          ? ` ${consumer.reconnectMessage}`
          : '';
        const profileLabel = result.binding?.profileDisplayName || t('integrations.microsoft.settings.toasts.selectedProfile', { defaultValue: 'the selected profile' });
        toast({
          title: t('integrations.microsoft.settings.toasts.bindingUpdatedTitle', { defaultValue: '{{consumer}} binding updated', consumer: consumer.consumerLabel }),
          description: `${t('integrations.microsoft.settings.toasts.bindingUpdatedDescription', { defaultValue: '{{consumer}} now uses {{profile}}.', consumer: consumer.consumerLabel, profile: profileLabel })}${reconnectMessage}`,
        });
        await load();
      } finally {
        setSavingBindingConsumer(null);
      }
    },
    [bindingByConsumer, load, toast, t]
  );

  const dialogTitle = dialogMode === 'create'
    ? t('integrations.microsoft.settings.dialog.createTitle', { defaultValue: 'Create Microsoft Profile' })
    : t('integrations.microsoft.settings.dialog.editTitle', { defaultValue: 'Edit Microsoft Profile' });
  const currentSecretMasked = editingProfile?.clientSecretMasked;

  return (
    <>
      <Card id="microsoft-profile-manager">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <CardTitle>{t('integrations.microsoft.settings.title', { defaultValue: 'Microsoft' })}</CardTitle>
              <CardDescription>
                {isEnterpriseEdition
                  ? t('integrations.microsoft.settings.descriptionEe', { defaultValue: 'Manage tenant-owned Microsoft profiles for MSP SSO, Outlook email, calendar sync, and Microsoft Teams.' })
                  : t('integrations.microsoft.settings.descriptionCe', { defaultValue: 'Manage tenant-owned Microsoft profiles for MSP SSO, Microsoft sign-in, and login-domain discovery.' })}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                id="microsoft-entra-console-link"
                type="button"
                variant="outline"
                onClick={() => window.open('https://entra.microsoft.com/', '_blank')}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('integrations.microsoft.settings.actions.entraLink', { defaultValue: 'Microsoft Entra' })}
              </Button>
              {showTeamsUi && (
                <Button
                  id="microsoft-open-teams-setup"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    window.location.hash = 'teams-integration-settings';
                  }}
                >
                  {t('integrations.microsoft.settings.actions.openTeamsSetup', { defaultValue: 'Open Teams Setup' })}
                </Button>
              )}
              <Button
                id="microsoft-settings-refresh"
                type="button"
                variant="outline"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('integrations.microsoft.settings.actions.refresh', { defaultValue: 'Refresh' })}
              </Button>
              <Button id="microsoft-settings-add-profile" type="button" onClick={openCreateDialog} disabled={loading}>
                <Plus className="mr-2 h-4 w-4" />
                {t('integrations.microsoft.settings.actions.newProfile', { defaultValue: 'New Profile' })}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              {isEnterpriseEdition
                ? t('integrations.microsoft.settings.bindingsAlertEe', { defaultValue: 'Explicit bindings are the source of truth for MSP SSO, email, calendar, and Teams profile selection.' })
                : t('integrations.microsoft.settings.bindingsAlertCe', { defaultValue: 'Explicit bindings are the source of truth for MSP SSO profile selection. Configure login domains separately after choosing the bound profile.' })}
            </AlertDescription>
          </Alert>

          {isEnterpriseEdition && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-medium">{t('integrations.microsoft.settings.providerReconnect.title', { defaultValue: 'Provider reconnection' })}</div>
                  <div className="text-sm text-muted-foreground">
                    {t('integrations.microsoft.settings.providerReconnect.description', { defaultValue: 'Use this if you rotate credentials or intentionally rebind Outlook email or calendar to a different Microsoft profile.' })}
                  </div>
                </div>
                <Button
                  id="microsoft-settings-reset-providers"
                  type="button"
                  variant="destructive"
                  onClick={handleResetProviders}
                  disabled={resetting}
                >
                  {resetting
                    ? t('integrations.microsoft.settings.actions.resetting', { defaultValue: 'Resetting…' })
                    : t('integrations.microsoft.settings.actions.resetProviders', { defaultValue: 'Reset Microsoft Providers' })}
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-lg border bg-muted/10 p-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">{t('integrations.microsoft.settings.consumerBindings.title', { defaultValue: 'Explicit consumer bindings' })}</div>
              <div className="text-sm text-muted-foreground">
                {isEnterpriseEdition
                  ? t('integrations.microsoft.settings.consumerBindings.descriptionEe', { defaultValue: 'Bind one Microsoft profile per supported consumer. Reassigning one consumer does not change the others.' })
                  : t('integrations.microsoft.settings.consumerBindings.descriptionCe', { defaultValue: 'Bind one Microsoft profile to MSP SSO for sign-in and login-domain usage.' })}
              </div>
            </div>
            <div className="mt-4 space-y-4">
              {consumerDescriptors.map((consumer) => {
                const binding = bindingByConsumer.get(consumer.consumerType);
                const boundProfile = binding?.profileId ? profileById.get(binding.profileId) : undefined;
                const activeBoundProfile =
                  boundProfile && !boundProfile.isArchived ? boundProfile : undefined;
                const warning = getBindingWarning(consumer.consumerLabel, binding, boundProfile, t);
                const options = activeProfiles.map((profile) => ({
                  value: profile.profileId,
                  label: profile.displayName,
                }));

                return (
                  <div
                    key={consumer.consumerType}
                    id={`microsoft-consumer-binding-${consumer.consumerType}`}
                    className="rounded-lg border bg-background p-4"
                  >
                      <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium">{consumer.consumerLabel}</div>
                      </div>
                      <div className="text-sm text-muted-foreground">{consumer.description}</div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                      <CustomSelect
                        id={`microsoft-binding-select-${consumer.consumerType}`}
                        label={t('integrations.microsoft.settings.binding.boundProfileLabel', { defaultValue: 'Bound profile' })}
                        options={options}
                        value={activeBoundProfile?.profileId ?? ''}
                        onValueChange={(profileId) => void handleBindingChange(consumer, profileId)}
                        placeholder={
                          activeProfiles.length > 0
                            ? t('integrations.microsoft.settings.binding.selectProfile', { defaultValue: 'Select a profile' })
                            : t('integrations.microsoft.settings.binding.createFirst', { defaultValue: 'Create a profile first' })
                        }
                        disabled={savingBindingConsumer === consumer.consumerType || activeProfiles.length === 0}
                      />
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            warning ? 'warning' : binding?.profileId ? 'success' : 'secondary'
                          }
                        >
                          {savingBindingConsumer === consumer.consumerType
                            ? t('integrations.microsoft.settings.binding.saving', { defaultValue: 'Saving…' })
                            : warning
                              ? t('integrations.microsoft.settings.binding.needsAttention', { defaultValue: 'Needs attention' })
                              : binding?.profileId
                                ? t('integrations.microsoft.settings.binding.bound', { defaultValue: 'Bound' })
                                : t('integrations.microsoft.settings.binding.unbound', { defaultValue: 'Unbound' })}
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-muted-foreground">
                      {getBindingSummary(consumer.consumerLabel, binding, boundProfile, t)}
                    </div>

                    {warning && (
                      <Alert className="mt-3" variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>{warning}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : !hasProfiles ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <div className="text-lg font-semibold">{t('integrations.microsoft.settings.empty.title', { defaultValue: 'No Microsoft profiles yet' })}</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {isEnterpriseEdition
                  ? t('integrations.microsoft.settings.empty.descriptionEe', { defaultValue: 'Create a named profile first, then bind it explicitly to MSP SSO, Outlook email, calendar sync, and Teams.' })
                  : t('integrations.microsoft.settings.empty.descriptionCe', { defaultValue: 'Create a named profile first, then bind it explicitly to MSP SSO and login-domain sign-in flows.' })}
              </div>
              <Button className="mt-4" id="microsoft-empty-state-create" type="button" onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" />
                {t('integrations.microsoft.settings.empty.createButton', { defaultValue: 'Create Microsoft Profile' })}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {profiles.map((profile) => {
                const statusBadge = getProfileStatusBadge(profile, t);
                const readinessMessages = getReadinessMessages(profile, t);
                const visibleConsumers = getVisibleProfileConsumers(profile, showTeamsUi);

                return (
                  <Card key={profile.profileId} id={`microsoft-profile-${profile.profileId}`}>
                    <CardHeader className="space-y-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="text-xl">{profile.displayName}</CardTitle>
                            {profile.isDefault && (
                              <Badge variant="info">
                                <Star className="mr-1 h-3 w-3" />
                                {t('integrations.microsoft.settings.profileCard.defaultBadge', { defaultValue: 'Default' })}
                              </Badge>
                            )}
                            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                          </div>
                          <CardDescription>
                            {t('integrations.microsoft.settings.profileCard.tenantIdLabel', { defaultValue: 'Tenant ID:' })} <span className="font-mono text-xs">{profile.tenantId}</span>
                          </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            id={`microsoft-profile-edit-${profile.profileId}`}
                            type="button"
                            variant="outline"
                            onClick={() => openEditDialog(profile)}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            {t('integrations.microsoft.settings.profileCard.edit', { defaultValue: 'Edit' })}
                          </Button>
                          {!profile.isDefault && !profile.isArchived && (
                            <Button
                              id={`microsoft-profile-default-${profile.profileId}`}
                              type="button"
                              variant="outline"
                              onClick={() => void handleSetDefault(profile)}
                              disabled={settingDefaultId === profile.profileId}
                            >
                              <ShieldCheck className="mr-2 h-4 w-4" />
                              {settingDefaultId === profile.profileId
                                ? t('integrations.microsoft.settings.profileCard.updating', { defaultValue: 'Updating…' })
                                : t('integrations.microsoft.settings.profileCard.setDefault', { defaultValue: 'Set Default' })}
                            </Button>
                          )}
                          {!profile.isArchived && (
                            <Button
                              id={`microsoft-profile-archive-${profile.profileId}`}
                              type="button"
                              variant="destructive"
                              onClick={() => setArchiveTarget(profile)}
                            >
                              <Archive className="mr-2 h-4 w-4" />
                              {t('integrations.microsoft.settings.profileCard.archive', { defaultValue: 'Archive' })}
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div
                        className={`grid gap-4 md:grid-cols-2 ${showTeamsUi ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}
                      >
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {t('integrations.microsoft.settings.profileCard.clientId', { defaultValue: 'Client ID' })}
                          </div>
                          <div className="mt-2 break-all font-mono text-xs">
                            {profile.clientId || t('integrations.microsoft.settings.guidance.notConfigured', { defaultValue: 'Not configured' })}
                          </div>
                        </div>
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {t('integrations.microsoft.settings.profileCard.storedSecret', { defaultValue: 'Stored secret' })}
                          </div>
                          <div className="mt-2 font-mono text-xs">
                            {profile.clientSecretMasked || t('integrations.microsoft.settings.guidance.notConfigured', { defaultValue: 'Not configured' })}
                          </div>
                        </div>
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {t('integrations.microsoft.settings.profileCard.activeBindings', { defaultValue: 'Active bindings' })}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {visibleConsumers.length > 0 ? (
                              visibleConsumers.map((consumer) => (
                                <Badge key={`${profile.profileId}-${consumer}`} variant="outline">
                                  {consumer}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">{t('integrations.microsoft.settings.profileCard.noVisibleBindings', { defaultValue: 'No visible consumer bindings' })}</span>
                            )}
                          </div>
                        </div>
                        {showTeamsUi && (
                          <div className="rounded-lg border bg-muted/10 p-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {t('integrations.microsoft.settings.profileCard.teamsAppIdUri', { defaultValue: 'Teams application ID URI' })}
                            </div>
                            <div className="mt-2 break-all font-mono text-xs">
                              {getTeamsApplicationIdUri(status?.baseUrl, profile.clientId) ||
                                t('integrations.microsoft.settings.guidance.requiresBaseUrl', { defaultValue: 'Requires base URL and client ID' })}
                            </div>
                          </div>
                        )}
                      </div>

                      {readinessMessages.length > 0 ? (
                        <Alert variant={profile.isArchived ? 'default' : 'destructive'}>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            <div className="font-medium">{t('integrations.microsoft.settings.profileCard.readinessTitle', { defaultValue: 'Profile readiness' })}</div>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                              {readinessMessages.map((message) => (
                                <li key={`${profile.profileId}-${message}`}>{message}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <Alert>
                          <CheckCircle2 className="h-4 w-4" />
                          <AlertDescription>
                            {isEnterpriseEdition
                              ? showTeamsUi
                                ? t('integrations.microsoft.settings.profileCard.readyEeTeams', { defaultValue: 'This profile is ready for MSP SSO, Outlook email, calendar sync, and Teams bindings.' })
                                : t('integrations.microsoft.settings.profileCard.readyEe', { defaultValue: 'This profile is ready for MSP SSO, Outlook email, and calendar bindings.' })
                              : t('integrations.microsoft.settings.profileCard.readyCe', { defaultValue: 'This profile is ready for MSP SSO binding and login-domain sign-in flows.' })}
                          </AlertDescription>
                        </Alert>
                      )}

                      <details className="rounded-lg border p-4">
                        <summary className="cursor-pointer text-sm font-medium">
                          {t('integrations.microsoft.settings.profileCard.guidanceSummary', { defaultValue: 'Microsoft app registration guidance' })}
                        </summary>
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          {getGuidanceBlocks(status, profile, showTeamsUi, t).map((block) => (
                            <GuidanceBlock key={`${profile.profileId}-${block.title}`} title={block.title} items={block.items} />
                          ))}
                        </div>
                      </details>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        id="microsoft-profile-dialog"
        isOpen={dialogMode !== null}
        onClose={closeDialog}
        title={dialogTitle}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              id="microsoft-profile-cancel"
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={saving}
            >
              {t('integrations.microsoft.settings.dialog.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="microsoft-profile-save" type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving
                ? t('integrations.microsoft.settings.dialog.saving', { defaultValue: 'Saving…' })
                : dialogMode === 'create'
                  ? t('integrations.microsoft.settings.dialog.createProfile', { defaultValue: 'Create Profile' })
                  : t('integrations.microsoft.settings.dialog.saveChanges', { defaultValue: 'Save Changes' })}
            </Button>
          </div>
        }
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {dialogMode === 'create'
                ? t('integrations.microsoft.settings.dialog.descriptionCreate', { defaultValue: 'Create a tenant-owned Microsoft profile, then bind it explicitly to the Microsoft consumers you want to use.' })
                : t('integrations.microsoft.settings.dialog.descriptionEdit', { defaultValue: 'Update the selected Microsoft profile. Leave the secret blank to keep the existing value.' })}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="microsoft-profile-display-name">{t('integrations.microsoft.settings.dialog.displayName', { defaultValue: 'Display name' })}</Label>
              <Input
                id="microsoft-profile-display-name"
                value={formState.displayName}
                onChange={(event) => setFormValue('displayName', event.target.value)}
                placeholder={t('integrations.microsoft.settings.dialog.displayNamePlaceholder', { defaultValue: 'Acme production tenant' })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="microsoft-profile-client-id">{t('integrations.microsoft.settings.dialog.clientId', { defaultValue: 'Client ID' })}</Label>
              <Input
                id="microsoft-profile-client-id"
                value={formState.clientId}
                onChange={(event) => setFormValue('clientId', event.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="microsoft-profile-tenant-id">{t('integrations.microsoft.settings.dialog.tenantId', { defaultValue: 'Tenant ID' })}</Label>
              <Input
                id="microsoft-profile-tenant-id"
                value={formState.tenantId}
                onChange={(event) => setFormValue('tenantId', event.target.value)}
                placeholder="common"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="microsoft-profile-client-secret">{t('integrations.microsoft.settings.dialog.clientSecret', { defaultValue: 'Client secret' })}</Label>
              <Input
                id="microsoft-profile-client-secret"
                type="password"
                value={formState.clientSecret}
                onChange={(event) => setFormValue('clientSecret', event.target.value)}
                placeholder={
                  dialogMode === 'edit'
                    ? t('integrations.microsoft.settings.dialog.clientSecretPlaceholderEdit', { defaultValue: 'Leave blank to keep the current secret' })
                    : t('integrations.microsoft.settings.dialog.clientSecretPlaceholder', { defaultValue: 'Enter client secret' })
                }
              />
              {dialogMode === 'edit' && currentSecretMasked && (
                <p className="text-xs text-muted-foreground">
                  {t('integrations.microsoft.settings.dialog.storedSecretHint', { defaultValue: 'Stored secret: {{secret}}. Leave this field empty to keep it unchanged.', secret: currentSecretMasked })}
                </p>
              )}
            </div>

            {dialogMode === 'create' && (
              <div className="rounded-lg border bg-muted/10 p-3 md:col-span-2">
                <Switch
                  id="microsoft-profile-set-default"
                  checked={formState.setAsDefault}
                  onCheckedChange={(checked) => setFormValue('setAsDefault', checked)}
                  label={t('integrations.microsoft.settings.dialog.setDefault', { defaultValue: 'Set this profile as the default Microsoft profile' })}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('integrations.microsoft.settings.dialog.setDefaultHelp', { defaultValue: 'Default profiles stay available for profile-management workflows and migration-safe metadata, not consumer routing.' })}
                </p>
              </div>
            )}
          </div>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        id="microsoft-profile-archive-confirmation"
        isOpen={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        onConfirm={handleArchive}
        title={t('integrations.microsoft.settings.archiveDialog.title', { defaultValue: 'Archive Microsoft profile?' })}
        message={
          archiveTarget
            ? t('integrations.microsoft.settings.archiveDialog.message', { defaultValue: 'Archive {{name}}? Existing historical references stay intact, but the profile will no longer be available for new bindings.', name: archiveTarget.displayName })
            : ''
        }
        confirmLabel={isArchiving
          ? t('integrations.microsoft.settings.archiveDialog.archiving', { defaultValue: 'Archiving…' })
          : t('integrations.microsoft.settings.archiveDialog.confirm', { defaultValue: 'Archive Profile' })}
        cancelLabel={t('integrations.microsoft.settings.archiveDialog.cancel', { defaultValue: 'Keep Profile' })}
        isConfirming={isArchiving}
      />
    </>
  );
}
