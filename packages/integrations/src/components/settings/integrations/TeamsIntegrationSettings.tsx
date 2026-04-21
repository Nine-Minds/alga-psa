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
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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

const TEAMS_CAPABILITY_VALUES = ['personal_tab', 'personal_bot', 'group_chat_bot', 'message_extension', 'activity_notifications'] as const;
const TEAMS_NOTIFICATION_VALUES = ['assignment', 'customer_reply', 'approval_request', 'escalation', 'sla_risk'] as const;
const TEAMS_ALLOWED_ACTION_VALUES = ['assign_ticket', 'add_note', 'reply_to_contact', 'log_time', 'approval_response'] as const;

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function getTeamsCapabilityOptions(t: TranslateFn) {
  return [
    { value: 'personal_tab', label: t('integrations.teams.settings.capabilities.personalTab.label', { defaultValue: 'Personal tab' }), description: t('integrations.teams.settings.capabilities.personalTab.description', { defaultValue: 'Launch the PSA personal tab entry point.' }) },
    { value: 'personal_bot', label: t('integrations.teams.settings.capabilities.personalBot.label', { defaultValue: 'Personal bot' }), description: t('integrations.teams.settings.capabilities.personalBot.description', { defaultValue: 'Enable personal-scope bot commands for technicians.' }) },
    { value: 'group_chat_bot', label: t('integrations.teams.settings.capabilities.groupChatBot.label', { defaultValue: 'Group chat bot' }), description: t('integrations.teams.settings.capabilities.groupChatBot.description', { defaultValue: 'Allow the bot to respond in Teams group chats. Bot replies (including ticket details) are visible to every member of the chat.' }) },
    { value: 'message_extension', label: t('integrations.teams.settings.capabilities.messageExtension.label', { defaultValue: 'Message extension' }), description: t('integrations.teams.settings.capabilities.messageExtension.description', { defaultValue: 'Enable lookup and message-driven PSA actions.' }) },
    { value: 'activity_notifications', label: t('integrations.teams.settings.capabilities.activityNotifications.label', { defaultValue: 'Activity notifications' }), description: t('integrations.teams.settings.capabilities.activityNotifications.description', { defaultValue: 'Deliver personal Teams activity-feed notifications.' }) },
  ];
}

function getTeamsNotificationOptions(t: TranslateFn) {
  return [
    { value: 'assignment', label: t('integrations.teams.settings.notifications.assignment.label', { defaultValue: 'Assignment events' }), description: t('integrations.teams.settings.notifications.assignment.description', { defaultValue: 'Notify technicians when work is assigned.' }) },
    { value: 'customer_reply', label: t('integrations.teams.settings.notifications.customerReply.label', { defaultValue: 'Customer replies' }), description: t('integrations.teams.settings.notifications.customerReply.description', { defaultValue: 'Notify technicians when customers respond.' }) },
    { value: 'approval_request', label: t('integrations.teams.settings.notifications.approvalRequest.label', { defaultValue: 'Approval requests' }), description: t('integrations.teams.settings.notifications.approvalRequest.description', { defaultValue: 'Notify approvers about pending decisions.' }) },
    { value: 'escalation', label: t('integrations.teams.settings.notifications.escalation.label', { defaultValue: 'Escalations' }), description: t('integrations.teams.settings.notifications.escalation.description', { defaultValue: 'Notify owners when work escalates.' }) },
    { value: 'sla_risk', label: t('integrations.teams.settings.notifications.slaRisk.label', { defaultValue: 'SLA risk' }), description: t('integrations.teams.settings.notifications.slaRisk.description', { defaultValue: 'Notify technicians when SLA risk thresholds are reached.' }) },
  ];
}

function getTeamsAllowedActionOptions(t: TranslateFn) {
  return [
    { value: 'assign_ticket', label: t('integrations.teams.settings.actions.assignTicket.label', { defaultValue: 'Assign ticket' }), description: t('integrations.teams.settings.actions.assignTicket.description', { defaultValue: 'Allow ticket assignment quick actions.' }) },
    { value: 'add_note', label: t('integrations.teams.settings.actions.addNote.label', { defaultValue: 'Add note' }), description: t('integrations.teams.settings.actions.addNote.description', { defaultValue: 'Allow internal note quick actions.' }) },
    { value: 'reply_to_contact', label: t('integrations.teams.settings.actions.replyToContact.label', { defaultValue: 'Reply to contact' }), description: t('integrations.teams.settings.actions.replyToContact.description', { defaultValue: 'Allow customer-visible reply quick actions.' }) },
    { value: 'log_time', label: t('integrations.teams.settings.actions.logTime.label', { defaultValue: 'Log time' }), description: t('integrations.teams.settings.actions.logTime.description', { defaultValue: 'Allow time-entry quick actions.' }) },
    { value: 'approval_response', label: t('integrations.teams.settings.actions.approvalResponse.label', { defaultValue: 'Approval response' }), description: t('integrations.teams.settings.actions.approvalResponse.description', { defaultValue: 'Allow approve and reject quick actions.' }) },
  ];
}

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
  readyLabel,
  needsActionLabel,
}: {
  label: string;
  detail: string;
  complete: boolean;
  readyLabel: string;
  needsActionLabel: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/10 p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </div>
      <Badge variant={complete ? 'success' : 'warning'}>{complete ? readyLabel : needsActionLabel}</Badge>
    </div>
  );
}

function getInstallStatusBadge(installStatus: TeamsIntegration['installStatus'], t: TranslateFn) {
  switch (installStatus) {
    case 'active':
      return { label: t('integrations.teams.settings.installStatus.active', { defaultValue: 'Active' }), variant: 'success' as const };
    case 'install_pending':
      return { label: t('integrations.teams.settings.installStatus.installPending', { defaultValue: 'Install Pending' }), variant: 'warning' as const };
    case 'error':
      return { label: t('integrations.teams.settings.installStatus.error', { defaultValue: 'Error' }), variant: 'error' as const };
    default:
      return { label: t('integrations.teams.settings.installStatus.notConfigured', { defaultValue: 'Not Configured' }), variant: 'secondary' as const };
  }
}

function mapIntegrationToForm(integration?: TeamsIntegration | null): TeamsFormState {
  return {
    selectedProfileId: integration?.selectedProfileId ?? '',
    enabledCapabilities: integration?.enabledCapabilities ?? [...TEAMS_CAPABILITY_VALUES],
    notificationCategories: integration?.notificationCategories ?? [...TEAMS_NOTIFICATION_VALUES],
    allowedActions: integration?.allowedActions ?? [...TEAMS_ALLOWED_ACTION_VALUES],
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

async function getDownloadErrorMessage(response: Response, t: TranslateFn): Promise<string> {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    if (typeof payload?.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
  }

  const text = await response.text().catch(() => '');
  return text.trim() || t('integrations.teams.settings.errors.downloadPackage', { defaultValue: 'Failed to download Teams app package' });
}

export function TeamsIntegrationSettings() {
  const { t } = useTranslation();
  const TEAMS_CAPABILITY_OPTIONS = React.useMemo(() => getTeamsCapabilityOptions(t), [t]);
  const TEAMS_NOTIFICATION_OPTIONS = React.useMemo(() => getTeamsNotificationOptions(t), [t]);
  const TEAMS_ALLOWED_ACTION_OPTIONS = React.useMemo(() => getTeamsAllowedActionOptions(t), [t]);
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
        throw new Error(microsoftResult.error || t('integrations.teams.settings.errors.loadGuidance', { defaultValue: 'Failed to load Teams setup guidance' }));
      }

      if (!teamsResult.success) {
        throw new Error(teamsResult.error || t('integrations.teams.settings.errors.loadGuidance', { defaultValue: 'Failed to load Teams setup guidance' }));
      }

      setFormState(mapIntegrationToForm(teamsResult.integration));
    } catch (err: any) {
      setError(err?.message || t('integrations.teams.settings.errors.loadGuidance', { defaultValue: 'Failed to load Teams setup guidance' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const profiles = microsoftStatus?.success ? microsoftStatus.profiles ?? [] : [];
  const eligibleProfiles = profiles.filter(isTeamsEligible);
  const hasEligibleProfiles = eligibleProfiles.length > 0;
  const currentIntegration = teamsStatus?.success ? teamsStatus.integration ?? null : null;
  const installStatus = currentIntegration?.installStatus ?? 'not_configured';
  const installStatusBadge = getInstallStatusBadge(installStatus, t);

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
      ? t('integrations.teams.settings.profileSummary.needsRepair', { defaultValue: 'Selected profile needs repair' })
      : t('integrations.teams.settings.profileSummary.none', { defaultValue: 'No profile selected' });

  const checklist = [
    {
      label: t('integrations.teams.settings.checklist.profileSelected.label', { defaultValue: 'Microsoft profile selected' }),
      detail: selectedProfile
        ? t('integrations.teams.settings.checklist.profileSelected.completed', { defaultValue: '{{name}} is bound for Teams.', name: selectedProfile.displayName })
        : t('integrations.teams.settings.checklist.profileSelected.pending', { defaultValue: 'Select one eligible Microsoft profile before saving or activating Teams.' }),
      complete: Boolean(selectedProfile),
    },
    {
      label: t('integrations.teams.settings.checklist.profileReady.label', { defaultValue: 'Profile ready for Teams install' }),
      detail: selectedProfile
        ? t('integrations.teams.settings.checklist.profileReady.completed', { defaultValue: 'The selected profile has client ID, tenant ID, and stored secret material.' })
        : t('integrations.teams.settings.checklist.profileReady.pending', { defaultValue: 'No selected Teams profile is ready yet.' }),
      complete: Boolean(selectedProfile?.readiness.ready),
    },
    {
      label: t('integrations.teams.settings.checklist.installState.label', { defaultValue: 'Teams install state' }),
      detail: installStatus === 'active'
        ? t('integrations.teams.settings.checklist.installState.active', { defaultValue: 'Teams is active for this tenant.' })
        : installStatus === 'install_pending'
          ? t('integrations.teams.settings.checklist.installState.pending', { defaultValue: 'Draft setup is saved and ready for install or consent.' })
          : installStatus === 'error'
            ? currentIntegration?.lastError || t('integrations.teams.settings.checklist.installState.error', { defaultValue: 'Teams setup has an error that needs remediation.' })
            : t('integrations.teams.settings.checklist.installState.notConfigured', { defaultValue: 'Save a draft or activate Teams when setup is ready.' }),
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
        throw new Error(result.error || t('integrations.teams.settings.errors.saveSettings', { defaultValue: 'Failed to save Teams settings' }));
      }

      setTeamsStatus(result);
      setFormState(mapIntegrationToForm(result.integration));
      setStatusMessage(
        resolvedStatus === 'active' && !isActive
          ? t('integrations.teams.settings.statusMessage.activated', { defaultValue: 'Teams setup activated.' })
          : resolvedStatus === 'not_configured'
            ? t('integrations.teams.settings.statusMessage.deactivated', { defaultValue: 'Teams setup deactivated.' })
            : t('integrations.teams.settings.statusMessage.saved', { defaultValue: 'Teams setup saved.' })
      );
    } catch (err: any) {
      setError(err?.message || t('integrations.teams.settings.errors.saveSettings', { defaultValue: 'Failed to save Teams settings' }));
    } finally {
      setSaving(false);
    }
  }, [canPersist, formState, isActive, t]);

  const handlePackageRefresh = React.useCallback(async () => {
    setPackageLoading(true);
    setPackageError(null);
    setStatusMessage(null);

    try {
      const result = await getTeamsAppPackageStatus();
      if (!result.success || !result.package) {
        throw new Error(result.error || t('integrations.teams.settings.errors.generatePackage', { defaultValue: 'Failed to generate Teams app package' }));
      }

      setPackageStatus(result.package);
      setStatusMessage(t('integrations.teams.settings.statusMessage.packageGenerated', { defaultValue: 'Teams app package generated.' }));
    } catch (err: any) {
      setPackageError(err?.message || t('integrations.teams.settings.errors.generatePackage', { defaultValue: 'Failed to generate Teams app package' }));
    } finally {
      setPackageLoading(false);
    }
  }, [t]);

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
        throw new Error(await getDownloadErrorMessage(response, t));
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
      setStatusMessage(t('integrations.teams.settings.statusMessage.packageDownloaded', { defaultValue: 'Teams app package downloaded.' }));
    } catch (err: any) {
      setPackageError(err?.message || t('integrations.teams.settings.errors.downloadPackage', { defaultValue: 'Failed to download Teams app package' }));
    } finally {
      setDownloadLoading(false);
    }
  }, [packageStatus, t]);

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
          <CardTitle>{t('integrations.teams.settings.title', { defaultValue: 'Microsoft Teams' })}</CardTitle>
          <CardDescription>
            {t('integrations.teams.settings.description', { defaultValue: 'Bind Teams to a Microsoft profile, enable capabilities, and generate the tenant package.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-3">
            <Badge variant={installStatusBadge.variant}>{installStatusBadge.label}</Badge>
            <span className="text-sm text-muted-foreground">{selectedProfileSummary}</span>
          </div>

          <div className="space-y-3">
            {checklist.map((item) => (
              <ChecklistItem key={item.label} {...item} readyLabel={t('integrations.teams.settings.checklist.ready', { defaultValue: 'Ready' })} needsActionLabel={t('integrations.teams.settings.checklist.needsAction', { defaultValue: 'Needs action' })} />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <GuidanceBlock
              title={t('integrations.teams.settings.guidance.requiredScopes', { defaultValue: 'Required scopes' })}
              items={teamsScopes.map((value) => ({ label: value, value }))}
            />
            <GuidanceBlock
              title={t('integrations.teams.settings.guidance.redirectUris', { defaultValue: 'Redirect URIs' })}
              items={[
                { label: t('integrations.teams.settings.guidance.personalTab', { defaultValue: 'Personal tab' }), value: redirectUris?.teamsTab || t('integrations.teams.settings.guidance.unavailable', { defaultValue: 'Unavailable' }) },
                { label: t('integrations.teams.settings.guidance.personalBot', { defaultValue: 'Personal bot' }), value: redirectUris?.teamsBot || t('integrations.teams.settings.guidance.unavailable', { defaultValue: 'Unavailable' }) },
                {
                  label: t('integrations.teams.settings.guidance.messageExtension', { defaultValue: 'Message extension' }),
                  value: redirectUris?.teamsMessageExtension || t('integrations.teams.settings.guidance.unavailable', { defaultValue: 'Unavailable' }),
                },
              ]}
            />
          </div>

          {teamsApplicationIdUri ? (
            <GuidanceBlock
              title={t('integrations.teams.settings.guidance.applicationIdUri', { defaultValue: 'Application ID URI' })}
              items={[{ label: t('integrations.teams.settings.guidance.teamsAppIdUri', { defaultValue: 'Teams app ID URI' }), value: teamsApplicationIdUri }]}
            />
          ) : null}

          <div className="space-y-4">
            <div>
              <Label htmlFor="teams-profile">{t('integrations.teams.settings.profileLabel', { defaultValue: 'Microsoft profile' })}</Label>
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
                <option value="">{t('integrations.teams.settings.selectProfile', { defaultValue: 'Select profile' })}</option>
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
                  {t('integrations.teams.settings.noEligibleProfiles', { defaultValue: 'No Microsoft profiles are ready for Teams. Finish Microsoft setup first.' })}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-3">
                <div className="text-sm font-medium">{t('integrations.teams.settings.section.capabilities', { defaultValue: 'Capabilities' })}</div>
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
                <div className="text-sm font-medium">{t('integrations.teams.settings.section.notifications', { defaultValue: 'Notifications' })}</div>
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
                <div className="text-sm font-medium">{t('integrations.teams.settings.section.allowedActions', { defaultValue: 'Allowed actions' })}</div>
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
              {saving
                ? t('integrations.teams.settings.actions.saving', { defaultValue: 'Saving...' })
                : isActive
                  ? t('integrations.teams.settings.actions.saveChanges', { defaultValue: 'Save changes' })
                  : t('integrations.teams.settings.actions.saveDraft', { defaultValue: 'Save draft' })}
            </Button>
            <Button
              id="teams-activate"
              variant="secondary"
              onClick={() => void handleSave('active')}
              disabled={saving || !canActivate}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {isActive
                ? t('integrations.teams.settings.actions.teamsActive', { defaultValue: 'Teams active' })
                : t('integrations.teams.settings.actions.activate', { defaultValue: 'Activate Teams' })}
            </Button>
            <Button
              id="teams-deactivate"
              variant="outline"
              onClick={() => void handleSave('not_configured')}
              disabled={saving || !canDeactivate}
            >
              {t('integrations.teams.settings.actions.deactivate', { defaultValue: 'Deactivate' })}
            </Button>
            <Button id="teams-reload" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('integrations.teams.settings.actions.reload', { defaultValue: 'Reload' })}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.teams.settings.package.title', { defaultValue: 'Teams Package' })}</CardTitle>
          <CardDescription>
            {t('integrations.teams.settings.package.description', { defaultValue: 'Generate the app manifest and installation links for the selected Microsoft profile.' })}
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
              {packageLoading
                ? t('integrations.teams.settings.package.generating', { defaultValue: 'Generating...' })
                : t('integrations.teams.settings.package.generate', { defaultValue: 'Generate package' })}
            </Button>
          </div>

          {packageStatus ? (
            <div className="space-y-4 rounded-md border p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <GuidanceBlock
                  title={t('integrations.teams.settings.package.section', { defaultValue: 'Package' })}
                  items={[
                    { label: t('integrations.teams.settings.package.manifestVersion', { defaultValue: 'Manifest version' }), value: packageStatus.manifestVersion },
                    { label: t('integrations.teams.settings.package.packageVersion', { defaultValue: 'Package version' }), value: packageStatus.packageVersion },
                    { label: t('integrations.teams.settings.package.fileName', { defaultValue: 'File name' }), value: packageStatus.fileName },
                  ]}
                />
                <GuidanceBlock
                  title={t('integrations.teams.settings.package.appIds', { defaultValue: 'App IDs' })}
                  items={[
                    { label: t('integrations.teams.settings.package.appId', { defaultValue: 'App ID' }), value: packageStatus.appId },
                    { label: t('integrations.teams.settings.package.botId', { defaultValue: 'Bot ID' }), value: packageStatus.botId },
                    { label: t('integrations.teams.settings.package.webResource', { defaultValue: 'Web application resource' }), value: packageStatus.webApplicationInfo.resource },
                  ]}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <GuidanceBlock
                  title={t('integrations.teams.settings.package.validDomains', { defaultValue: 'Valid domains' })}
                  items={packageStatus.validDomains.map((value) => ({ label: value, value }))}
                />
                <GuidanceBlock
                  title={t('integrations.teams.settings.package.deepLinks', { defaultValue: 'Deep links' })}
                  items={[
                    { label: t('integrations.teams.settings.package.myWork', { defaultValue: 'My work' }), value: packageStatus.deepLinks.myWork },
                    { label: t('integrations.teams.settings.package.ticketTemplate', { defaultValue: 'Ticket template' }), value: packageStatus.deepLinks.ticketTemplate },
                    { label: t('integrations.teams.settings.package.projectTaskTemplate', { defaultValue: 'Project task template' }), value: packageStatus.deepLinks.projectTaskTemplate },
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
                  {downloadLoading
                    ? t('integrations.teams.settings.package.downloading', { defaultValue: 'Downloading...' })
                    : t('integrations.teams.settings.package.downloadZip', { defaultValue: 'Download app package (.zip)' })}
                </Button>
                <Button id="teams-download-manifest" asChild variant="secondary">
                  <a href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(packageStatus.manifest, null, 2))}`} download={`${packageStatus.fileName.replace(/\.zip$/, '')}.json`}>
                    <Download className="mr-2 h-4 w-4" />
                    {t('integrations.teams.settings.package.downloadManifest', { defaultValue: 'Download manifest JSON' })}
                  </a>
                </Button>
                <Button id="teams-open-deeplink" asChild variant="outline">
                  <a href={packageStatus.deepLinks.myWork} target="_blank" rel="noreferrer">
                    <MessageSquareShare className="mr-2 h-4 w-4" />
                    {t('integrations.teams.settings.package.openDeeplink', { defaultValue: 'Open Teams deep link' })}
                  </a>
                </Button>
                <Button id="teams-open-base-url" asChild variant="outline">
                  <a href={packageStatus.baseUrl} target="_blank" rel="noreferrer">
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                    {t('integrations.teams.settings.package.openBaseUrl', { defaultValue: 'Open PSA base URL' })}
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
