"use client";

import React, { useEffect, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
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

function tierLabel(tier: string | null) {
  if (!tier) return "Unknown tier";
  return tier === "essentials"
    ? "Essentials"
    : `${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;
}

function statusPresentation(status: LicenseStatus): {
  eyebrow: string;
  title: string;
  description: string;
  badge: string;
  tone: Tone;
} {
  switch (status.state) {
    case "trial":
      return {
        eyebrow: "Enterprise trial",
        title: "Your Enterprise trial is active",
        description:
          status.daysRemaining !== null
            ? `You have ${status.daysRemaining} day${status.daysRemaining === 1 ? "" : "s"} left to use all Enterprise features.`
            : "You can use all Enterprise features during the trial period.",
        badge: "Trial active",
        tone: "premium",
      };
    case "licensed":
      return {
        eyebrow: "Paid license",
        title: `${tierLabel(status.tier)} is active`,
        description: status.expiresAt
          ? `Your license is active through ${formatDate(status.expiresAt)}.`
          : "Your paid license is active on this appliance.",
        badge: "Licensed",
        tone: "success",
      };
    case "license_expired":
      return {
        eyebrow: "License needs attention",
        title: "Your license has expired",
        description:
          "The appliance is running Essentials features until you activate a new license key or claim code.",
        badge: "Expired",
        tone: "danger",
      };
    case "license_wrong_tenant":
      return {
        eyebrow: "License needs attention",
        title: "This license is not valid here",
        description:
          "The stored license was issued for a different appliance tenant. Activate the correct license to unlock paid features.",
        badge: "Wrong install",
        tone: "danger",
      };
    case "trial_expired":
      return {
        eyebrow: "Essentials",
        title: "You’re running Essentials",
        description:
          "Your Enterprise trial has ended. Essentials remains active for the core PSA feature set.",
        badge: "Essentials active",
        tone: "warning",
      };
    case "ce":
    case "trial_available":
    default:
      return {
        eyebrow: "Essentials",
        title: "You’re running Essentials",
        description:
          "Essentials is active on this appliance. Keep using the core feature set, or start a one-time 15-day Enterprise trial.",
        badge: "Essentials active",
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
          "border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] text-[rgb(var(--color-text-700))] dark:border-[rgb(var(--color-border-200))] dark:bg-[rgb(var(--color-border-100))] dark:text-[rgb(var(--color-text-300))]",
        icon: "bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))] dark:bg-[rgb(var(--color-primary-400)/0.18)] dark:text-[rgb(var(--color-primary-300))]",
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
        setError("Failed to load license status.");
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
          "License key activated. Paid features are now available on this appliance.",
        );
      } else {
        setError(result.error ?? "Failed to activate license key.");
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
          "Claim code activated. Automatic license refresh is now configured.",
        );
      } else {
        setError(result.error ?? "Failed to activate claim code.");
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
        setSuccessMsg("15-day Enterprise trial started.");
      } else {
        setError(result.error ?? "Failed to start trial.");
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
          "License refreshed. Seat or plan changes from the portal are now active.",
        );
      } else {
        setError(result.error ?? "Failed to refresh the license.");
      }
    });
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6 text-[rgb(var(--color-text-700))]">
        <Card className="border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
          <CardContent className="space-y-4 pt-6">
            <div className="h-4 w-32 animate-pulse rounded bg-[rgb(var(--color-border-200))]" />
            <div className="h-8 w-72 animate-pulse rounded bg-[rgb(var(--color-border-200))]" />
            <div className="h-4 w-full max-w-xl animate-pulse rounded bg-[rgb(var(--color-border-200))]" />
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
              License
            </CardTitle>
            <CardDescription>
              License management is only available for self-hosted
              installations.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const presentation = statusPresentation(status);
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
          Appliance licensing
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-[rgb(var(--color-text-900))]">
          License
        </h1>
        <p className="max-w-2xl text-sm text-[rgb(var(--color-text-500))]">
          Manage the feature tier for this self-hosted appliance.
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
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white text-[rgb(var(--color-primary-600))] shadow-sm dark:bg-[rgb(var(--color-border-100))] dark:text-[rgb(var(--color-primary-300))]">
                    <Crown className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
                      Try Enterprise for 15 days
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm text-[rgb(var(--color-text-600))]">
                      Unlock automation, advanced integrations, and the full
                      Enterprise feature set. No credit card required; the
                      appliance returns to Essentials when the trial ends.
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
                  {isPending ? "Starting…" : "Start 15-day Enterprise trial"}
                </Button>
              </div>
            </section>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--color-text-400))]">
                Current tier
              </p>
              <p className="mt-2 text-lg font-semibold text-[rgb(var(--color-text-900))]">
                {tierLabel(status.tier)}
              </p>
            </div>

            {expiresAt ? (
              <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--color-text-400))]">
                  Expires
                </p>
                <p className="mt-2 text-lg font-semibold text-[rgb(var(--color-text-900))]">
                  {expiresAt}
                </p>
                {status.daysRemaining !== null ? (
                  <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                    {status.daysRemaining} day
                    {status.daysRemaining === 1 ? "" : "s"} remaining
                  </p>
                ) : null}
              </div>
            ) : null}

            {status.customer ? (
              <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--color-text-400))]">
                  Licensed to
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
                    License refresh
                  </p>
                </div>
                <p className="mt-2 text-lg font-semibold text-emerald-800 dark:text-emerald-200">
                  Connected
                </p>
                {lastCheckIn ? (
                  <p className="mt-1 text-sm text-emerald-700/80 dark:text-emerald-200/80">
                    Last check-in: {lastCheckIn}
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
                  {isPending ? "Refreshing…" : "Refresh license now"}
                </Button>
                <p className="mt-2 text-xs text-emerald-700/80 dark:text-emerald-200/80">
                  Applies seat or plan changes made in the portal immediately.
                </p>
              </div>
            ) : null}
          </section>

          {status.state === "licensed" ? (
            <section className="flex flex-col gap-3 rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-[rgb(var(--color-text-900))]">
                  Seats, billing, and activation codes
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-[rgb(var(--color-text-500))]">
                  Add or remove seats, update billing, or reissue an activation
                  code in the licensing portal. Sign in with your registered
                  email — no password needed.
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
                  Manage license in portal
                </a>
              </Button>
            </section>
          ) : (
            <section className="flex flex-col gap-3 rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-[rgb(var(--color-text-900))]">
                  Ready to buy AlgaPSA Pro?
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-[rgb(var(--color-text-500))]">
                  Purchase in the licensing portal — sign in with your
                  registered email, pick your seat count, and you&apos;ll get a
                  one-time activation code to enter below. Your appliance
                  upgrades in place.
                </p>
              </div>
              <Button
                id="license-buy-pro-in-portal"
                asChild
                className="w-full gap-2 whitespace-nowrap sm:w-auto"
              >
                <a href={PORTAL_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Buy Pro in the portal
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
        className="group rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] shadow-sm"
        open={needsLicenseAttention}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-[rgb(var(--color-text-800))] marker:hidden">
          <span className="flex items-center gap-2">
            <KeyRound
              className="h-4 w-4 text-[rgb(var(--color-primary-500))]"
              aria-hidden="true"
            />
            Have a license code or key?
          </span>
          <ChevronDown
            className="h-4 w-4 text-[rgb(var(--color-text-400))] transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="space-y-5 border-t border-[rgb(var(--color-border-200))] px-5 pb-5 pt-4">
          <p className="max-w-3xl text-sm text-[rgb(var(--color-text-500))]">
            Enter the activation code or offline key you received from the{" "}
            <a
              href={PORTAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[rgb(var(--color-primary-600))] underline underline-offset-2 dark:text-[rgb(var(--color-primary-300))]"
            >
              licensing portal
            </a>{" "}
            or from Nine Minds support.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))] dark:bg-[rgb(var(--color-primary-400)/0.18)] dark:text-[rgb(var(--color-primary-300))]">
                  <TicketCheck className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-semibold text-[rgb(var(--color-text-900))]">
                    Activate with claim code
                  </h3>
                  <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                    Use the 8-character code from the licensing portal or a
                    paid-license email. This also enables automatic license
                    refresh.
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
                  {isPending ? "Activating…" : "Apply claim code"}
                </Button>
              </div>
            </section>

            <section className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-600))] dark:bg-[rgb(var(--color-border-200))] dark:text-[rgb(var(--color-text-300))]">
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-semibold text-[rgb(var(--color-text-900))]">
                    Paste a license key
                  </h3>
                  <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                    Use this for offline keys downloaded from the licensing
                    portal (air-gapped installs) or issued by support.
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
                  {isPending ? "Activating…" : "Activate license key"}
                </Button>
              </div>
            </section>
          </div>

          {status.tenantId ? (
            <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-3 text-sm dark:bg-[rgb(var(--color-border-100))]/40">
              <p className="font-medium text-[rgb(var(--color-text-800))]">
                Installation ID
              </p>
              <p className="mt-1 text-[rgb(var(--color-text-500))]">
                Support may ask for this ID when issuing a manual license key.
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
