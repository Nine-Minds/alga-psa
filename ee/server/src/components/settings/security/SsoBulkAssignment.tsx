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
  const autoLinkInternalEnabled = Boolean(preferences?.autoLinkInternal);
  const autoLinkClientEnabled = Boolean(preferences?.autoLinkClient);
  const clientPortalEntraProvisioningMode = preferences?.clientPortalEntraProvisioningMode ?? "disabled";
  const clientPortalDefaultRoleName = preferences?.clientPortalDefaultRoleName ?? "User";
  const deactivateOnEntitlementRemoval =
    preferences?.deactivateEntraManagedPortalUsersOnEntitlementRemoval ?? true;

  async function handleInternalAutoLinkToggle(checked: boolean) {
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

  async function handleClientAutoLinkToggle(checked: boolean) {
    setPrefPending(true);
    try {
      const updated = await updateSsoPreferencesAction({ autoLinkClient: checked });
      setPreferences(updated);
    } catch (err: any) {
      setError(err?.message ?? t("ssoBulk.errors.updatePreferences"));
    } finally {
      setPrefPending(false);
    }
  }

  async function handleProvisioningModeChange(mode: SsoPreferences["clientPortalEntraProvisioningMode"]) {
    setPrefPending(true);
    try {
      const updated = await updateSsoPreferencesAction({ clientPortalEntraProvisioningMode: mode });
      setPreferences(updated);
    } catch (err: any) {
      setError(err?.message ?? t("ssoBulk.errors.updatePreferences"));
    } finally {
      setPrefPending(false);
    }
  }

  async function handleDeactivateToggle(checked: boolean) {
    setPrefPending(true);
    try {
      const updated = await updateSsoPreferencesAction({
        deactivateEntraManagedPortalUsersOnEntitlementRemoval: checked,
      });
      setPreferences(updated);
    } catch (err: any) {
      setError(err?.message ?? t("ssoBulk.errors.updatePreferences"));
    } finally {
      setPrefPending(false);
    }
  }

  async function handleDefaultRoleNameBlur(roleName: string) {
    setPrefPending(true);
    try {
      const updated = await updateSsoPreferencesAction({
        clientPortalDefaultRoleName: roleName.trim() || "User",
      });
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
              <p className="text-sm font-medium">{t("ssoBulk.autoLink.internalTitle", { defaultValue: "Auto-link internal users" })}</p>
              <p className="text-sm text-muted-foreground">
                {t("ssoBulk.autoLink.internalBody", {
                  defaultValue: "When enabled, matching MSP/internal users are automatically linked to their SSO identities on login.",
                })}
              </p>
            </div>
            <Switch
              checked={autoLinkInternalEnabled}
              onCheckedChange={handleInternalAutoLinkToggle}
              disabled={prefPending}
              aria-label={t("ssoBulk.autoLink.internalToggleLabel", { defaultValue: "Toggle internal auto-linking" })}
            />
          </div>
          <div className="space-y-2 rounded-lg border border-muted-foreground/20 p-4">
            <p className="text-sm font-medium">
              {t("ssoBulk.clientPortalProvisioning.defaultRoleTitle", {
                defaultValue: "MSP workspace default client portal role",
              })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("ssoBulk.clientPortalProvisioning.defaultRoleBody", {
                defaultValue:
                  "Used for newly provisioned client portal users in built-in mode when a client mapping does not override the role.",
              })}
            </p>
            <input
              className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm"
              defaultValue={clientPortalDefaultRoleName}
              disabled={prefPending}
              aria-label={t("ssoBulk.clientPortalProvisioning.defaultRoleLabel", {
                defaultValue: "MSP workspace default client portal role",
              })}
              onBlur={(event) => void handleDefaultRoleNameBlur(event.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-muted-foreground/20 p-4">
            <div className="max-w-xl space-y-1">
              <p className="text-sm font-medium">{t("ssoBulk.autoLink.clientTitle", { defaultValue: "Auto-link client portal users" })}</p>
              <p className="text-sm text-muted-foreground">
                {t("ssoBulk.autoLink.clientBody", {
                  defaultValue: "When enabled, matching client portal users are automatically linked to their SSO identities on login.",
                })}
              </p>
            </div>
            <Switch
              checked={autoLinkClientEnabled}
              onCheckedChange={handleClientAutoLinkToggle}
              disabled={prefPending}
              aria-label={t("ssoBulk.autoLink.clientToggleLabel", { defaultValue: "Toggle client auto-linking" })}
            />
          </div>
          {!autoLinkInternalEnabled && !autoLinkClientEnabled && (
            <Alert variant="info">
              <AlertDescription>
                {t("ssoBulk.autoLink.disabledInfo")}
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-2 rounded-lg border border-muted-foreground/20 p-4">
            <p className="text-sm font-medium">
              {t("ssoBulk.clientPortalProvisioning.modeTitle", {
                defaultValue: "Client portal Entra provisioning mode",
              })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("ssoBulk.clientPortalProvisioning.modeBody", {
                defaultValue:
                  "Choose whether client portal access from Entra sync is disabled, handled by built-in provisioning, or delegated to workflows.",
              })}
            </p>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={clientPortalEntraProvisioningMode}
              disabled={prefPending}
              onChange={(event) =>
                handleProvisioningModeChange(event.target.value as SsoPreferences["clientPortalEntraProvisioningMode"])
              }
              aria-label={t("ssoBulk.clientPortalProvisioning.modeLabel", {
                defaultValue: "Client portal Entra provisioning mode",
              })}
            >
              <option value="disabled">{t("ssoBulk.clientPortalProvisioning.modeDisabled", { defaultValue: "Disabled" })}</option>
              <option value="built_in">{t("ssoBulk.clientPortalProvisioning.modeBuiltIn", { defaultValue: "Built-in" })}</option>
              <option value="workflow_managed">
                {t("ssoBulk.clientPortalProvisioning.modeWorkflowManaged", { defaultValue: "Workflow-managed" })}
              </option>
            </select>
            {clientPortalEntraProvisioningMode === "workflow_managed" ? (
              <Alert variant="info">
                <AlertDescription>
                  {t("ssoBulk.clientPortalProvisioning.workflowManagedInfo", {
                    defaultValue:
                      "Workflow-managed mode publishes Entra access events only. The selected workflow is responsible for client portal user provisioning, role assignment, invitations, and lifecycle changes.",
                  })}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <div className="flex items-center justify-between rounded-lg border border-muted-foreground/20 p-4">
            <div className="max-w-xl space-y-1">
              <p className="text-sm font-medium">
                {t("ssoBulk.clientPortalProvisioning.deactivateTitle", {
                  defaultValue: "Deactivate Entra-managed users on entitlement removal",
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("ssoBulk.clientPortalProvisioning.deactivateBody", {
                  defaultValue:
                    "When enabled, users managed by Entra provisioning are deactivated when access-group entitlement is removed.",
                })}
              </p>
            </div>
            <Switch
              checked={deactivateOnEntitlementRemoval}
              onCheckedChange={handleDeactivateToggle}
              disabled={prefPending}
              aria-label={t("ssoBulk.clientPortalProvisioning.deactivateLabel", {
                defaultValue: "Toggle deactivation on entitlement removal",
              })}
            />
          </div>
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
