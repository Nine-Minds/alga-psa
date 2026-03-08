import { redirect } from 'next/navigation';
import { Card } from '@alga-psa/ui/components/Card';
import { buildTeamsReauthPath } from 'server/src/lib/teams/buildTeamsReauthUrl';
import { buildTeamsFullPsaUrl } from 'server/src/lib/teams/buildTeamsFullPsaUrl';
import { resolveTeamsTabAccessState } from 'server/src/lib/teams/resolveTeamsTabAccessState';
import { resolveTeamsTabAuthState } from 'server/src/lib/teams/resolveTeamsTabAuthState';
import {
  describeTeamsTabDestination,
  type TeamsTabDestination,
  resolveTeamsTabDestination,
} from 'server/src/lib/teams/resolveTeamsTabDestination';

interface TeamsTabPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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

function renderTeamsTabShell(options: {
  state: Extract<Awaited<ReturnType<typeof resolveTeamsTabAuthState>>, { status: 'ready' }>;
  destination: TeamsTabDestination;
  requestedDestination?: TeamsTabDestination;
  fallbackMessage?: string;
}) {
  const destinationCopy = describeTeamsTabDestination(options.destination);
  const requestedDestination = options.requestedDestination || options.destination;
  const requestedDestinationCopy = describeTeamsTabDestination(requestedDestination);
  const isFallback = requestedDestination.type !== options.destination.type;
  const fullPsaUrl = buildTeamsFullPsaUrl(requestedDestination);

  return (
    <div
      className="mx-auto max-w-3xl p-6"
      data-teams-tab-state="ready"
      data-teams-tab-destination={options.destination.type}
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
        <p className="text-sm text-gray-600">
          Teams tab SSO is active with Microsoft profile {options.state.profileId}. {destinationCopy.summary}
        </p>
        {fullPsaUrl ? (
          <div>
            <a
              className="inline-flex items-center rounded-md border border-teal-200 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50"
              data-teams-open-full-psa={fullPsaUrl}
              href={fullPsaUrl}
            >
              Open in full PSA
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default async function TeamsTabPage({ searchParams }: TeamsTabPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const destination = resolveTeamsTabDestination(params);
  const state = await resolveTeamsTabAuthState({
    expectedTenantId:
      (typeof params?.tenantId === 'string' ? params.tenantId : undefined) ||
      (typeof params?.tenant === 'string' ? params.tenant : undefined),
    expectedMicrosoftTenantId: getExpectedMicrosoftTenantId(params),
  });

  if (state.status === 'unauthenticated') {
    redirect(buildTeamsReauthPath(buildTeamsTabCallbackUrl(params)));
  }

  if (state.status !== 'ready') {
    return (
      <Card className="m-6 p-6 text-sm text-gray-700">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">Teams tab unavailable</h1>
          <p>{state.message}</p>
          <p>Ask a PSA administrator to finish Teams setup, then reopen the tab.</p>
        </div>
      </Card>
    );
  }

  const accessState = await resolveTeamsTabAccessState(state, destination);
  if (accessState.status !== 'ready') {
    return renderTeamsTabShell({
      state,
      destination: { type: 'my_work' },
      requestedDestination: destination,
      fallbackMessage: accessState.message,
    });
  }

  return renderTeamsTabShell({ state, destination });
}

export const dynamic = 'force-dynamic';
