import { redirect } from 'next/navigation';
import { Card } from '@alga-psa/ui/components/Card';
import { resolveTeamsTabAuthState } from 'server/src/lib/teams/resolveTeamsTabAuthState';

interface TeamsTabPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function getSingleSearchParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getExpectedMicrosoftTenantId(params?: Record<string, string | string[] | undefined>): string | undefined {
  return (
    getSingleSearchParam(params?.microsoftTenantId) ||
    getSingleSearchParam(params?.teamsTenantId) ||
    getSingleSearchParam(params?.tid)
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
  const state = await resolveTeamsTabAuthState({
    expectedTenantId: getSingleSearchParam(params?.tenantId) ?? getSingleSearchParam(params?.tenant),
    expectedMicrosoftTenantId: getExpectedMicrosoftTenantId(params),
  });

  if (state.status === 'unauthenticated') {
    redirect(`/auth/msp/signin?callbackUrl=${encodeURIComponent(buildTeamsTabCallbackUrl(params))}`);
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

  return (
    <div className="mx-auto max-w-3xl p-6" data-teams-tab-state="ready">
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-teal-700">Microsoft Teams</p>
          <h1 className="text-2xl font-semibold text-gray-900">My work</h1>
        </div>
        <p className="text-sm text-gray-600">
          Signed in as {state.userName || state.userEmail || state.userId} for tenant {state.tenantId}.
        </p>
        <p className="text-sm text-gray-600">
          Teams tab SSO is active with Microsoft profile {state.profileId}. Rich ticket, task, approval, and
          time-entry views will load here.
        </p>
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
