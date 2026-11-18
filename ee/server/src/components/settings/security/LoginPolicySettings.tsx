"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@alga-psa/ui/components/Card";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import { Switch } from "@alga-psa/ui/components/Switch";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import { Button } from "@alga-psa/ui/components/Button";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import {
  getLoginPolicyAction,
  updateLoginPolicyAction,
  type LoginPolicyState,
  type LoginPolicyUpdate,
} from "@ee/lib/actions/auth/loginPolicy";

type GuardErrorCode = "sso_provider_required" | "break_glass_required" | "break_glass_invalid_user";
type SaveErrorCode = GuardErrorCode | "save_failed";

/**
 * Tenant login policy controls. The server validates every save (provider
 * configured, valid break-glass admin) and is the authority: this component only
 * renders the codes it returns.
 */
export default function LoginPolicySettings() {
  const { t } = useTranslation("msp/settings");
  const [state, setState] = useState<LoginPolicyState | null>(null);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [guardErrors, setGuardErrors] = useState<GuardErrorCode[]>([]);

  useEffect(() => {
    let cancelled = false;
    getLoginPolicyAction()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("loginPolicy.errors.load"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function save(updates: LoginPolicyUpdate) {
    setPending(true);
    setGuardErrors([]);
    setSaveFailed(false);
    try {
      const result = await updateLoginPolicyAction(updates);
      if (result.success && result.state) {
        // Show the persisted policy the server returned, not the optimistic toggle.
        setState(result.state);
      } else {
        // Controls are bound to `state`, so leaving it untouched reverts the toggle.
        const codes = (result.errors ?? []) as SaveErrorCode[];
        setGuardErrors(codes.filter((code): code is GuardErrorCode => code !== "save_failed"));
        setSaveFailed(codes.includes("save_failed") || codes.length === 0);
      }
    } catch {
      // Never surface a raw error message (it can carry SQL); show the generic text.
      setSaveFailed(true);
    } finally {
      setPending(false);
    }
  }

  if (!state) {
    return loadError ? (
      <Alert variant="destructive" id="login-policy-load-error">
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    ) : null;
  }

  const { policy, eligibleBreakGlassAdmins } = state;
  const ineligibleBreakGlassUsers = state.ineligibleBreakGlassUsers ?? [];

  const toggles: Array<{
    id: string;
    key: keyof LoginPolicyUpdate;
    checked: boolean;
    title: string;
    body: string;
    disabled?: boolean;
  }> = [
    {
      id: "login-policy-require-sso-internal",
      key: "requireSsoForInternalUsers",
      checked: policy.requireSsoForInternalUsers,
      title: t("loginPolicy.requireSso.title"),
      body: t("loginPolicy.requireSso.body"),
    },
    {
      id: "login-policy-require-2fa-internal",
      key: "require2faForInternalUsers",
      checked: policy.require2faForInternalUsers,
      title: t("loginPolicy.require2faInternal.title"),
      body: t("loginPolicy.require2faInternal.body"),
    },
    {
      id: "login-policy-require-2fa-client",
      key: "require2faForClientUsers",
      checked: policy.require2faForClientUsers,
      title: t("loginPolicy.require2faClient.title"),
      body: t("loginPolicy.require2faClient.body"),
    },
    {
      id: "login-policy-known-device-skip",
      key: "allowKnownDevice2faSkip",
      checked: policy.allowKnownDevice2faSkip,
      title: t("loginPolicy.knownDeviceSkip.title"),
      body: t("loginPolicy.knownDeviceSkip.body"),
    },
  ];

  return (
    <Card id="login-policy-card">
      <CardHeader>
        <CardTitle>{t("loginPolicy.title")}</CardTitle>
        <CardDescription>{t("loginPolicy.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {toggles.map((toggle) => (
          <div
            key={toggle.id}
            className="flex items-center justify-between rounded-lg border border-muted-foreground/20 p-4"
          >
            <div className="max-w-xl space-y-1">
              <p className="text-sm font-medium">{toggle.title}</p>
              <p className="text-sm text-muted-foreground">{toggle.body}</p>
            </div>
            <Switch
              id={toggle.id}
              checked={toggle.checked}
              disabled={pending || toggle.disabled}
              aria-label={toggle.title}
              onCheckedChange={(checked) => void save({ [toggle.key]: checked })}
            />
          </div>
        ))}

        <Alert variant="warning" id="login-policy-signout-warning">
          <AlertDescription>{t("loginPolicy.requireSso.signOutWarning")}</AlertDescription>
        </Alert>

        <div className="space-y-2 rounded-lg border border-muted-foreground/20 p-4">
          <p className="text-sm font-medium">{t("loginPolicy.breakGlass.title")}</p>
          <p className="text-sm text-muted-foreground">{t("loginPolicy.breakGlass.body")}</p>
          {eligibleBreakGlassAdmins.length === 0 ? (
            <p className="text-sm text-muted-foreground" id="login-policy-break-glass-empty">
              {t("loginPolicy.breakGlass.noEligible")}
            </p>
          ) : (
            eligibleBreakGlassAdmins.map((admin) => {
              const selected = policy.passwordBreakGlassUserIds.includes(admin.userId);
              return (
                <Checkbox
                  key={admin.userId}
                  id={`login-policy-break-glass-${admin.userId}`}
                  checked={selected}
                  disabled={pending}
                  label={`${admin.name} (${admin.email})`}
                  onChange={(event) => {
                    const ids = new Set(policy.passwordBreakGlassUserIds);
                    if (event.target.checked) ids.add(admin.userId);
                    else ids.delete(admin.userId);
                    void save({ passwordBreakGlassUserIds: Array.from(ids) });
                  }}
                />
              );
            })
          )}
        </div>

        {ineligibleBreakGlassUsers.length > 0 && (
          <div className="space-y-2 rounded-lg border border-muted-foreground/20 p-4" id="login-policy-break-glass-stale-list">
            {ineligibleBreakGlassUsers.map((stale) => (
              <div
                key={stale.userId}
                id={`login-policy-break-glass-stale-${stale.userId}`}
                className="flex items-center justify-between gap-4"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {stale.name ? `${stale.name} (${stale.email})` : stale.userId}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("loginPolicy.breakGlass.noLongerEligible")}
                    {stale.reason ? ` ${t(`loginPolicy.breakGlass.reasons.${stale.reason}`)}` : ""}
                  </p>
                </div>
                <Button
                  id={`login-policy-break-glass-remove-${stale.userId}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    void save({
                      passwordBreakGlassUserIds: policy.passwordBreakGlassUserIds.filter(
                        (id) => id !== stale.userId
                      ),
                    })
                  }
                >
                  {t("loginPolicy.breakGlass.remove")}
                </Button>
              </div>
            ))}
          </div>
        )}

        {guardErrors.length > 0 && (
          <Alert variant="destructive" id="login-policy-guard-errors">
            <AlertDescription>
              <ul className="list-disc pl-4">
                {guardErrors.map((code) => (
                  <li key={code}>{t(`loginPolicy.guard.${code}`)}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {saveFailed && (
          <Alert variant="destructive" id="login-policy-save-error">
            <AlertDescription>{t("loginPolicy.errors.save")}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
