'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Label } from '@alga-psa/ui/components/Label';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import {
  getMicrosoftIntegrationStatus,
  getTeamsAppPackageStatus,
  getTeamsIntegrationStatus,
  saveTeamsIntegrationSettings,
} from '@alga-psa/integrations/actions';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Download,
  MessageSquareShare,
  Package,
  RefreshCw,
  Save,
} from 'lucide-react';

type MicrosoftIntegrationStatus = Awaited<ReturnType<typeof getMicrosoftIntegrationStatus>>;
type MicrosoftProfile = NonNullable<MicrosoftIntegrationStatus['profiles']>[number];
type TeamsIntegrationStatus = Awaited<ReturnType<typeof getTeamsIntegrationStatus>>;
type TeamsIntegration = NonNullable<TeamsIntegrationStatus['integration']>;
type TeamsPackageStatus = Awaited<ReturnType<typeof getTeamsAppPackageStatus>>;
type TeamsPackage = NonNullable<TeamsPackageStatus['package']>;

type TeamsFormState = {
  selectedProfileId: string;
  enabledCapabilities: string[];
  notificationCategories: string[];
  allowedActions: string[];
};

type TeamsCheckboxGroupField = 'enabledCapabilities' | 'notificationCategories' | 'allowedActions';

const TEAMS_CAPABILITY_OPTIONS = [
  { value: 'personal_tab', label: 'Personal tab', description: 'Launch the PSA personal tab entry point.' },
  { value: 'personal_bot', label: 'Personal bot', description: 'Enable personal-scope bot commands for technicians.' },
  { value: 'message_extension', label: 'Message extension', description: 'Enable lookup and message-driven PSA actions.' },
  { value: 'activity_notifications', label: 'Activity notifications', description: 'Deliver personal Teams activity-feed notifications.' },
] as const;

const TEAMS_NOTIFICATION_OPTIONS = [
  { value: 'assignment', label: 'Assignment events', description: 'Notify technicians when work is assigned.' },
  { value: 'customer_reply', label: 'Customer replies', description: 'Notify technicians when customers respond.' },
  { value: 'approval_request', label: 'Approval requests', description: 'Notify approvers about pending decisions.' },
  { value: 'escalation', label: 'Escalations', description: 'Notify owners when work escalates.' },
  { value: 'sla_risk', label: 'SLA risk', description: 'Notify technicians when SLA risk thresholds are reached.' },
] as const;

const TEAMS_ALLOWED_ACTION_OPTIONS = [
  { value: 'assign_ticket', label: 'Assign ticket', description: 'Allow ticket assignment quick actions.' },
  { value: 'add_note', label: 'Add note', description: 'Allow internal note quick actions.' },
  { value: 'reply_to_contact', label: 'Reply to contact', description: 'Allow customer-visible reply quick actions.' },
  { value: 'log_time', label: 'Log time', description: 'Allow time-entry quick actions.' },
  { value: 'approval_response', label: 'Approval response', description: 'Allow approve and reject quick actions.' },
] as const;

const EMPTY_FORM_STATE: TeamsFormState = {
  selectedProfileId: '',
  enabledCapabilities: [],
  notificationCategories: [],
  allowedActions: [],
};

function isTeamsEligible(profile: MicrosoftProfile): boolean {
  return !profile.isArchived && profile.readiness.ready;
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

function ChecklistItem({
  label,
  detail,
  complete,
}: {
  label: string;
  detail: string;
  complete: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/10 p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </div>
      <Badge variant={complete ? 'success' : 'warning'}>{complete ? 'Ready' : 'Needs action'}</Badge>
    </div>
  );
}

function getInstallStatusBadge(installStatus: TeamsIntegration['installStatus']) {
  switch (installStatus) {
    case 'active':
      return { label: 'Active', variant: 'success' as const };
    case 'install_pending':
      return { label: 'Install Pending', variant: 'warning' as const };
    case 'error':
      return { label: 'Error', variant: 'error' as const };
    default:
      return { label: 'Not Configured', variant: 'secondary' as const };
  }
}

function mapIntegrationToForm(integration?: TeamsIntegration | null): TeamsFormState {
  return {
    selectedProfileId: integration?.selectedProfileId ?? '',
    enabledCapabilities: integration?.enabledCapabilities ?? TEAMS_CAPABILITY_OPTIONS.map((option) => option.value),
    notificationCategories: integration?.notificationCategories ?? TEAMS_NOTIFICATION_OPTIONS.map((option) => option.value),
    allowedActions: integration?.allowedActions ?? TEAMS_ALLOWED_ACTION_OPTIONS.map((option) => option.value),
  };
}

function toggleValue(values: string[], value: string, checked: boolean): string[] {
  const next = new Set(values);
  if (checked) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return [...next];
}

export function TeamsIntegrationSettings() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [packageLoading, setPackageLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [packageError, setPackageError] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [microsoftStatus, setMicrosoftStatus] = React.useState<MicrosoftIntegrationStatus | null>(null);
  const [teamsStatus, setTeamsStatus] = React.useState<TeamsIntegrationStatus | null>(null);
  const [packageStatus, setPackageStatus] = React.useState<TeamsPackage | null>(null);
  const [formState, setFormState] = React.useState<TeamsFormState>(EMPTY_FORM_STATE);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [microsoftResult, teamsResult] = await Promise.all([
        getMicrosoftIntegrationStatus(),
        getTeamsIntegrationStatus(),
      ]);

      setMicrosoftStatus(microsoftResult);
      setTeamsStatus(teamsResult);

      if (!microsoftResult.success) {
        throw new Error(microsoftResult.error || 'Failed to load Teams setup guidance');
      }

      if (!teamsResult.success) {
        throw new Error(teamsResult.error || 'Failed to load Teams setup guidance');
      }

      setFormState(mapIntegrationToForm(teamsResult.integration));
    } catch (err: any) {
      setError(err?.message || 'Failed to load Teams setup guidance');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const profiles = microsoftStatus?.success ? microsoftStatus.profiles ?? [] : [];
  const eligibleProfiles = profiles.filter(isTeamsEligible);
  const hasEligibleProfiles = eligibleProfiles.length > 0;
  const currentIntegration = teamsStatus?.success ? teamsStatus.integration ?? null : null;
  const installStatus = currentIntegration?.installStatus ?? 'not_configured';
  const installStatusBadge = getInstallStatusBadge(installStatus);

  const selectedProfile = eligibleProfiles.find((profile) => profile.profileId === formState.selectedProfileId) ?? null;
  const selectedProfileRecord = profiles.find((profile) => profile.profileId === formState.selectedProfileId) ?? null;
  const selectedProfileInvalid = Boolean(formState.selectedProfileId) && (!selectedProfileRecord || !isTeamsEligible(selectedProfileRecord));
  const canPersist = Boolean(selectedProfile);
  const canDeactivate = installStatus !== 'not_configured';
  const hasSavedPackageContext = Boolean(currentIntegration?.selectedProfileId)
    && installStatus !== 'not_configured'
    && currentIntegration?.selectedProfileId === formState.selectedProfileId;

  const teamsScopes = microsoftStatus?.success ? (microsoftStatus.scopes?.teams ?? []) : [];
  const redirectUris = microsoftStatus?.success ? microsoftStatus.redirectUris : undefined;
  const teamsApplicationIdUri = getTeamsApplicationIdUri(microsoftStatus?.success ? microsoftStatus.baseUrl : undefined, selectedProfile?.clientId);

  const selectedProfileSummary = selectedProfile
    ? selectedProfile.displayName
    : selectedProfileInvalid
      ? 'Selected profile needs repair'
      : 'No profile selected';

  const checklist = [
    {
      label: 'Microsoft profile selected',
      detail: selectedProfile ? `${selectedProfile.displayName} is bound for Teams.` : 'Select one eligible Microsoft profile before saving or activating Teams.',
      complete: Boolean(selectedProfile),
    },
    {
      label: 'Profile ready for Teams install',
      detail: selectedProfile ? 'The selected profile has client ID, tenant ID, and stored secret material.' : 'No selected Teams profile is ready yet.',
      complete: Boolean(selectedProfile?.readiness.ready),
    },
    {
      label: 'Teams install state',
      detail: installStatus === 'active'
        ? 'Teams is active for this tenant.'
        : installStatus === 'install_pending'
          ? 'Draft setup is saved and ready for install or consent.'
          : installStatus === 'error'
            ? currentIntegration?.lastError || 'Teams setup has an error that needs remediation.'
            : 'Save a draft or activate Teams when setup is ready.',
      complete: installStatus === 'active' || installStatus === 'install_pending',
    },
  ];

  const updateCheckboxGroup = React.useCallback((field: TeamsCheckboxGroupField, value: string, checked: boolean) => {
    setStatusMessage(null);
    setFormState((current) => ({
      ...current,
      [field]: toggleValue(current[field], value, checked),
    }));
  }, []);

  const updateSelectedProfile = React.useCallback((selectedProfileId: string) => {
    setStatusMessage(null);
    setError(null);
    setPackageStatus(null);
    setPackageError(null);
    setFormState((current) => ({ ...current, selectedProfileId }));
  }, []);

  const persist = React.useCallback(async (
    nextInstallStatus: TeamsIntegration['installStatus'],
    successMessage: string
  ) => {
    if (nextInstallStatus !== 'not_configured' && !selectedProfile) {
      setError('Select a Microsoft profile before saving Teams setup');
      return;
    }

    setSaving(true);
    setError(null);
    setStatusMessage(null);

    try {
      const result = await saveTeamsIntegrationSettings({
        selectedProfileId: formState.selectedProfileId || null,
        installStatus: nextInstallStatus,
        enabledCapabilities: formState.enabledCapabilities as any,
        notificationCategories: formState.notificationCategories as any,
        allowedActions: formState.allowedActions as any,
        lastError: null,
      });

      if (!result.success) {
        setError(result.error || 'Failed to save Teams setup');
        return;
      }

      setTeamsStatus({
        success: true,
        integration: result.integration,
      });
      setFormState(mapIntegrationToForm(result.integration));
      setPackageStatus(null);
      setPackageError(null);
      setStatusMessage(successMessage);
    } finally {
      setSaving(false);
    }
  }, [formState, selectedProfile]);

  const loadPackageHandoff = React.useCallback(async () => {
    if (!hasSavedPackageContext) {
      setPackageError('Save or activate Teams before generating a tenant package handoff');
      return;
    }

    setPackageLoading(true);
    setPackageError(null);

    try {
      const result = await getTeamsAppPackageStatus();
      if (!result.success || !result.package) {
        setPackageStatus(null);
        setPackageError(result.error || 'Failed to prepare Teams package handoff');
        return;
      }

      setPackageStatus(result.package);
    } finally {
      setPackageLoading(false);
    }
  }, [hasSavedPackageContext]);

  const downloadManifest = React.useCallback(() => {
    if (!packageStatus) {
      return;
    }

    const blob = new Blob([JSON.stringify(packageStatus.manifest, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = packageStatus.fileName.replace(/\.zip$/i, '-manifest.json');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }, [packageStatus]);

  return (
    <Card id="teams-integration-settings">
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <CardTitle>Microsoft Teams</CardTitle>
            <CardDescription>
              Configure one tenant-bound Teams integration that reuses a selected Microsoft profile across the personal tab, personal bot, message extension, and personal activity notifications.
            </CardDescription>
          </div>
          <Button
            id="teams-setup-refresh"
            type="button"
            variant="outline"
            onClick={() => {
              setStatusMessage(null);
              void load();
            }}
            disabled={loading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {statusMessage && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>{statusMessage}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !hasEligibleProfiles ? (
          <Alert variant="warning">
            <MessageSquareShare className="h-4 w-4" />
            <AlertDescription>
              <div className="font-medium">Create or repair a Microsoft profile before configuring Teams.</div>
              <div className="mt-2 text-sm">
                Teams setup stays blocked until at least one active Microsoft profile has a client ID, client secret, and tenant ID.
              </div>
              <Button
                id="teams-setup-open-profiles"
                type="button"
                className="mt-3"
                onClick={() => {
                  window.location.hash = 'microsoft-profile-manager';
                }}
              >
                <ArrowUpRight className="mr-2 h-4 w-4" />
                Open Microsoft Profiles
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {selectedProfileInvalid && (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-medium">The currently selected Teams profile needs attention.</div>
                  <div className="mt-2 text-sm">
                    Repair or replace the selected Microsoft profile before activating Teams for this tenant.
                  </div>
                  <Button
                    id="teams-invalid-profile-open-profiles"
                    type="button"
                    className="mt-3"
                    onClick={() => {
                      window.location.hash = 'microsoft-profile-manager';
                    }}
                  >
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                    Open Microsoft Profiles
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium">Current Teams setup</div>
                    <Badge variant={installStatusBadge.variant}>{installStatusBadge.label}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Selected profile: <span className="font-medium text-foreground">{selectedProfileSummary}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {formState.enabledCapabilities.map((value) => {
                      const option = TEAMS_CAPABILITY_OPTIONS.find((item) => item.value === value);
                      return option ? (
                        <Badge key={`teams-capability-badge-${value}`} variant="outline">
                          {option.label}
                        </Badge>
                      ) : null;
                    })}
                    {formState.notificationCategories.map((value) => {
                      const option = TEAMS_NOTIFICATION_OPTIONS.find((item) => item.value === value);
                      return option ? (
                        <Badge key={`teams-notification-badge-${value}`} variant="outline">
                          {option.label}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    id="teams-save-draft"
                    type="button"
                    variant="outline"
                    onClick={() => void persist('install_pending', 'Teams draft saved')}
                    disabled={saving || !canPersist}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Saving…' : 'Save Draft'}
                  </Button>
                  <Button
                    id="teams-activate"
                    type="button"
                    onClick={() => void persist('active', 'Teams activated')}
                    disabled={saving || !canPersist}
                  >
                    {saving ? 'Saving…' : 'Activate Teams'}
                  </Button>
                  <Button
                    id="teams-deactivate"
                    type="button"
                    variant="destructive"
                    onClick={() => void persist('not_configured', 'Teams deactivated')}
                    disabled={saving || !canDeactivate}
                  >
                    {saving ? 'Saving…' : 'Deactivate Teams'}
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="space-y-4 rounded-lg border p-4">
                <div className="space-y-2">
                  <Label htmlFor="teams-setup-profile-select">Microsoft profile</Label>
                  <select
                    id="teams-setup-profile-select"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={formState.selectedProfileId}
                    onChange={(event) => updateSelectedProfile(event.target.value)}
                  >
                    <option value="">Select a Microsoft profile</option>
                    {eligibleProfiles.map((profile) => (
                      <option key={profile.profileId} value={profile.profileId}>
                        {profile.displayName}
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-muted-foreground">
                    Teams must bind to exactly one ready Microsoft profile before activation.
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-sm font-medium">Install and readiness checklist</div>
                  {checklist.map((item) => (
                    <ChecklistItem
                      key={item.label}
                      label={item.label}
                      detail={item.detail}
                      complete={item.complete}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-4 rounded-lg border p-4">
                <div className="text-sm font-medium">Selected profile registration guidance</div>
                {selectedProfile ? (
                  <div className="grid gap-4">
                    <GuidanceBlock
                      title="Current Profile Values"
                      items={[
                        { label: 'Display name', value: selectedProfile.displayName },
                        { label: 'Client ID', value: selectedProfile.clientId || 'Not configured' },
                        { label: 'Tenant ID', value: selectedProfile.tenantId || 'common' },
                        { label: 'Application ID URI', value: teamsApplicationIdUri || 'Requires base URL and client ID' },
                      ]}
                    />
                    <GuidanceBlock
                      title="Teams Redirect URIs"
                      items={[
                        { label: 'Personal tab', value: redirectUris?.teamsTab || 'Unavailable' },
                        { label: 'Personal bot', value: redirectUris?.teamsBot || 'Unavailable' },
                        { label: 'Message extension', value: redirectUris?.teamsMessageExtension || 'Unavailable' },
                      ]}
                    />
                    <GuidanceBlock
                      title="Teams Scope Guidance"
                      items={[
                        { label: 'Teams SSO scopes', value: teamsScopes.join(', ') || 'Unavailable' },
                      ]}
                    />
                  </div>
                ) : (
                  <Alert>
                    <AlertDescription>
                      Select a Microsoft profile to view the Teams app-registration values, redirect URIs, and scope guidance for this tenant.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Package className="h-4 w-4" />
                    Teams package handoff
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Prepare the tenant-specific Teams app package summary, then download the manifest snapshot for admin install handoff.
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    id="teams-package-refresh"
                    type="button"
                    variant="outline"
                    onClick={() => void loadPackageHandoff()}
                    disabled={packageLoading || !hasSavedPackageContext}
                  >
                    <Package className="mr-2 h-4 w-4" />
                    {packageLoading ? 'Preparing…' : packageStatus ? 'Refresh package handoff' : 'Prepare package handoff'}
                  </Button>
                  <Button
                    id="teams-package-download-manifest"
                    type="button"
                    variant="outline"
                    onClick={downloadManifest}
                    disabled={!packageStatus}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download manifest JSON
                  </Button>
                </div>
              </div>

              {!hasSavedPackageContext && (
                <Alert className="mt-4">
                  <AlertDescription>
                    Save a Teams draft or activate Teams before generating the tenant package handoff.
                  </AlertDescription>
                </Alert>
              )}

              {packageError && (
                <Alert className="mt-4" variant="destructive">
                  <AlertDescription>{packageError}</AlertDescription>
                </Alert>
              )}

              {packageStatus && (
                <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <GuidanceBlock
                    title="Package Summary"
                    items={[
                      { label: 'Package file', value: packageStatus.fileName },
                      { label: 'Install status', value: packageStatus.installStatus },
                      { label: 'App ID', value: packageStatus.appId },
                      { label: 'Bot ID', value: packageStatus.botId },
                    ]}
                  />
                  <GuidanceBlock
                    title="Install Handoff"
                    items={[
                      { label: 'Base URL', value: packageStatus.baseUrl },
                      { label: 'Valid domains', value: packageStatus.validDomains.join(', ') },
                      { label: 'Resource URI', value: packageStatus.webApplicationInfo.resource },
                    ]}
                  />
                </div>
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <div className="rounded-lg border p-4">
                <div className="text-sm font-medium">Enabled Teams capabilities</div>
                <div className="mt-3 space-y-2">
                  {TEAMS_CAPABILITY_OPTIONS.map((option) => (
                    <Checkbox
                      key={option.value}
                      id={`teams-capability-${option.value}`}
                      label={option.label}
                      checked={formState.enabledCapabilities.includes(option.value)}
                      onChange={(event) => updateCheckboxGroup('enabledCapabilities', option.value, event.currentTarget.checked)}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="text-sm font-medium">Notification categories</div>
                <div className="mt-3 space-y-2">
                  {TEAMS_NOTIFICATION_OPTIONS.map((option) => (
                    <Checkbox
                      key={option.value}
                      id={`teams-notification-${option.value}`}
                      label={option.label}
                      checked={formState.notificationCategories.includes(option.value)}
                      onChange={(event) => updateCheckboxGroup('notificationCategories', option.value, event.currentTarget.checked)}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="text-sm font-medium">Allowed quick actions</div>
                <div className="mt-3 space-y-2">
                  {TEAMS_ALLOWED_ACTION_OPTIONS.map((option) => (
                    <Checkbox
                      key={option.value}
                      id={`teams-action-${option.value}`}
                      label={option.label}
                      checked={formState.allowedActions.includes(option.value)}
                      onChange={(event) => updateCheckboxGroup('allowedActions', option.value, event.currentTarget.checked)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
