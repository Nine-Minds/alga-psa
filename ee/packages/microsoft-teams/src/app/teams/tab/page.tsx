import { Card } from '@alga-psa/ui/components/Card';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { TFunction } from 'i18next';
import { getTeamsAvailability, type TeamsAvailability } from '../../../lib/teams/teamsAvailability';
import { buildTeamsReauthPath } from '../../../lib/teams/buildTeamsReauthUrl';
import { buildTeamsFullPsaUrl } from '../../../lib/teams/buildTeamsFullPsaUrl';
import { resolveTeamsTabAccessState } from '../../../lib/teams/resolveTeamsTabAccessState';
import { resolveTeamsTabAuthState } from '../../../lib/teams/resolveTeamsTabAuthState';
import {
  resolveTeamsTabEntrySource,
  type TeamsTabEntrySource,
  type TeamsTabDestination,
  resolveTeamsTabDestination,
} from '../../../lib/teams/resolveTeamsTabDestination';
import { TeamsTabSignInGate } from './TeamsTabSignInGate';

const TEAMS_POPUP_COMPLETE_PATH = '/teams/auth/popup-complete';

interface TeamsTabPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function getExpectedTenantId(params?: Record<string, string | string[] | undefined>): string | undefined {
  return (
    (typeof params?.tenantId === 'string' ? params.tenantId : undefined) ||
    (typeof params?.tenant === 'string' ? params.tenant : undefined)
  );
}

function getExpectedMicrosoftTenantId(params?: Record<string, string | string[] | undefined>): string | undefined {
  return (
    (typeof params?.microsoftTenantId === 'string' ? params.microsoftTenantId : undefined) ||
    (typeof params?.teamsTenantId === 'string' ? params.teamsTenantId : undefined) ||
    (typeof params?.tid === 'string' ? params.tid : undefined)
  );
}

function buildTeamsTabCallbackUrl(params?: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (typeof entry === 'string') {
          query.append(key, entry);
        }
      });
      return;
    }

    if (typeof value === 'string') {
      query.set(key, value);
    }
  });

  const suffix = query.toString();
  return suffix ? `/teams/tab?${suffix}` : '/teams/tab';
}

function describeDestinationLocalized(
  t: TFunction,
  destination: TeamsTabDestination
): { title: string; summary: string } {
  switch (destination.type) {
    case 'ticket':
      return {
        title: t('pages.teamsTab.destinations.ticket.title', { ticketId: destination.ticketId }),
        summary: t('pages.teamsTab.destinations.ticket.summary', { ticketId: destination.ticketId }),
      };
    case 'project_task':
      return {
        title: t('pages.teamsTab.destinations.projectTask.title', { taskId: destination.taskId }),
        summary: t('pages.teamsTab.destinations.projectTask.summary', {
          taskId: destination.taskId,
          projectId: destination.projectId,
        }),
      };
    case 'approval':
      return {
        title: t('pages.teamsTab.destinations.approval.title', { approvalId: destination.approvalId }),
        summary: t('pages.teamsTab.destinations.approval.summary', { approvalId: destination.approvalId }),
      };
    case 'time_entry':
      return {
        title: t('pages.teamsTab.destinations.timeEntry.title', { entryId: destination.entryId }),
        summary: t('pages.teamsTab.destinations.timeEntry.summary', { entryId: destination.entryId }),
      };
    case 'contact':
      return {
        title: t('pages.teamsTab.destinations.contact.title', { contactId: destination.contactId }),
        summary: destination.clientId
          ? t('pages.teamsTab.destinations.contact.summaryWithClient', {
              contactId: destination.contactId,
              clientId: destination.clientId,
            })
          : t('pages.teamsTab.destinations.contact.summary', { contactId: destination.contactId }),
      };
    case 'my_work':
    default:
      return {
        title: t('pages.teamsTab.destinations.myWork.title'),
        summary: t('pages.teamsTab.destinations.myWork.summary'),
      };
  }
}

async function renderAvailabilityCard(availability: Extract<TeamsAvailability, { enabled: false }>) {
  const { t } = await getServerTranslation(undefined, 'common');
  return (
    <Card className="m-6 p-6 text-sm text-gray-700">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-gray-900">{t('pages.errors.teamsTabUnavailable')}</h1>
        <p>{availability.message}</p>
        <p>{t('pages.errors.teamsTabEnableHint')}</p>
      </div>
    </Card>
  );
}

async function renderTeamsTabShell(options: {
  state: Extract<Awaited<ReturnType<typeof resolveTeamsTabAuthState>>, { status: 'ready' }>;
  destination: TeamsTabDestination;
  entrySource: TeamsTabEntrySource;
  requestedDestination?: TeamsTabDestination;
  fallbackMessage?: string;
}) {
  const { t } = await getServerTranslation(undefined, 'common');
  const destinationCopy = describeDestinationLocalized(t, options.destination);
  const requestedDestination = options.requestedDestination || options.destination;
  const requestedDestinationCopy = describeDestinationLocalized(t, requestedDestination);
  const isFallback = requestedDestination.type !== options.destination.type;
  const fullPsaUrl = buildTeamsFullPsaUrl(requestedDestination);
  const embeddedPsaUrl = !isFallback ? fullPsaUrl : null;
  const signedInAs = options.state.userName || options.state.userEmail || options.state.userId;

  return (
    <div
      className="flex h-screen w-full flex-col bg-gray-50"
      data-teams-tab-state="ready"
      data-teams-tab-destination={options.destination.type}
      data-teams-tab-entry-source={options.entrySource}
      data-teams-tab-requested-destination={requestedDestination.type}
      data-teams-tab-fallback={isFallback ? options.destination.type : undefined}
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-gray-900">{destinationCopy.title}</h1>
          <p className="truncate text-xs text-gray-500">
            {t('pages.teamsTab.signedInAs', { name: signedInAs })}
          </p>
        </div>
        {fullPsaUrl ? (
          <a
            className="inline-flex shrink-0 items-center rounded-md border border-teal-200 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50"
            data-teams-open-full-psa={fullPsaUrl}
            href={fullPsaUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('pages.teamsTab.openInFullPsa')}
          </a>
        ) : null}
      </header>

      {options.fallbackMessage ? (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <span className="font-medium">{t('pages.teamsTab.fallback.label')} </span>
          <span>{options.fallbackMessage}</span>
          <span>
            {' '}
            {t('pages.teamsTab.fallback.showingInstead', {
              destination: requestedDestinationCopy.title.toLowerCase(),
            })}
          </span>
        </div>
      ) : null}

      {embeddedPsaUrl ? (
        <iframe
          className="w-full flex-1 border-0 bg-white"
          data-teams-embedded-psa={embeddedPsaUrl}
          src={embeddedPsaUrl}
          title={t('pages.teamsTab.iframeTitle', { destination: requestedDestinationCopy.title })}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="max-w-lg p-6 text-sm text-gray-700">
            <div className="space-y-2">
              <p>{destinationCopy.summary}</p>
              {options.entrySource === 'bot' ? (
                <p className="text-gray-500">{t('pages.teamsTab.entrySource.bot')}</p>
              ) : null}
              {options.entrySource === 'message_extension' ? (
                <p className="text-gray-500">{t('pages.teamsTab.entrySource.messageExtension')}</p>
              ) : null}
              {options.entrySource === 'notification' ? (
                <p className="text-gray-500">{t('pages.teamsTab.entrySource.notification')}</p>
              ) : null}
              {fullPsaUrl ? (
                <p className="text-gray-500">{t('pages.teamsTab.fullPsaHint')}</p>
              ) : null}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default async function TeamsTabPage({ searchParams }: TeamsTabPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const destination = resolveTeamsTabDestination(params);
  const entrySource = resolveTeamsTabEntrySource(params);
  const expectedTenantId = getExpectedTenantId(params);

  if (expectedTenantId) {
    const availability = await getTeamsAvailability({ tenantId: expectedTenantId });
    if (availability.enabled === false) {
      return await renderAvailabilityCard(availability);
    }
  }

  const state = await resolveTeamsTabAuthState({
    expectedTenantId,
    expectedMicrosoftTenantId: getExpectedMicrosoftTenantId(params),
  });

  if (state.status === 'unauthenticated') {
    // Teams hosts this page inside an iframe, so a top-level NextAuth redirect
    // fails on CSRF cookies (third-party cookie restrictions). The gate
    // initializes the Teams SDK client-side and opens the MSP sign-in inside a
    // Teams-managed popup window, which runs in a top-level context where
    // cookies work normally. Browser users fall through to the legacy
    // fallbackSignInUrl redirect inside the gate.
    const originalCallbackUrl = buildTeamsTabCallbackUrl(params);
    const fallbackSignInUrl = buildTeamsReauthPath(originalCallbackUrl);
    const popupSignInUrl = buildTeamsReauthPath(TEAMS_POPUP_COMPLETE_PATH);
    return (
      <TeamsTabSignInGate
        fallbackSignInUrl={fallbackSignInUrl}
        popupSignInUrl={popupSignInUrl}
      />
    );
  }

  const availability = await getTeamsAvailability({
    tenantId: state.tenantId || expectedTenantId || undefined,
    userId: state.status === 'ready' ? state.userId : undefined,
  });
  if (availability.enabled === false) {
    return await renderAvailabilityCard(availability);
  }

  if (state.status !== 'ready') {
    const { t } = await getServerTranslation(undefined, 'common');
    return (
      <Card className="m-6 p-6 text-sm text-gray-700">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">
            {state.status === 'not_configured'
              ? t('pages.errors.teamsSetupNotFinished')
              : t('pages.errors.teamsTabUnavailable')}
          </h1>
          <p>{state.message}</p>
          <p>
            {state.status === 'not_configured'
              ? t('pages.errors.teamsSetupNotFinishedHint')
              : t('pages.errors.teamsTabAdminHint')}
          </p>
        </div>
      </Card>
    );
  }

  const accessState = await resolveTeamsTabAccessState(state, destination);
  if (accessState.status !== 'ready') {
    return await renderTeamsTabShell({
      state,
      destination: { type: 'my_work' },
      entrySource,
      requestedDestination: destination,
      fallbackMessage: accessState.message,
    });
  }

  return await renderTeamsTabShell({ state, destination, entrySource });
}

export const dynamic = 'force-dynamic';
