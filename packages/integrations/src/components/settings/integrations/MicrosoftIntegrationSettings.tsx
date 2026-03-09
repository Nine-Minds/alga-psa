'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  resetMicrosoftProvidersToDisconnected,
  setDefaultMicrosoftProfile,
  updateMicrosoftProfile,
} from '@alga-psa/integrations/actions';
import { resolveTeamsAvailability } from '../../../lib/teamsAvailability';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Star,
  Archive,
} from 'lucide-react';

type MicrosoftIntegrationStatus = Awaited<ReturnType<typeof getMicrosoftIntegrationStatus>>;
type MicrosoftProfile = NonNullable<MicrosoftIntegrationStatus['profiles']>[number];
type ProfileDialogMode = 'create' | 'edit';

interface ProfileFormState {
  displayName: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  setAsDefault: boolean;
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
    messages.push('Archived profiles cannot be used for new Microsoft integrations.');
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

function getProfileStatusBadge(profile: MicrosoftProfile): { label: string; variant: 'success' | 'warning' | 'secondary' } {
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

export function MicrosoftIntegrationSettings() {
  const { toast } = useToast();
  const teamsUiFlag = useFeatureFlag('teams-integration-ui', { defaultValue: false });
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [settingDefaultId, setSettingDefaultId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<MicrosoftIntegrationStatus | null>(null);
  const [dialogMode, setDialogMode] = React.useState<ProfileDialogMode | null>(null);
  const [editingProfile, setEditingProfile] = React.useState<MicrosoftProfile | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<MicrosoftProfile | null>(null);
  const [isArchiving, setIsArchiving] = React.useState(false);
  const [formState, setFormState] = React.useState<ProfileFormState>(DEFAULT_FORM_STATE);
  const [formError, setFormError] = React.useState<string | null>(null);

  const profiles = status?.success ? status.profiles ?? [] : [];
  const hasProfiles = profiles.length > 0;
  const teamsAvailability = resolveTeamsAvailability({
    flagEnabled: teamsUiFlag.enabled,
    isEnterpriseEdition: process.env.NEXT_PUBLIC_EDITION === 'enterprise',
    requireTenantContext: false,
  });
  const showTeamsUi = teamsAvailability.enabled;

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await getMicrosoftIntegrationStatus();
    setStatus(result);

    if (!result.success) {
      setError(result.error || 'Failed to load Microsoft settings');
    }

    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
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

      const result = dialogMode === 'create'
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
        description: dialogMode === 'create'
          ? showTeamsUi
            ? 'The Microsoft profile is ready for provider and Teams setup.'
            : 'The Microsoft profile is ready for provider setup.'
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

  const handleSetDefault = React.useCallback(async (profile: MicrosoftProfile) => {
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
        description: `${profile.displayName} is now the default profile for existing Microsoft consumers.`,
      });
      await load();
    } finally {
      setSettingDefaultId(null);
    }
  }, [load, toast]);

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
        description: 'Existing email and calendar connections now require re-authorization.',
      });
      await load();
    } finally {
      setResetting(false);
    }
  }, [load, toast]);

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
                {showTeamsUi
                  ? 'Manage tenant-owned Microsoft profiles for Outlook inbound email, Outlook calendar, MSP SSO, and Microsoft Teams.'
                  : 'Manage tenant-owned Microsoft profiles for Outlook inbound email, Outlook calendar, and MSP SSO.'}
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
              <Button id="microsoft-settings-refresh" type="button" variant="outline" onClick={load} disabled={loading}>
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

          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-medium">Legacy Microsoft consumers</div>
                <div className="text-sm text-muted-foreground">
                  The default active profile remains the compatibility source for existing email, calendar, and MSP SSO flows until explicit consumer bindings ship.
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

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : !hasProfiles ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <div className="text-lg font-semibold">No Microsoft profiles yet</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {showTeamsUi
                  ? 'Create a named profile first, then reuse it across Outlook, calendar, MSP SSO, and Teams.'
                  : 'Create a named profile first, then reuse it across Outlook, calendar, and MSP SSO.'}
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
                const visibleConsumers = showTeamsUi
                  ? profile.consumers
                  : profile.consumers.filter((consumer) => consumer !== 'Teams');
                const teamsApplicationIdUri = showTeamsUi
                  ? getTeamsApplicationIdUri(status?.baseUrl, profile.clientId)
                  : null;

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
                              onClick={() => handleSetDefault(profile)}
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
                      <div className={`grid gap-4 md:grid-cols-2 ${showTeamsUi ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client ID</div>
                          <div className="mt-2 break-all font-mono text-xs">{profile.clientId || 'Not configured'}</div>
                        </div>
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stored secret</div>
                          <div className="mt-2 font-mono text-xs">{profile.clientSecretMasked || 'Not configured'}</div>
                        </div>
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current consumers</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {visibleConsumers.length > 0 ? (
                              visibleConsumers.map((consumer) => (
                                <Badge key={`${profile.profileId}-${consumer}`} variant="outline">
                                  {consumer}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">No current bindings</span>
                            )}
                          </div>
                        </div>
                        {showTeamsUi && (
                          <div className="rounded-lg border bg-muted/10 p-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Teams application ID URI</div>
                            <div className="mt-2 break-all font-mono text-xs">
                              {teamsApplicationIdUri || 'Requires base URL and client ID'}
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
                            {showTeamsUi
                              ? 'This profile is ready for Outlook email, calendar, MSP SSO, and Teams app registration work.'
                              : 'This profile is ready for Outlook email, calendar, and MSP SSO setup.'}
                          </AlertDescription>
                        </Alert>
                      )}

                      <details className="rounded-lg border p-4">
                        <summary className="cursor-pointer text-sm font-medium">
                          Microsoft app registration guidance
                        </summary>
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          {showTeamsUi && (
                            <GuidanceBlock
                              title="Teams Redirect URIs"
                              items={[
                                { label: 'Personal tab', value: status?.redirectUris?.teamsTab || 'Unavailable' },
                                { label: 'Personal bot', value: status?.redirectUris?.teamsBot || 'Unavailable' },
                                { label: 'Message extension', value: status?.redirectUris?.teamsMessageExtension || 'Unavailable' },
                              ]}
                            />
                          )}
                          <GuidanceBlock
                            title="Existing Redirect URIs"
                            items={[
                              { label: 'Inbound email', value: status?.redirectUris?.email || 'Unavailable' },
                              { label: 'Calendar sync', value: status?.redirectUris?.calendar || 'Unavailable' },
                              { label: 'MSP SSO', value: status?.redirectUris?.sso || 'Unavailable' },
                            ]}
                          />
                          {showTeamsUi && (
                            <GuidanceBlock
                              title="Teams Scope Guidance"
                              items={[
                                { label: 'Teams SSO scopes', value: (status?.scopes?.teams || []).join(', ') || 'Unavailable' },
                              ]}
                            />
                          )}
                          <GuidanceBlock
                            title="Current Profile Values"
                            items={[
                              { label: 'Client ID', value: profile.clientId || 'Not configured' },
                              { label: 'Tenant ID', value: profile.tenantId },
                              {
                                label: 'Email / Calendar / MSP SSO scopes',
                                value: [
                                  `Email: ${(status?.scopes?.email || []).join(', ') || 'Unavailable'}`,
                                  `Calendar: ${(status?.scopes?.calendar || []).join(', ') || 'Unavailable'}`,
                                  `MSP SSO: ${(status?.scopes?.sso || []).join(', ') || 'Unavailable'}`,
                                ].join(' | '),
                              },
                              ...(showTeamsUi
                                ? [{ label: 'Application ID URI', value: teamsApplicationIdUri || 'Requires base URL and client ID' }]
                                : []),
                            ]}
                          />
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
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {dialogMode === 'create'
                ? 'Create a tenant-owned Microsoft profile and reuse it across Microsoft integrations.'
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
                placeholder={dialogMode === 'edit' ? 'Leave blank to keep the current secret' : 'Enter client secret'}
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
                  label="Set this profile as the default compatibility profile"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Default profiles back existing email, calendar, and MSP SSO consumers until explicit profile bindings are configured.
                </p>
              </div>
            )}
          </div>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="mt-4 flex items-center justify-end gap-2">
            <Button id="microsoft-profile-cancel" type="button" variant="outline" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
            <Button id="microsoft-profile-save" type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : dialogMode === 'create' ? 'Create Profile' : 'Save Changes'}
            </Button>
          </DialogFooter>
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
