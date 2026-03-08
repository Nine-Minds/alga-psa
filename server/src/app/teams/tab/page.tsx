import { redirect } from 'next/navigation';
import { Card } from '@alga-psa/ui/components/Card';
import { buildTeamsReauthPath } from 'server/src/lib/teams/buildTeamsReauthUrl';
import { resolveTeamsTabAccessState } from 'server/src/lib/teams/resolveTeamsTabAccessState';
import { resolveTeamsTabAuthState } from 'server/src/lib/teams/resolveTeamsTabAuthState';
import {
  describeTeamsTabDestination,
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

export default async function TeamsTabPage({ searchParams }: TeamsTabPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const destination = resolveTeamsTabDestination(params);
  const destinationCopy = describeTeamsTabDestination(destination);
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
    return (
      <Card className="m-6 p-6 text-sm text-gray-700">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">Requested Teams record unavailable</h1>
          <p>{accessState.message}</p>
          <p>Return to your Teams work list or open the full PSA app if you need a different record.</p>
        </div>
      </Card>
    );
  }

  return (
    <div
      className="mx-auto max-w-3xl p-6"
      data-teams-tab-state="ready"
      data-teams-tab-destination={destination.type}
    >
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-teal-700">Microsoft Teams</p>
          <h1 className="text-2xl font-semibold text-gray-900">{destinationCopy.title}</h1>
        </div>
        <p className="text-sm text-gray-600">
          Signed in as {state.userName || state.userEmail || state.userId} for tenant {state.tenantId}.
        </p>
        <p className="text-sm text-gray-600">
          Teams tab SSO is active with Microsoft profile {state.profileId}. {destinationCopy.summary}
        </p>
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
