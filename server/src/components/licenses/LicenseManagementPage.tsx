"use client";

import React, { useEffect, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Crown,
  ExternalLink,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TicketCheck,
} from "lucide-react";
import { Button } from "@alga-psa/ui/components/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alga-psa/ui/components/Card";
import {
  getLicenseStatus,
  submitLicense,
  startTrial,
  connectAppliance,
  refreshLicenseNow,
} from "@/lib/actions/licenseManagementActions";
import type { LicenseStatus } from "@/lib/actions/licenseManagementActions";
import {
  getErrorMessage,
  isActionPermissionError,
} from "@alga-psa/ui/lib/errorHandling";
import { isEnterpriseEdition } from "@/lib/features";
import ApplianceAiSection from "@/components/licenses/ApplianceAiSection";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";

type Tone = "neutral" | "success" | "warning" | "danger" | "premium";

/**
 * The Nine Minds customer licensing portal: buying Pro, changing seats, and
 * reissuing activation codes all happen there (sign-in is a link emailed to the
 * registered address). Overridable for non-production environments.
 */
const PORTAL_URL =
  process.env.NEXT_PUBLIC_NINEMINDS_PORTAL_URL ||
  "https://www.nineminds.com/portal";

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function tierLabel(tier: string | null, t: TFunction) {
  if (!tier) {
    return t("managementPage.tiers.unknown", { defaultValue: "Unknown tier" });
  }
  return t(`managementPage.tiers.${tier}`, {
    defaultValue: `${tier.charAt(0).toUpperCase()}${tier.slice(1)}`,
  });
}

function statusPresentation(
  status: LicenseStatus,
  t: TFunction,
): {
  eyebrow: string;
  title: string;
  description: string;
  badge: string;
  tone: Tone;
} {
  switch (status.state) {
    case "trial":
      return {
        eyebrow: t("managementPage.status.trial.eyebrow", {
          defaultValue: "Pro trial",
        }),
        title: t("managementPage.status.trial.title", {
          defaultValue: "Your Pro trial is active",
        }),
        description:
          status.daysRemaining !== null
            ? t("managementPage.status.trial.description", {
                count: status.daysRemaining,
                defaultValue:
                  "You have {{count}} days left to use all Pro features.",
              })
            : t("managementPage.status.trial.descriptionNoDays", {
                defaultValue:
                  "You can use all Pro features during the trial period.",
              }),
        badge: t("managementPage.status.trial.badge", {
          defaultValue: "Trial active",
        }),
        tone: "premium",
      };
    case "licensed":
      return {
        eyebrow: t("managementPage.status.licensed.eyebrow", {
          defaultValue: "Paid license",
        }),
        title: t("managementPage.status.licensed.title", {
          tier: tierLabel(status.tier, t),
          defaultValue: "{{tier}} is active",
        }),
        description: status.expiresAt
          ? t("managementPage.status.licensed.descriptionWithExpiry", {
              date: formatDate(status.expiresAt),
              defaultValue: "Your license is active through {{date}}.",
            })
          : t("managementPage.status.licensed.description", {
              defaultValue: "Your paid license is active on this appliance.",
            }),
        badge: t("managementPage.status.licensed.badge", {
          defaultValue: "Licensed",
        }),
        tone: "success",
      };
    case "license_expired":
      return {
        eyebrow: t("managementPage.status.licenseExpired.eyebrow", {
          defaultValue: "License needs attention",
        }),
        title: t("managementPage.status.licenseExpired.title", {
          defaultValue: "Your license has expired",
        }),
        description: t("managementPage.status.licenseExpired.description", {
          defaultValue:
            "The appliance is running Essentials features until you activate a new license key or claim code.",
        }),
        badge: t("managementPage.status.licenseExpired.badge", {
          defaultValue: "Expired",
        }),
        tone: "danger",
      };
    case "license_wrong_tenant":
      return {
        eyebrow: t("managementPage.status.licenseWrongTenant.eyebrow", {
          defaultValue: "License needs attention",
        }),
        title: t("managementPage.status.licenseWrongTenant.title", {
          defaultValue: "This license is not valid here",
        }),
        description: t("managementPage.status.licenseWrongTenant.description", {
          defaultValue:
            "The stored license was issued for a different appliance tenant. Activate the correct license to unlock paid features.",
        }),
        badge: t("managementPage.status.licenseWrongTenant.badge", {
          defaultValue: "Wrong install",
        }),
        tone: "danger",
      };
    case "trial_expired":
      return {
        eyebrow: t("managementPage.status.trialExpired.eyebrow", {
          defaultValue: "Essentials",
        }),
        title: t("managementPage.status.trialExpired.title", {
          defaultValue: "You’re running Essentials",
        }),
        description: t("managementPage.status.trialExpired.description", {
          defaultValue:
            "Your Pro trial has ended. Essentials remains active for the core PSA feature set.",
        }),
        badge: t("managementPage.status.trialExpired.badge", {
          defaultValue: "Essentials active",
        }),
        tone: "warning",
      };
    case "ce":
    case "trial_available":
    default:
      return {
        eyebrow: t("managementPage.status.essentials.eyebrow", {
          defaultValue: "Essentials",
        }),
        title: t("managementPage.status.essentials.title", {
          defaultValue: "You’re running Essentials",
        }),
        description: t("managementPage.status.essentials.description", {
          defaultValue:
            "Essentials is active on this appliance. Keep using the core feature set, or start a one-time 15-day Pro trial.",
        }),
        badge: t("managementPage.status.essentials.badge", {
          defaultValue: "Essentials active",
        }),
        tone: "neutral",
      };
  }
}

function toneClasses(tone: Tone) {
  switch (tone) {
    case "success":
      return {
        badge:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300",
        icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
      };
    case "warning":
      return {
        badge:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300",
        icon: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
      };
    case "danger":
      return {
        badge:
          "border-red-200 bg-red-50 text-red-700 dark:border-red-700/60 dark:bg-red-950/40 dark:text-red-300",
        icon: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
      };
    case "premium":
      return {
        badge:
          "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-700/60 dark:bg-purple-950/40 dark:text-purple-300",
        icon: "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300",
      };
    default:
      return {
        badge:
          "border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] text-[rgb(var(--color-text-700))] dark:border-[rgb(var(--color-border-200))] dark:bg-[rgb(var(--color-border-100))] dark:text-[rgb(var(--color-text-600))]",
        icon: "chip-primary",
      };
  }
}

/**
 * In-app License management page.
 *
 * Gated by admin RBAC only — NOT by eeRuntimeEnabled — so an expired install
 * can always navigate here to renew or start a trial.
 */
export default function LicenseManagementPage() {
  const { t } = useTranslation("msp/licensing");
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [licenseKey, setLicenseKey] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { update: updateSession } = useSession();

  useEffect(() => {
    getLicenseStatus()
      .then((s) => {
        if (isActionPermissionError(s)) {
          setError(getErrorMessage(s));
          return;
        }
        setStatus(s);
      })
      .catch(() => {
        setError(
          t("managementPage.errors.loadStatus", {
            defaultValue: "Failed to load license status.",
          }),
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  async function refresh(newStatus: LicenseStatus) {
    setError(null);
    // The session JWT caches effectiveTier and only re-resolves it every
    // 5 minutes (PLAN_CHECK_INTERVAL). Wait for the forced refresh before
    // showing success so users cannot navigate into tier-gated settings with
    // the old Essentials session still in memory.
    try {
      await updateSession();
      router.refresh();
    } catch (error) {
      console.error("Failed to refresh session after license change:", error);
    }
    setStatus(newStatus);
  }

  function handleSubmitLicense() {
    setError(null);
    setSuccessMsg(null);
    startTransition(async () => {
      const result = await submitLicense(licenseKey.trim());
      if (result.success && result.status) {
        await refresh(result.status);
        setLicenseKey("");
        setSuccessMsg(
          t("managementPage.success.licenseKeyActivated", {
            defaultValue:
              "License key activated. Paid features are now available on this appliance.",
          }),
        );
      } else {
        setError(
          result.error ??
            t("managementPage.errors.activateLicenseKey", {
              defaultValue: "Failed to activate license key.",
            }),
        );
      }
    });
  }

  function handleConnectAppliance() {
    setError(null);
    setSuccessMsg(null);
    startTransition(async () => {
      const result = await connectAppliance(claimCode.trim());
      if (result.success && result.status) {
        await refresh(result.status);
        setClaimCode("");
        setSuccessMsg(
          t("managementPage.success.claimCodeActivated", {
            defaultValue:
              "Claim code activated. Automatic license refresh is now configured.",
          }),
        );
      } else {
        setError(
          result.error ??
            t("managementPage.errors.activateClaimCode", {
              defaultValue: "Failed to activate claim code.",
            }),
        );
      }
    });
  }

  function handleStartTrial() {
    setError(null);
    setSuccessMsg(null);
    startTransition(async () => {
      const result = await startTrial();
      if (result.success && result.status) {
        await refresh(result.status);
        setSuccessMsg(
          t("managementPage.success.trialStarted", {
            defaultValue: "15-day Pro trial started.",
          }),
        );
      } else {
        setError(
          result.error ??
            t("managementPage.errors.startTrial", {
              defaultValue: "Failed to start trial.",
            }),
        );
      }
    });
  }

  function handleRefreshLicense() {
    setError(null);
    setSuccessMsg(null);
    startTransition(async () => {
      const result = await refreshLicenseNow();
      if (result.success && result.status) {
        await refresh(result.status);
        setSuccessMsg(
          t("managementPage.success.licenseRefreshed", {
            defaultValue:
              "License refreshed. Seat or plan changes from the portal are now active.",
          }),
        );
      } else {
        setError(
          result.error ??
            t("managementPage.errors.refreshLicense", {
              defaultValue: "Failed to refresh the license.",
            }),
        );
      }
    });
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6 text-[rgb(var(--color-text-700))]">
        <Card className="border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
          <CardContent className="space-y-4 pt-6">
            <div className="h-4 w-32 animate-pulse rounded skeleton-fill" />
            <div className="h-8 w-72 animate-pulse rounded skeleton-fill" />
            <div className="h-4 w-full max-w-xl animate-pulse rounded skeleton-fill" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!status?.selfHostMode) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6">
        <Card className="border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
          <CardHeader>
            <CardTitle className="text-[rgb(var(--color-text-900))]">
              {t("managementPage.notSelfHost.title", {
                defaultValue: "License",
              })}
            </CardTitle>
            <CardDescription>
              {t("managementPage.notSelfHost.description", {
                defaultValue:
                  "License management is only available for self-hosted installations.",
              })}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const presentation = statusPresentation(status, t);
  const classes = toneClasses(presentation.tone);
  const canStartTrial = !status.trialUsed && status.state !== "licensed";
  const needsLicenseAttention =
    status.state === "license_expired" ||
    status.state === "license_wrong_tenant";
  const showLicenseRefresh = status.connected;
  const lastCheckIn = formatDateTime(status.lastCheckinAt);
  const expiresAt = formatDate(status.expiresAt);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 text-[rgb(var(--color-text-700))]">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--color-primary-600))] dark:text-[rgb(var(--color-primary-300))]">
          {t("managementPage.eyebrow", { defaultValue: "Appliance licensing" })}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-[rgb(var(--color-text-900))]">
          {t("managementPage.title", { defaultValue: "License" })}
        </h1>
        <p className="max-w-2xl text-sm text-[rgb(var(--color-text-500))]">
          {t("managementPage.subtitle", {
            defaultValue:
              "Manage the feature tier for this self-hosted appliance.",
          })}
        </p>
      </header>

      {error ? (
        <div
          className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-700/60 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 flex-shrink-0"
            aria-hidden="true"
          />
          <span>{error}</span>
        </div>
      ) : null}

      {successMsg ? (
        <div
          className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200"
          role="status"
        >
          <CheckCircle2
            className="mt-0.5 h-4 w-4 flex-shrink-0"
            aria-hidden="true"
          />
          <span>{successMsg}</span>
        </div>
      ) : null}

      <Card className="overflow-hidden border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
        <CardHeader className="border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))]/70 dark:bg-[rgb(var(--color-border-100))]/40">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-4">
              <div
                className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl ${classes.icon}`}
              >
                <ShieldCheck className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgb(var(--color-text-500))]">
                  {presentation.eyebrow}
                </p>
                <div>
                  <CardTitle className="text-2xl text-[rgb(var(--color-text-900))]">
                    {presentation.title}
                  </CardTitle>
                  <CardDescription className="mt-2 max-w-2xl text-[rgb(var(--color-text-600))]">
                    {presentation.description}
                  </CardDescription>
                </div>
              </div>
            </div>
            <span
              className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-medium ${classes.badge}`}
            >
              {presentation.badge}
            </span>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          {canStartTrial ? (
            <section className="relative overflow-hidden rounded-2xl border border-[rgb(var(--color-primary-300))] bg-[rgb(var(--color-primary-50))] p-5 dark:border-[rgb(var(--color-primary-400)/0.35)] dark:bg-[rgb(var(--color-primary-400)/0.12)]">
              <div
                className="absolute right-6 top-6 h-24 w-24 rounded-full bg-[rgb(var(--color-primary-300)/0.25)] blur-2xl"
                aria-hidden="true"
              />
              <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex gap-4">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white text-[rgb(var(--color-primary-600))] shadow-sm dark:bg-[rgb(var(--color-border-100))] dark:text-[rgb(var(--color-primary-700))]">
                    <Crown className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
                      {t("managementPage.trialCta.title", {
                        defaultValue: "Try Pro for 15 days",
                      })}
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm text-[rgb(var(--color-text-600))]">
                      {t("managementPage.trialCta.description", {
                        defaultValue:
                          "Unlock automation, advanced integrations, and the full Pro feature set. No credit card required; the appliance returns to Essentials when the trial ends.",
                      })}
                    </p>
                  </div>
                </div>
                <Button
                  id="license-start-enterprise-trial"
                  onClick={handleStartTrial}
                  disabled={isPending}
                  className="w-full gap-2 md:w-auto"
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  {isPending
                    ? t("managementPage.actions.startingTrial", {
                        defaultValue: "Starting…",
                      })
                    : t("managementPage.actions.startTrial", {
                        defaultValue: "Start 15-day Pro trial",
                      })}
                </Button>
              </div>
            </section>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--color-text-400))]">
                {t("managementPage.details.currentTier", {
                  defaultValue: "Current tier",
                })}
              </p>
              <p className="mt-2 text-lg font-semibold text-[rgb(var(--color-text-900))]">
                {tierLabel(status.tier, t)}
              </p>
            </div>

            {expiresAt ? (
              <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--color-text-400))]">
                  {t("managementPage.details.expires", {
                    defaultValue: "Expires",
                  })}
                </p>
                <p className="mt-2 text-lg font-semibold text-[rgb(var(--color-text-900))]">
                  {expiresAt}
                </p>
                {status.daysRemaining !== null ? (
                  <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                    {t("managementPage.details.daysRemaining", {
                      count: status.daysRemaining,
                      defaultValue: "{{count}} days remaining",
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {status.customer ? (
              <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--color-text-400))]">
                  {t("managementPage.details.licensedTo", {
                    defaultValue: "Licensed to",
                  })}
                </p>
                <p className="mt-2 text-lg font-semibold text-[rgb(var(--color-text-900))]">
                  {status.customer}
                </p>
              </div>
            ) : null}

            {showLicenseRefresh ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-700/60 dark:bg-emerald-950/30">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  <p className="text-xs font-medium uppercase tracking-[0.12em]">
                    {t("managementPage.details.refreshLabel", {
                      defaultValue: "License refresh",
                    })}
                  </p>
                </div>
                <p className="mt-2 text-lg font-semibold text-emerald-800 dark:text-emerald-200">
                  {t("managementPage.details.connected", {
                    defaultValue: "Connected",
                  })}
                </p>
                {lastCheckIn ? (
                  <p className="mt-1 text-sm text-emerald-700/80 dark:text-emerald-200/80">
                    {t("managementPage.details.lastCheckIn", {
                      timestamp: lastCheckIn,
                      defaultValue: "Last check-in: {{timestamp}}",
                    })}
                  </p>
                ) : null}
                <Button
                  id="license-refresh-now"
                  variant="outline"
                  onClick={handleRefreshLicense}
                  disabled={isPending}
                  className="mt-3 gap-2"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {isPending
                    ? t("managementPage.actions.refreshing", {
                        defaultValue: "Refreshing…",
                      })
                    : t("managementPage.actions.refreshNow", {
                        defaultValue: "Refresh license now",
                      })}
                </Button>
                <p className="mt-2 text-xs text-emerald-700/80 dark:text-emerald-200/80">
                  {t("managementPage.details.refreshHelp", {
                    defaultValue:
                      "Applies seat or plan changes made in the portal immediately.",
                  })}
                </p>
              </div>
            ) : null}
          </section>

          {status.state === "licensed" ? (
            <section className="flex flex-col gap-3 rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-[rgb(var(--color-text-900))]">
                  {t("managementPage.portal.manageTitle", {
                    defaultValue: "Seats, billing, and activation codes",
                  })}
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-[rgb(var(--color-text-500))]">
                  {t("managementPage.portal.manageDescription", {
                    defaultValue:
                      "Add or remove seats, update billing, or reissue an activation code in the licensing portal. Sign in with your registered email — no password needed.",
                  })}
                </p>
              </div>
              <Button
                id="license-manage-in-portal"
                variant="outline"
                asChild
                className="w-full gap-2 whitespace-nowrap sm:w-auto"
              >
                <a href={PORTAL_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  {t("managementPage.actions.manageInPortal", {
                    defaultValue: "Manage license in portal",
                  })}
                </a>
              </Button>
            </section>
          ) : (
            <section className="flex flex-col gap-3 rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-[rgb(var(--color-text-900))]">
                  {t("managementPage.portal.buyTitle", {
                    defaultValue: "Ready to buy AlgaPSA Pro?",
                  })}
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-[rgb(var(--color-text-500))]">
                  {t("managementPage.portal.buyDescription", {
                    defaultValue:
                      "Purchase in the licensing portal — sign in with your registered email, pick your seat count, and you'll get a one-time activation code to enter below. Your appliance upgrades in place.",
                  })}
                </p>
              </div>
              <Button
                id="license-buy-pro-in-portal"
                asChild
                className="w-full gap-2 whitespace-nowrap sm:w-auto"
              >
                <a href={PORTAL_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  {t("managementPage.actions.buyInPortal", {
                    defaultValue: "Buy Pro in the portal",
                  })}
                </a>
              </Button>
            </section>
          )}
        </CardContent>
      </Card>

      {/* Appliance AI add-on: data-sharing consent + credits balance.
          Enterprise-only surface; the section itself self-manages loading and
          gateway-unreachable states so a gateway problem never breaks this
          page. Renders on this self-host page by construction. */}
      {isEnterpriseEdition() ? <ApplianceAiSection /> : null}

      <details
        className="group rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] card-elevated"
        open={needsLicenseAttention}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-[rgb(var(--color-text-800))] marker:hidden">
          <span className="flex items-center gap-2">
            <KeyRound
              className="h-4 w-4 text-[rgb(var(--color-primary-500))]"
              aria-hidden="true"
            />
            {t("managementPage.advanced.summary", {
              defaultValue: "Have a license code or key?",
            })}
          </span>
          <ChevronDown
            className="h-4 w-4 text-[rgb(var(--color-text-400))] transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="space-y-5 border-t border-[rgb(var(--color-border-200))] px-5 pb-5 pt-4">
          <p className="max-w-3xl text-sm text-[rgb(var(--color-text-500))]">
            {t("managementPage.advanced.introPrefix", {
              defaultValue:
                "Enter the activation code or offline key you received from the",
            })}{" "}
            <a
              href={PORTAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[rgb(var(--color-primary-600))] underline underline-offset-2 dark:text-[rgb(var(--color-primary-300))]"
            >
              {t("managementPage.advanced.introLink", {
                defaultValue: "licensing portal",
              })}
            </a>{" "}
            {t("managementPage.advanced.introSuffix", {
              defaultValue: "or from Nine Minds support.",
            })}
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
              <div className="flex items-start gap-3">
                <div className="chip-primary flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg">
                  <TicketCheck className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-semibold text-[rgb(var(--color-text-900))]">
                    {t("managementPage.advanced.claimCode.title", {
                      defaultValue: "Activate with claim code",
                    })}
                  </h3>
                  <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                    {t("managementPage.advanced.claimCode.description", {
                      defaultValue:
                        "Use the 8-character code from the licensing portal or a paid-license email. This also enables automatic license refresh.",
                    })}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  id="license-claim-code"
                  type="text"
                  value={claimCode}
                  onChange={(e) => setClaimCode(e.target.value.toUpperCase().replace(/[\s-]/g, ""))}
                  placeholder="XXXXXXXX"
                  maxLength={8}
                  className="min-h-10 flex-1 rounded-md border border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-card))] px-3 py-2 font-mono text-sm uppercase tracking-[0.12em] text-[rgb(var(--color-text-900))] placeholder:text-[rgb(var(--color-text-400))] focus:border-[rgb(var(--color-primary-400))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500)/0.25)]"
                />
                <Button
                  id="license-activate-claim-code"
                  variant="outline"
                  onClick={handleConnectAppliance}
                  disabled={isPending || claimCode.length < 8}
                  className="whitespace-nowrap"
                >
                  {isPending
                    ? t("managementPage.actions.activating", {
                        defaultValue: "Activating…",
                      })
                    : t("managementPage.actions.applyClaimCode", {
                        defaultValue: "Apply claim code",
                      })}
                </Button>
              </div>
            </section>

            <section className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-600))]">
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-semibold text-[rgb(var(--color-text-900))]">
                    {t("managementPage.advanced.licenseKey.title", {
                      defaultValue: "Paste a license key",
                    })}
                  </h3>
                  <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                    {t("managementPage.advanced.licenseKey.description", {
                      defaultValue:
                        "Use this for offline keys downloaded from the licensing portal (air-gapped installs) or issued by support.",
                    })}
                  </p>
                </div>
              </div>
              <textarea
                id="license-manual-key"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                rows={4}
                placeholder="eyJhbGci…"
                className="mt-4 w-full rounded-md border border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-card))] px-3 py-2 font-mono text-xs text-[rgb(var(--color-text-900))] placeholder:text-[rgb(var(--color-text-400))] focus:border-[rgb(var(--color-primary-400))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500)/0.25)]"
              />
              <div className="mt-3 flex justify-end">
                <Button
                  id="license-activate-manual-key"
                  variant="outline"
                  onClick={handleSubmitLicense}
                  disabled={isPending || !licenseKey.trim()}
                >
                  {isPending
                    ? t("managementPage.actions.activating", {
                        defaultValue: "Activating…",
                      })
                    : t("managementPage.actions.activateLicenseKey", {
                        defaultValue: "Activate license key",
                      })}
                </Button>
              </div>
            </section>
          </div>

          {status.tenantId ? (
            <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-3 text-sm dark:bg-[rgb(var(--color-border-100))]/40">
              <p className="font-medium text-[rgb(var(--color-text-800))]">
                {t("managementPage.advanced.installationId.title", {
                  defaultValue: "Installation ID",
                })}
              </p>
              <p className="mt-1 text-[rgb(var(--color-text-500))]">
                {t("managementPage.advanced.installationId.description", {
                  defaultValue:
                    "Support may ask for this ID when issuing a manual license key.",
                })}
              </p>
              <code className="mt-2 block break-all rounded bg-[rgb(var(--color-card))] px-2 py-1 font-mono text-xs text-[rgb(var(--color-text-700))]">
                {status.tenantId}
              </code>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}
