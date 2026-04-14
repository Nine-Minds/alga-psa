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

function getReadinessMessages(profile: MicrosoftProfile): string[] {
  const messages: string[] = [];

  if (profile.isArchived) {
    messages.push('Archived profiles cannot be used for new Microsoft bindings.');
  }
  if (!profile.readiness.clientIdConfigured) {
    messages.push('Client ID is missing.');
  }
  if (!profile.readiness.clientSecretConfigured) {
    messages.push('Client secret has not been configured.');
  }
  if (!profile.readiness.tenantIdConfigured) {
    messages.push('Tenant ID is missing.');
  }

  return messages;
}

function getProfileStatusBadge(profile: MicrosoftProfile): {
  label: string;
  variant: 'success' | 'warning' | 'secondary';
} {
  if (profile.isArchived) {
    return { label: 'Archived', variant: 'secondary' };
  }

  if (profile.readiness.ready) {
    return { label: 'Ready', variant: 'success' };
  }

  return { label: 'Needs Attention', variant: 'warning' };
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

function getConsumerDescriptors(showTeamsUi: boolean): MicrosoftConsumerDescriptor[] {
  const visibleConsumers = getVisibleMicrosoftConsumerTypes(isMicrosoftConsumerEnterpriseEdition()).filter(
    (consumerType) => showTeamsUi || consumerType !== 'teams'
  );

  return visibleConsumers.map((consumerType) => {
    switch (consumerType) {
      case 'msp_sso':
        return {
          consumerType,
          consumerLabel: 'MSP SSO',
          description:
            'Choose which Microsoft profile backs MSP SSO login domains, Microsoft sign-in, and tenant discovery.',
        };
      case 'email':
        return {
          consumerType,
          consumerLabel: 'Email',
          description: 'Choose which Microsoft profile Outlook inbound email should use.',
          reconnectMessage:
            'Existing Outlook email connections may need re-authorization after changing the bound profile.',
        };
      case 'calendar':
        return {
          consumerType,
          consumerLabel: 'Calendar',
          description: 'Choose which Microsoft profile Outlook calendar sync should use.',
          reconnectMessage:
            'Existing Microsoft calendar connections may need re-authorization after changing the bound profile.',
        };
      case 'teams':
        return {
          consumerType,
          consumerLabel: 'Teams',
          description: 'Choose which Microsoft profile Microsoft Teams installation and auth flows should use.',
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
  profile: MicrosoftProfile | undefined
): string | null {
  if (!binding || !binding.profileId) {
    return `No ${consumerLabel} binding is configured yet.`;
  }

  if (!profile) {
    return `${consumerLabel} is bound to a profile that is no longer available. Rebind it to an active profile.`;
  }

  if (profile.isArchived) {
    return `${consumerLabel} is still bound to an archived profile. Rebind it to an active profile.`;
  }

  if (!profile.readiness.ready) {
    return `${consumerLabel} is bound to ${profile.displayName}, but that profile still needs configuration.`;
  }

  return null;
}

function getBindingSummary(
  consumerLabel: string,
  binding: MicrosoftConsumerBinding | undefined,
  profile: MicrosoftProfile | undefined
): string {
  if (!binding || !binding.profileId) {
    return `No Microsoft profile is currently bound to ${consumerLabel}.`;
  }

  if (!profile) {
    return `${consumerLabel} is bound to an unavailable profile.`;
  }

  return `${consumerLabel} is bound to ${profile.displayName}.`;
}

function getGuidanceBlocks(
  status: MicrosoftIntegrationStatus | null,
  profile: MicrosoftProfile,
  showTeamsUi: boolean
) {
  const teamsApplicationIdUri = showTeamsUi
    ? getTeamsApplicationIdUri(status?.baseUrl, profile.clientId)
    : null;

  const blocks: Array<{ title: string; items: Array<{ label: string; value: string }> }> = [
    {
      title: 'MSP SSO Guidance',
      items: [
        { label: 'Redirect URI', value: status?.redirectUris?.sso || 'Unavailable' },
        { label: 'Scopes', value: (status?.scopes?.sso || []).join(', ') || 'Unavailable' },
      ],
    },
  ];

  if (isMicrosoftConsumerEnterpriseEdition()) {
    blocks.push(
      {
        title: 'Email Guidance',
        items: [
          { label: 'Inbound email redirect URI', value: status?.redirectUris?.email || 'Unavailable' },
          { label: 'Scopes', value: (status?.scopes?.email || []).join(', ') || 'Unavailable' },
        ],
      },
      {
        title: 'Calendar Guidance',
        items: [
          { label: 'Calendar sync redirect URI', value: status?.redirectUris?.calendar || 'Unavailable' },
          { label: 'Scopes', value: (status?.scopes?.calendar || []).join(', ') || 'Unavailable' },
        ],
      }
    );
  }

  if (showTeamsUi) {
    blocks.push({
      title: 'Teams Guidance',
      items: [
        { label: 'Personal tab redirect URI', value: status?.redirectUris?.teamsTab || 'Unavailable' },
        { label: 'Personal bot redirect URI', value: status?.redirectUris?.teamsBot || 'Unavailable' },
        {
          label: 'Message extension redirect URI',
          value: status?.redirectUris?.teamsMessageExtension || 'Unavailable',
        },
        { label: 'Teams scopes', value: (status?.scopes?.teams || []).join(', ') || 'Unavailable' },
        { label: 'Application ID URI', value: teamsApplicationIdUri || 'Requires base URL and client ID' },
      ],
    });
  }

  blocks.push({
    title: 'Current Profile Values',
    items: [
      { label: 'Client ID', value: profile.clientId || 'Not configured' },
      { label: 'Tenant ID', value: profile.tenantId },
    ],
  });

  return blocks;
}

export function MicrosoftIntegrationSettings() {
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
    () => getConsumerDescriptors(showTeamsUi),
    [showTeamsUi]
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
      setError(statusResult.error || 'Failed to load Microsoft settings');
      setLoading(false);
      return;
    }

    if (!bindingsResult.success) {
      setBindings([]);
      setError(bindingsResult.error || 'Failed to load Microsoft bindings');
      setLoading(false);
      return;
    }

    setBindings(bindingsResult.bindings ?? []);
    setLoading(false);
  }, []);

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
    if (!formState.displayName.trim()) return 'Microsoft profile display name is required';
    if (!formState.clientId.trim()) return 'Microsoft OAuth Client ID is required';
    if (!formState.tenantId.trim()) return 'Microsoft Tenant ID is required';
    if (dialogMode === 'create' && !formState.clientSecret.trim()) {
      return 'Microsoft OAuth Client Secret is required';
    }

    return null;
  }, [dialogMode, formState.clientId, formState.clientSecret, formState.displayName, formState.tenantId]);

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
        const message = result.error || 'Failed to save Microsoft profile';
        setFormError(message);
        toast({
          title: 'Unable to save Microsoft profile',
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: dialogMode === 'create' ? 'Microsoft profile created' : 'Microsoft profile updated',
        description:
          dialogMode === 'create'
            ? 'The Microsoft profile is ready to be bound to visible Microsoft consumers.'
            : 'The Microsoft profile changes were saved successfully.',
      });
      closeDialog();
      await load();
    } finally {
      setSaving(false);
    }
  }, [closeDialog, dialogMode, editingProfile?.profileId, formState, load, toast, validateForm]);

  const handleArchive = React.useCallback(async () => {
    if (!archiveTarget) {
      return;
    }

    try {
      setIsArchiving(true);

      const result = await archiveMicrosoftProfile(archiveTarget.profileId);
      if (!result.success) {
        const message = result.error || 'Failed to archive Microsoft profile';
        setError(message);
        toast({
          title: 'Unable to archive Microsoft profile',
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Microsoft profile archived',
        description: `${archiveTarget.displayName} was archived successfully.`,
      });
      setArchiveTarget(null);
      await load();
    } finally {
      setIsArchiving(false);
    }
  }, [archiveTarget, load, toast]);

  const handleSetDefault = React.useCallback(
    async (profile: MicrosoftProfile) => {
      try {
        setSettingDefaultId(profile.profileId);
        const result = await setDefaultMicrosoftProfile(profile.profileId);
        if (!result.success) {
          const message = result.error || 'Failed to set default Microsoft profile';
          setError(message);
          toast({
            title: 'Unable to set default profile',
            description: message,
            variant: 'destructive',
          });
          return;
        }

        toast({
          title: 'Default Microsoft profile updated',
          description: `${profile.displayName} is now the default Microsoft profile record.`,
        });
        await load();
      } finally {
        setSettingDefaultId(null);
      }
    },
    [load, toast]
  );

  const handleResetProviders = React.useCallback(async () => {
    try {
      setResetting(true);
      const result = await resetMicrosoftProvidersToDisconnected();
      if (!result.success) {
        const message = result.error || 'Failed to reset Microsoft providers';
        setError(message);
        toast({
          title: 'Reset failed',
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Microsoft providers reset',
        description: 'Existing Outlook email and calendar connections now require re-authorization.',
      });
      await load();
    } finally {
      setResetting(false);
    }
  }, [load, toast]);

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
          const message = result.error || 'Failed to update Microsoft binding';
          setError(message);
          toast({
            title: `Unable to update ${consumer.consumerLabel} binding`,
            description: message,
            variant: 'destructive',
          });
          return;
        }

        const reconnectMessage = consumer.reconnectMessage
          ? ` ${consumer.reconnectMessage}`
          : '';
        toast({
          title: `${consumer.consumerLabel} binding updated`,
          description: `${consumer.consumerLabel} now uses ${result.binding?.profileDisplayName || 'the selected profile'}.${reconnectMessage}`,
        });
        await load();
      } finally {
        setSavingBindingConsumer(null);
      }
    },
    [bindingByConsumer, load, toast]
  );

  const dialogTitle = dialogMode === 'create' ? 'Create Microsoft Profile' : 'Edit Microsoft Profile';
  const currentSecretMasked = editingProfile?.clientSecretMasked;

  return (
    <>
      <Card id="microsoft-profile-manager">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <CardTitle>Microsoft</CardTitle>
              <CardDescription>
                {isEnterpriseEdition
                  ? 'Manage tenant-owned Microsoft profiles for MSP SSO, Outlook email, calendar sync, and Microsoft Teams.'
                  : 'Manage tenant-owned Microsoft profiles for MSP SSO, Microsoft sign-in, and login-domain discovery.'}
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
                Microsoft Entra
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
                  Open Teams Setup
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
                Refresh
              </Button>
              <Button id="microsoft-settings-add-profile" type="button" onClick={openCreateDialog} disabled={loading}>
                <Plus className="mr-2 h-4 w-4" />
                New Profile
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
                ? 'Explicit bindings are the source of truth for MSP SSO, email, calendar, and Teams profile selection.'
                : 'Explicit bindings are the source of truth for MSP SSO profile selection. Configure login domains separately after choosing the bound profile.'}
            </AlertDescription>
          </Alert>

          {isEnterpriseEdition && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-medium">Provider reconnection</div>
                  <div className="text-sm text-muted-foreground">
                    Use this if you rotate credentials or intentionally rebind Outlook email or calendar to a different Microsoft profile.
                  </div>
                </div>
                <Button
                  id="microsoft-settings-reset-providers"
                  type="button"
                  variant="destructive"
                  onClick={handleResetProviders}
                  disabled={resetting}
                >
                  {resetting ? 'Resetting…' : 'Reset Microsoft Providers'}
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-lg border bg-muted/10 p-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">Explicit consumer bindings</div>
              <div className="text-sm text-muted-foreground">
                {isEnterpriseEdition
                  ? 'Bind one Microsoft profile per supported consumer. Reassigning one consumer does not change the others.'
                  : 'Bind one Microsoft profile to MSP SSO for sign-in and login-domain usage.'}
              </div>
            </div>
            <div className="mt-4 space-y-4">
              {consumerDescriptors.map((consumer) => {
                const binding = bindingByConsumer.get(consumer.consumerType);
                const boundProfile = binding?.profileId ? profileById.get(binding.profileId) : undefined;
                const activeBoundProfile =
                  boundProfile && !boundProfile.isArchived ? boundProfile : undefined;
                const warning = getBindingWarning(consumer.consumerLabel, binding, boundProfile);
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
                        label="Bound profile"
                        options={options}
                        value={activeBoundProfile?.profileId ?? ''}
                        onValueChange={(profileId) => void handleBindingChange(consumer, profileId)}
                        placeholder={activeProfiles.length > 0 ? 'Select a profile' : 'Create a profile first'}
                        disabled={savingBindingConsumer === consumer.consumerType || activeProfiles.length === 0}
                      />
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            warning ? 'warning' : binding?.profileId ? 'success' : 'secondary'
                          }
                        >
                          {savingBindingConsumer === consumer.consumerType
                            ? 'Saving…'
                            : warning
                              ? 'Needs attention'
                              : binding?.profileId
                                ? 'Bound'
                                : 'Unbound'}
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-muted-foreground">
                      {getBindingSummary(consumer.consumerLabel, binding, boundProfile)}
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
              <div className="text-lg font-semibold">No Microsoft profiles yet</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {isEnterpriseEdition
                  ? 'Create a named profile first, then bind it explicitly to MSP SSO, Outlook email, calendar sync, and Teams.'
                  : 'Create a named profile first, then bind it explicitly to MSP SSO and login-domain sign-in flows.'}
              </div>
              <Button className="mt-4" id="microsoft-empty-state-create" type="button" onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Create Microsoft Profile
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {profiles.map((profile) => {
                const statusBadge = getProfileStatusBadge(profile);
                const readinessMessages = getReadinessMessages(profile);
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
                                Default
                              </Badge>
                            )}
                            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                          </div>
                          <CardDescription>
                            Tenant ID: <span className="font-mono text-xs">{profile.tenantId}</span>
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
                            Edit
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
                              {settingDefaultId === profile.profileId ? 'Updating…' : 'Set Default'}
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
                              Archive
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
                            Client ID
                          </div>
                          <div className="mt-2 break-all font-mono text-xs">
                            {profile.clientId || 'Not configured'}
                          </div>
                        </div>
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Stored secret
                          </div>
                          <div className="mt-2 font-mono text-xs">
                            {profile.clientSecretMasked || 'Not configured'}
                          </div>
                        </div>
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Active bindings
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {visibleConsumers.length > 0 ? (
                              visibleConsumers.map((consumer) => (
                                <Badge key={`${profile.profileId}-${consumer}`} variant="outline">
                                  {consumer}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">No visible consumer bindings</span>
                            )}
                          </div>
                        </div>
                        {showTeamsUi && (
                          <div className="rounded-lg border bg-muted/10 p-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Teams application ID URI
                            </div>
                            <div className="mt-2 break-all font-mono text-xs">
                              {getTeamsApplicationIdUri(status?.baseUrl, profile.clientId) ||
                                'Requires base URL and client ID'}
                            </div>
                          </div>
                        )}
                      </div>

                      {readinessMessages.length > 0 ? (
                        <Alert variant={profile.isArchived ? 'default' : 'destructive'}>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            <div className="font-medium">Profile readiness</div>
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
                                ? 'This profile is ready for MSP SSO, Outlook email, calendar sync, and Teams bindings.'
                                : 'This profile is ready for MSP SSO, Outlook email, and calendar bindings.'
                              : 'This profile is ready for MSP SSO binding and login-domain sign-in flows.'}
                          </AlertDescription>
                        </Alert>
                      )}

                      <details className="rounded-lg border p-4">
                        <summary className="cursor-pointer text-sm font-medium">
                          Microsoft app registration guidance
                        </summary>
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          {getGuidanceBlocks(status, profile, showTeamsUi).map((block) => (
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
              Cancel
            </Button>
            <Button id="microsoft-profile-save" type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : dialogMode === 'create' ? 'Create Profile' : 'Save Changes'}
            </Button>
          </div>
        }
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {dialogMode === 'create'
                ? 'Create a tenant-owned Microsoft profile, then bind it explicitly to the Microsoft consumers you want to use.'
                : 'Update the selected Microsoft profile. Leave the secret blank to keep the existing value.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="microsoft-profile-display-name">Display name</Label>
              <Input
                id="microsoft-profile-display-name"
                value={formState.displayName}
                onChange={(event) => setFormValue('displayName', event.target.value)}
                placeholder="Acme production tenant"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="microsoft-profile-client-id">Client ID</Label>
              <Input
                id="microsoft-profile-client-id"
                value={formState.clientId}
                onChange={(event) => setFormValue('clientId', event.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="microsoft-profile-tenant-id">Tenant ID</Label>
              <Input
                id="microsoft-profile-tenant-id"
                value={formState.tenantId}
                onChange={(event) => setFormValue('tenantId', event.target.value)}
                placeholder="common"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="microsoft-profile-client-secret">Client secret</Label>
              <Input
                id="microsoft-profile-client-secret"
                type="password"
                value={formState.clientSecret}
                onChange={(event) => setFormValue('clientSecret', event.target.value)}
                placeholder={
                  dialogMode === 'edit' ? 'Leave blank to keep the current secret' : 'Enter client secret'
                }
              />
              {dialogMode === 'edit' && currentSecretMasked && (
                <p className="text-xs text-muted-foreground">
                  Stored secret: {currentSecretMasked}. Leave this field empty to keep it unchanged.
                </p>
              )}
            </div>

            {dialogMode === 'create' && (
              <div className="rounded-lg border bg-muted/10 p-3 md:col-span-2">
                <Switch
                  id="microsoft-profile-set-default"
                  checked={formState.setAsDefault}
                  onCheckedChange={(checked) => setFormValue('setAsDefault', checked)}
                  label="Set this profile as the default Microsoft profile"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Default profiles stay available for profile-management workflows and migration-safe metadata, not consumer routing.
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
        title="Archive Microsoft profile?"
        message={
          archiveTarget
            ? `Archive ${archiveTarget.displayName}? Existing historical references stay intact, but the profile will no longer be available for new bindings.`
            : ''
        }
        confirmLabel={isArchiving ? 'Archiving…' : 'Archive Profile'}
        cancelLabel="Keep Profile"
        isConfirming={isArchiving}
      />
    </>
  );
}
