'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { getMicrosoftIntegrationStatus } from '@alga-psa/integrations/actions';
import { ArrowUpRight, CheckCircle2, MessageSquareShare } from 'lucide-react';

type MicrosoftIntegrationStatus = Awaited<ReturnType<typeof getMicrosoftIntegrationStatus>>;
type MicrosoftProfile = NonNullable<MicrosoftIntegrationStatus['profiles']>[number];

function isTeamsEligible(profile: MicrosoftProfile): boolean {
  return !profile.isArchived && profile.readiness.ready;
}

export function TeamsIntegrationSettings() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<MicrosoftIntegrationStatus | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await getMicrosoftIntegrationStatus();
    setStatus(result);
    if (!result.success) {
      setError(result.error || 'Failed to load Teams setup guidance');
    }

    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const profiles = status?.success ? status.profiles ?? [] : [];
  const eligibleProfiles = profiles.filter(isTeamsEligible);

  return (
    <Card id="teams-integration-settings">
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <CardTitle>Microsoft Teams</CardTitle>
            <CardDescription>
              Guided tenant setup for the personal tab, personal bot, message extension, and personal activity notifications starts here.
            </CardDescription>
          </div>
          <Button id="teams-setup-refresh" type="button" variant="outline" onClick={() => void load()} disabled={loading}>
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

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : eligibleProfiles.length === 0 ? (
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
            <Alert variant="info">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                {eligibleProfiles.length === 1
                  ? 'One Microsoft profile is ready for Teams setup.'
                  : `${eligibleProfiles.length} Microsoft profiles are ready for Teams setup.`}
              </AlertDescription>
            </Alert>

            <div className="grid gap-3 md:grid-cols-2">
              {eligibleProfiles.map((profile) => (
                <div key={profile.profileId} className="rounded-lg border bg-muted/10 p-4">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{profile.displayName}</div>
                    {profile.isDefault && <Badge variant="info">Default</Badge>}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Client ID: <span className="font-mono">{profile.clientId}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Tenant ID: <span className="font-mono">{profile.tenantId}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="text-sm font-medium">Next Teams setup slice</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Select one eligible profile, then complete install state, capability toggles, notification preferences, and allowed-action settings.
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
