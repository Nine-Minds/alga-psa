"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "server/src/components/ui/Card";
import { Alert, AlertDescription } from "server/src/components/ui/Alert";
import { Switch } from "server/src/components/ui/Switch";
import SettingsTabSkeleton from "server/src/components/ui/skeletons/SettingsTabSkeleton";
import type { SsoProviderOption } from "@ee/lib/auth/providerConfig";
import { getSsoProviderOptionsAction } from "@ee/lib/actions/auth/getSsoProviderOptions";
import { getSsoPreferencesAction, updateSsoPreferencesAction, type SsoPreferences } from "@ee/lib/actions/auth/ssoPreferences";
import SsoBulkAssignmentForm from "./SsoBulkAssignmentForm";

export default function SsoBulkAssignment() {
  const [providerOptions, setProviderOptions] = useState<SsoProviderOption[] | null>(null);
  const [preferences, setPreferences] = useState<SsoPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prefPending, setPrefPending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadProviderOptions() {
      try {
        const [optionsResult, prefsResult] = await Promise.all([
          getSsoProviderOptionsAction({ scope: "settings" }),
          getSsoPreferencesAction(),
        ]);
        if (!cancelled) {
          setProviderOptions(optionsResult.options);
          setPreferences(prefsResult);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? "Unable to load SSO provider configuration.");
          setProviderOptions([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadProviderOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return (
      <SettingsTabSkeleton
        title="Single Sign-On"
        description="Loading SSO bulk assignment tools..."
        showTable
      />
    );
  }

  const shouldShowFallback = !providerOptions || providerOptions.length === 0;
  const autoLinkEnabled = Boolean(preferences?.autoLinkInternal);

  async function handleAutoLinkToggle(checked: boolean) {
    setPrefPending(true);
    try {
      const updated = await updateSsoPreferencesAction({ autoLinkInternal: checked });
      setPreferences(updated);
    } catch (err: any) {
      setError(err?.message ?? "Unable to update SSO preferences.");
    } finally {
      setPrefPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Automatically support SSO for new internal users</CardTitle>
          <CardDescription>
            Enforce your corporate SSO provider whenever new staff accounts are created. Tenants that opt into
            this policy will avoid password-based sign-ins altogether.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-muted-foreground/20 p-4">
            <div className="max-w-xl space-y-1">
              <p className="text-sm text-muted-foreground">
                When enabled, staff whose email already exists in the directory can sign in with Google or Microsoft as
                soon as their email matches—no manual linking required.
              </p>
            </div>
            <Switch
              checked={autoLinkEnabled}
              onCheckedChange={handleAutoLinkToggle}
              disabled={prefPending}
              aria-label="Toggle automatic SSO matching"
            />
          </div>
          {!autoLinkEnabled && (
            <Alert variant="info">
              <AlertDescription>
                Enable this toggle to let new and existing staff skip the “Connect SSO” flow when their email already
                matches a configured provider. We’ll still log every automatic link.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bulk Single Sign-On Assignment</CardTitle>
          <CardDescription>
            Select internal users from the list below and link them to a configured Google or Microsoft provider.
            Use preview to double-check the impact before executing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shouldShowFallback ? (
            <Alert variant="info">
              <AlertDescription>
                {error ??
                  "No SSO providers are configured yet. Add OAuth credentials to continue with bulk assignments."}
              </AlertDescription>
            </Alert>
          ) : (
            <SsoBulkAssignmentForm providerOptions={providerOptions} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
