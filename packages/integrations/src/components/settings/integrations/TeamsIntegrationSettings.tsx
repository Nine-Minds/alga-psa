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
} from '../../../actions';
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

async function getDownloadErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    if (typeof payload?.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
  }

  const text = await response.text().catch(() => '');
  return text.trim() || 'Failed to download Teams app package';
}

export function TeamsIntegrationSettings() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [packageLoading, setPackageLoading] = React.useState(false);
  const [downloadLoading, setDownloadLoading] = React.useState(false);
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
  const isActive = installStatus === 'active';
  const canActivate = canPersist && !isActive;
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
    setFormState((current) => ({
      ...current,
      [field]: toggleValue(current[field], value, checked),
    }));
  }, []);

  const handleSave = React.useCallback(async (nextInstallStatus?: TeamsIntegration['installStatus']) => {
    setSaving(true);
    setError(null);
    setStatusMessage(null);

    const fallbackStatus: TeamsIntegration['installStatus'] = canPersist
      ? (isActive ? 'active' : 'install_pending')
      : 'not_configured';
    const resolvedStatus = nextInstallStatus ?? fallbackStatus;

    try {
      const result = await saveTeamsIntegrationSettings({
        selectedProfileId: formState.selectedProfileId || null,
        installStatus: resolvedStatus,
        enabledCapabilities: formState.enabledCapabilities as any,
        notificationCategories: formState.notificationCategories as any,
        allowedActions: formState.allowedActions as any,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to save Teams settings');
      }

      setTeamsStatus(result);
      setFormState(mapIntegrationToForm(result.integration));
      setStatusMessage(
        resolvedStatus === 'active' && !isActive
          ? 'Teams setup activated.'
          : resolvedStatus === 'not_configured'
            ? 'Teams setup deactivated.'
            : 'Teams setup saved.'
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to save Teams settings');
    } finally {
      setSaving(false);
    }
  }, [canPersist, formState, isActive]);

  const handlePackageRefresh = React.useCallback(async () => {
    setPackageLoading(true);
    setPackageError(null);
    setStatusMessage(null);

    try {
      const result = await getTeamsAppPackageStatus();
      if (!result.success || !result.package) {
        throw new Error(result.error || 'Failed to generate Teams app package');
      }

      setPackageStatus(result.package);
      setStatusMessage('Teams app package generated.');
    } catch (err: any) {
      setPackageError(err?.message || 'Failed to generate Teams app package');
    } finally {
      setPackageLoading(false);
    }
  }, []);

  const handleZipDownload = React.useCallback(async () => {
    if (!packageStatus) {
      return;
    }

    setDownloadLoading(true);
    setPackageError(null);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/teams/package/download', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(await getDownloadErrorMessage(response));
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = packageStatus.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setStatusMessage('Teams app package downloaded.');
    } catch (err: any) {
      setPackageError(err?.message || 'Failed to download Teams app package');
    } finally {
      setDownloadLoading(false);
    }
  }, [packageStatus]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {statusMessage ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Microsoft Teams</CardTitle>
          <CardDescription>
            Bind Teams to a Microsoft profile, enable capabilities, and generate the tenant package.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-3">
            <Badge variant={installStatusBadge.variant}>{installStatusBadge.label}</Badge>
            <span className="text-sm text-muted-foreground">{selectedProfileSummary}</span>
          </div>

          <div className="space-y-3">
            {checklist.map((item) => (
              <ChecklistItem key={item.label} {...item} />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <GuidanceBlock
              title="Required scopes"
              items={teamsScopes.map((value) => ({ label: value, value }))}
            />
            <GuidanceBlock
              title="Redirect URIs"
              items={[
                { label: 'Personal tab', value: redirectUris?.teamsTab || 'Unavailable' },
                { label: 'Personal bot', value: redirectUris?.teamsBot || 'Unavailable' },
                {
                  label: 'Message extension',
                  value: redirectUris?.teamsMessageExtension || 'Unavailable',
                },
              ]}
            />
          </div>

          {teamsApplicationIdUri ? (
            <GuidanceBlock
              title="Application ID URI"
              items={[{ label: 'Teams app ID URI', value: teamsApplicationIdUri }]}
            />
          ) : null}

          <div className="space-y-4">
            <div>
              <Label htmlFor="teams-profile">Microsoft profile</Label>
              <select
                id="teams-profile"
                className="mt-2 flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={formState.selectedProfileId}
                onChange={(event) => {
                  setFormState((current) => ({
                    ...current,
                    selectedProfileId: event.target.value,
                  }));
                }}
              >
                <option value="">Select profile</option>
                {eligibleProfiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.displayName}
                  </option>
                ))}
              </select>
            </div>

            {!hasEligibleProfiles ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No Microsoft profiles are ready for Teams. Finish Microsoft setup first.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-3">
                <div className="text-sm font-medium">Capabilities</div>
                {TEAMS_CAPABILITY_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-start gap-3 rounded-md border p-3">
                    <Checkbox
                      id={`teams-capability-${option.value}`}
                      checked={formState.enabledCapabilities.includes(option.value)}
                      onChange={(event) =>
                        updateCheckboxGroup('enabledCapabilities', option.value, event.target.checked)
                      }
                    />
                    <div>
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="text-xs text-muted-foreground">{option.description}</div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium">Notifications</div>
                {TEAMS_NOTIFICATION_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-start gap-3 rounded-md border p-3">
                    <Checkbox
                      id={`teams-notification-${option.value}`}
                      checked={formState.notificationCategories.includes(option.value)}
                      onChange={(event) =>
                        updateCheckboxGroup('notificationCategories', option.value, event.target.checked)
                      }
                    />
                    <div>
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="text-xs text-muted-foreground">{option.description}</div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium">Allowed actions</div>
                {TEAMS_ALLOWED_ACTION_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-start gap-3 rounded-md border p-3">
                    <Checkbox
                      id={`teams-action-${option.value}`}
                      checked={formState.allowedActions.includes(option.value)}
                      onChange={(event) =>
                        updateCheckboxGroup('allowedActions', option.value, event.target.checked)
                      }
                    />
                    <div>
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="text-xs text-muted-foreground">{option.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button id="teams-save-draft" onClick={() => void handleSave()} disabled={saving || !canPersist}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving...' : isActive ? 'Save changes' : 'Save draft'}
            </Button>
            <Button
              id="teams-activate"
              variant="secondary"
              onClick={() => void handleSave('active')}
              disabled={saving || !canActivate}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {isActive ? 'Teams active' : 'Activate Teams'}
            </Button>
            <Button
              id="teams-deactivate"
              variant="outline"
              onClick={() => void handleSave('not_configured')}
              disabled={saving || !canDeactivate}
            >
              Deactivate
            </Button>
            <Button id="teams-reload" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Reload
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Teams Package</CardTitle>
          <CardDescription>
            Generate the app manifest and installation links for the selected Microsoft profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {packageError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{packageError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button
              id="teams-generate-package"
              onClick={() => void handlePackageRefresh()}
              disabled={packageLoading || !hasSavedPackageContext}
            >
              <Package className="mr-2 h-4 w-4" />
              {packageLoading ? 'Generating...' : 'Generate package'}
            </Button>
          </div>

          {packageStatus ? (
            <div className="space-y-4 rounded-md border p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <GuidanceBlock
                  title="Package"
                  items={[
                    { label: 'Manifest version', value: packageStatus.manifestVersion },
                    { label: 'Package version', value: packageStatus.packageVersion },
                    { label: 'File name', value: packageStatus.fileName },
                  ]}
                />
                <GuidanceBlock
                  title="App IDs"
                  items={[
                    { label: 'App ID', value: packageStatus.appId },
                    { label: 'Bot ID', value: packageStatus.botId },
                    { label: 'Web application resource', value: packageStatus.webApplicationInfo.resource },
                  ]}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <GuidanceBlock
                  title="Valid domains"
                  items={packageStatus.validDomains.map((value) => ({ label: value, value }))}
                />
                <GuidanceBlock
                  title="Deep links"
                  items={[
                    { label: 'My work', value: packageStatus.deepLinks.myWork },
                    { label: 'Ticket template', value: packageStatus.deepLinks.ticketTemplate },
                    { label: 'Project task template', value: packageStatus.deepLinks.projectTaskTemplate },
                  ]}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  id="teams-download-zip"
                  variant="default"
                  onClick={() => void handleZipDownload()}
                  disabled={downloadLoading}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {downloadLoading ? 'Downloading...' : 'Download app package (.zip)'}
                </Button>
                <Button id="teams-download-manifest" asChild variant="secondary">
                  <a href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(packageStatus.manifest, null, 2))}`} download={`${packageStatus.fileName.replace(/\.zip$/, '')}.json`}>
                    <Download className="mr-2 h-4 w-4" />
                    Download manifest JSON
                  </a>
                </Button>
                <Button id="teams-open-deeplink" asChild variant="outline">
                  <a href={packageStatus.deepLinks.myWork} target="_blank" rel="noreferrer">
                    <MessageSquareShare className="mr-2 h-4 w-4" />
                    Open Teams deep link
                  </a>
                </Button>
                <Button id="teams-open-base-url" asChild variant="outline">
                  <a href={packageStatus.baseUrl} target="_blank" rel="noreferrer">
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                    Open PSA base URL
                  </a>
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
