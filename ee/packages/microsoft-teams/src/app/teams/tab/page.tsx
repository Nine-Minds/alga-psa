import { Card } from '@alga-psa/ui/components/Card';
import { getTeamsAvailability, type TeamsAvailability } from '../../../lib/teams/teamsAvailability';
import { buildTeamsReauthPath } from '../../../lib/teams/buildTeamsReauthUrl';
import { buildTeamsFullPsaUrl } from '../../../lib/teams/buildTeamsFullPsaUrl';
import { resolveTeamsTabAccessState } from '../../../lib/teams/resolveTeamsTabAccessState';
import { resolveTeamsTabAuthState } from '../../../lib/teams/resolveTeamsTabAuthState';
import {
  describeTeamsTabDestination,
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

function renderAvailabilityCard(availability: Extract<TeamsAvailability, { enabled: false }>) {
  return (
    <Card className="m-6 p-6 text-sm text-gray-700">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-gray-900">Teams tab unavailable</h1>
        <p>{availability.message}</p>
        <p>Ask a PSA administrator to enable Teams for this tenant before reopening the personal tab.</p>
      </div>
    </Card>
  );
}

function renderTeamsTabShell(options: {
  state: Extract<Awaited<ReturnType<typeof resolveTeamsTabAuthState>>, { status: 'ready' }>;
  destination: TeamsTabDestination;
  entrySource: TeamsTabEntrySource;
  requestedDestination?: TeamsTabDestination;
  fallbackMessage?: string;
}) {
  const destinationCopy = describeTeamsTabDestination(options.destination);
  const requestedDestination = options.requestedDestination || options.destination;
  const requestedDestinationCopy = describeTeamsTabDestination(requestedDestination);
  const isFallback = requestedDestination.type !== options.destination.type;
  const fullPsaUrl = buildTeamsFullPsaUrl(requestedDestination);
  const embeddedPsaUrl = !isFallback ? fullPsaUrl : null;

  return (
    <div
      className="mx-auto max-w-3xl p-6"
      data-teams-tab-state="ready"
      data-teams-tab-destination={options.destination.type}
      data-teams-tab-entry-source={options.entrySource}
      data-teams-tab-requested-destination={requestedDestination.type}
      data-teams-tab-fallback={isFallback ? options.destination.type : undefined}
    >
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-teal-700">Microsoft Teams</p>
          <h1 className="text-2xl font-semibold text-gray-900">{destinationCopy.title}</h1>
        </div>
        {options.fallbackMessage ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Requested Teams record unavailable</p>
            <p>{options.fallbackMessage}</p>
            <p>You landed on your Teams work list instead of {requestedDestinationCopy.title.toLowerCase()}.</p>
          </div>
        ) : null}
        <p className="text-sm text-gray-600">
          Signed in as {options.state.userName || options.state.userEmail || options.state.userId} for tenant{' '}
          {options.state.tenantId}.
        </p>
        {options.entrySource === 'bot' ? (
          <p className="text-sm text-gray-600">This record was opened from a Teams bot result.</p>
        ) : null}
        {options.entrySource === 'message_extension' ? (
          <p className="text-sm text-gray-600">This record was opened from a Teams message extension result.</p>
        ) : null}
        {options.entrySource === 'notification' ? (
          <p className="text-sm text-gray-600">This record was opened from a Teams activity notification.</p>
        ) : null}
        <p className="text-sm text-gray-600">
          Teams tab SSO is active with Microsoft profile {options.state.profileId}. {destinationCopy.summary}
        </p>
        {fullPsaUrl ? (
          <div className="space-y-2">
            <a
              className="inline-flex items-center rounded-md border border-teal-200 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50"
              data-teams-open-full-psa={fullPsaUrl}
              href={fullPsaUrl}
            >
              Open in full PSA
            </a>
            <p className="text-sm text-gray-600">
              Use the full PSA view when this workflow needs more context than a Teams card or quick action can provide.
            </p>
          </div>
        ) : null}
        {embeddedPsaUrl ? (
          <iframe
            className="min-h-[720px] w-full rounded-lg border border-gray-200 bg-white"
            data-teams-embedded-psa={embeddedPsaUrl}
            src={embeddedPsaUrl}
            title={`${requestedDestinationCopy.title} in Alga PSA`}
          />
        ) : null}
      </div>
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
      return renderAvailabilityCard(availability);
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
    return renderAvailabilityCard(availability);
  }

  if (state.status !== 'ready') {
    return (
      <Card className="m-6 p-6 text-sm text-gray-700">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">
            {state.status === 'not_configured' ? 'Teams setup not finished' : 'Teams tab unavailable'}
          </h1>
          <p>{state.message}</p>
          <p>
            {state.status === 'not_configured'
              ? 'Ask a PSA administrator to finish Teams setup and then reopen the personal tab.'
              : 'Ask a PSA administrator to finish Teams setup, then reopen the tab.'}
          </p>
        </div>
      </Card>
    );
  }

  const accessState = await resolveTeamsTabAccessState(state, destination);
  if (accessState.status !== 'ready') {
    return renderTeamsTabShell({
      state,
      destination: { type: 'my_work' },
      entrySource,
      requestedDestination: destination,
      fallbackMessage: accessState.message,
    });
  }

  return renderTeamsTabShell({ state, destination, entrySource });
}

export const dynamic = 'force-dynamic';
