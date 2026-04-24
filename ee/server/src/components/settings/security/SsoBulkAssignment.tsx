"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@alga-psa/ui/components/Card";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import { Switch } from "@alga-psa/ui/components/Switch";
import SettingsTabSkeleton from "@alga-psa/ui/components/skeletons/SettingsTabSkeleton";
import type { SsoProviderOption } from "@ee/lib/auth/providerConfig";
import { getSsoProviderOptionsAction } from "@ee/lib/actions/auth/getSsoProviderOptions";
import { getSsoPreferencesAction, updateSsoPreferencesAction, type SsoPreferences } from "@ee/lib/actions/auth/ssoPreferences";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import SsoBulkAssignmentForm from "./SsoBulkAssignmentForm";

export default function SsoBulkAssignment() {
  const { t } = useTranslation("msp/settings");
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
          setError(err?.message ?? t("ssoBulk.errors.loadProviders"));
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
  }, [t]);

  if (isLoading) {
    return (
      <SettingsTabSkeleton
        title={t("ssoBulk.loading.title")}
        description={t("ssoBulk.loading.description")}
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
      setError(err?.message ?? t("ssoBulk.errors.updatePreferences"));
    } finally {
      setPrefPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("ssoBulk.autoLink.title")}</CardTitle>
          <CardDescription>
            {t("ssoBulk.autoLink.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-muted-foreground/20 p-4">
            <div className="max-w-xl space-y-1">
              <p className="text-sm text-muted-foreground">
                {t("ssoBulk.autoLink.body")}
              </p>
            </div>
            <Switch
              checked={autoLinkEnabled}
              onCheckedChange={handleAutoLinkToggle}
              disabled={prefPending}
              aria-label={t("ssoBulk.autoLink.toggleLabel")}
            />
          </div>
          {!autoLinkEnabled && (
            <Alert variant="info">
              <AlertDescription>
                {t("ssoBulk.autoLink.disabledInfo")}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("ssoBulk.bulk.title")}</CardTitle>
          <CardDescription>
            {t("ssoBulk.bulk.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shouldShowFallback ? (
            <Alert variant="info">
              <AlertDescription>
                {error ?? t("ssoBulk.bulk.noProviders")}
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
