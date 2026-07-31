"use client";

/**
 * Appliance-facing AI add-on section (plan §8, §5.3).
 *
 * Rendered inside the self-host License management page for Enterprise
 * installs. Two cards:
 *
 *  1. Data-sharing consent — explains that AI features send ticket/email/chat
 *     content to Nine Minds cloud and onward to model providers, shows the
 *     recorded consent status, and drives grant/revoke through the gateway
 *     consent actions.
 *  2. AI credits balance — the gateway account summary (included/top-up split,
 *     grace + low-balance indicators, subscription status). Purchases happen in
 *     the nm-store portal, not in-app: the subscribe and top-up controls link
 *     OUT to that portal.
 *
 * Consent and balance are fetched independently so that a gateway problem in
 * one surface degrades to a caught error state without taking down the other
 * card or the rest of the licenses page.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@alga-psa/ui/components/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alga-psa/ui/components/Card";
import { ConfirmationDialog } from "@alga-psa/ui/components/ConfirmationDialog";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import {
  getAiConsentStatus,
  grantAiConsent,
  revokeAiConsent,
} from "@ee/lib/actions/aiConsentActions";
import { getAiAccountSummary } from "@ee/lib/actions/aiUsageActions";
import type {
  AiAccountSummary,
  AiSubscriptionStatus,
} from "@ee/lib/aiGateway/types";

type ConsentStatus = Awaited<ReturnType<typeof getAiConsentStatus>>;

type Tone = "neutral" | "success" | "warning" | "danger";

/**
 * Version string for the data-sharing terms the appliance operator accepts.
 * TODO: source this from a central, gateway-shared config (the same value the
 * gateway records against consent) instead of hard-coding it in the UI.
 */
const AI_DATA_SHARING_TERMS_VERSION = "2026-07-01";

/**
 * nm-store portal path for the AI add-on (subscribe / top-up / manage).
 * TODO: confirm the final portal path once the nm-store portal PR lands
 * (plan §8); the base host is deployment config.
 */
const NM_STORE_PORTAL_PATH = "/portal/ai";

/** Build a link OUT to the nm-store portal — appliances never check out in-app. */
function buildNmStorePortalUrl(path: string = NM_STORE_PORTAL_PATH): string {
  const base = (
    process.env.NEXT_PUBLIC_NM_STORE_URL || "https://store.nineminds.com"
  ).replace(/\/+$/, "");
  return `${base}${path}`;
}

const fullNumberFormatter = new Intl.NumberFormat();

function formatFull(value: number): string {
  return fullNumberFormatter.format(value);
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toneBadgeClasses(tone: Tone): string {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300";
    case "danger":
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-700/60 dark:bg-red-950/40 dark:text-red-300";
    default:
      return "border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] text-[rgb(var(--color-text-700))] dark:border-[rgb(var(--color-border-200))] dark:bg-[rgb(var(--color-border-100))] dark:text-[rgb(var(--color-text-300))]";
  }
}

function subscriptionTone(status: AiSubscriptionStatus): Tone {
  switch (status) {
    case "active":
    case "trialing":
      return "success";
    case "past_due":
      return "warning";
    case "canceled":
    case "unpaid":
      return "danger";
    case "none":
    default:
      return "neutral";
  }
}

export default function ApplianceAiSection(): React.JSX.Element {
  const { t } = useTranslation("msp/licensing");

  const [consent, setConsent] = useState<ConsentStatus | null>(null);
  const [consentError, setConsentError] = useState(false);
  const [summary, setSummary] = useState<AiAccountSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [loading, setLoading] = useState(true);

  const [showAcceptDialog, setShowAcceptDialog] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [mutating, setMutating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Two independent gateway reads: a failure in one must not blank the other.
    const [consentResult, summaryResult] = await Promise.allSettled([
      getAiConsentStatus(),
      getAiAccountSummary(),
    ]);

    if (consentResult.status === "fulfilled") {
      setConsent(consentResult.value);
      setConsentError(false);
    } else {
      setConsentError(true);
    }

    if (summaryResult.status === "fulfilled") {
      setSummary(summaryResult.value);
      setSummaryError(false);
    } else {
      setSummaryError(true);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleGrant = useCallback(async () => {
    setMutating(true);
    try {
      await grantAiConsent(AI_DATA_SHARING_TERMS_VERSION);
      setShowAcceptDialog(false);
      await load();
    } finally {
      setMutating(false);
    }
  }, [load]);

  const handleRevoke = useCallback(async () => {
    setMutating(true);
    try {
      await revokeAiConsent();
      setShowRevokeDialog(false);
      await load();
    } finally {
      setMutating(false);
    }
  }, [load]);

  if (loading) {
    return (
      <Card
        id="appliance-ai-section"
        className="border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]"
      >
        <CardContent className="space-y-4 pt-6">
          <div className="h-4 w-40 animate-pulse rounded bg-[rgb(var(--color-border-200))]" />
          <div className="h-8 w-72 animate-pulse rounded bg-[rgb(var(--color-border-200))]" />
          <div className="h-4 w-full max-w-xl animate-pulse rounded bg-[rgb(var(--color-border-200))]" />
        </CardContent>
      </Card>
    );
  }

  const status = consent?.status ?? "missing";
  const hasConsent = status === "granted";
  const grantedAt = formatDateTime(consent?.grantedAt ?? null);

  return (
    <div id="appliance-ai-section" className="space-y-6">
      {/* ---- Data-sharing consent card ------------------------------------ */}
      <Card
        id="appliance-ai-consent-card"
        className="overflow-hidden border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]"
      >
        <CardHeader className="border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))]/70 dark:bg-[rgb(var(--color-border-100))]/40">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))] dark:bg-[rgb(var(--color-primary-400)/0.18)] dark:text-[rgb(var(--color-primary-300))]">
                <ShieldCheck className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-xl text-[rgb(var(--color-text-900))]">
                  {t("aiConsent.title", { defaultValue: "AI data sharing" })}
                </CardTitle>
                <CardDescription className="max-w-2xl text-[rgb(var(--color-text-600))]">
                  {t("aiConsent.subtitle", {
                    defaultValue:
                      "Required for AI features on this appliance. Review what leaves your network before turning AI on.",
                  })}
                </CardDescription>
              </div>
            </div>
            <span
              id="appliance-ai-consent-status"
              className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${toneBadgeClasses(
                hasConsent ? "success" : status === "revoked" ? "danger" : "neutral",
              )}`}
            >
              {hasConsent ? (
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {hasConsent
                ? t("aiConsent.status.granted", { defaultValue: "Consent granted" })
                : status === "revoked"
                  ? t("aiConsent.status.revoked", { defaultValue: "Consent revoked" })
                  : t("aiConsent.status.missing", { defaultValue: "Not granted" })}
            </span>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-6">
          {consentError ? (
            <div
              id="appliance-ai-consent-error"
              className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>
                {t("aiConsent.unreachable", {
                  defaultValue:
                    "Could not reach the AI service to load the current consent status. Try again shortly.",
                })}
              </span>
            </div>
          ) : (
            <>
              <p className="max-w-3xl text-sm text-[rgb(var(--color-text-600))]">
                {t("aiConsent.explainer", {
                  defaultValue:
                    "When AI is enabled, the content AI works on — including ticket text, email bodies, and chat messages — is sent from this appliance to the Nine Minds cloud AI service, and from there to third-party model providers to generate responses. Nothing is sent until you grant consent below.",
                })}
              </p>

              {(hasConsent || consent?.termsVersion || grantedAt) && (
                <dl className="grid gap-3 sm:grid-cols-2">
                  {consent?.termsVersion ? (
                    <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
                      <dt className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--color-text-400))]">
                        {t("aiConsent.termsVersion", { defaultValue: "Terms version" })}
                      </dt>
                      <dd
                        id="appliance-ai-consent-terms-version"
                        className="mt-2 font-mono text-sm text-[rgb(var(--color-text-900))]"
                      >
                        {consent.termsVersion}
                      </dd>
                    </div>
                  ) : null}
                  {grantedAt ? (
                    <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
                      <dt className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--color-text-400))]">
                        {t("aiConsent.grantedAt", { defaultValue: "Granted" })}
                      </dt>
                      <dd
                        id="appliance-ai-consent-granted-at"
                        className="mt-2 text-sm text-[rgb(var(--color-text-900))]"
                      >
                        {grantedAt}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              )}

              <div className="flex flex-wrap gap-3">
                {hasConsent ? (
                  <Button
                    id="appliance-ai-consent-revoke"
                    variant="outline"
                    onClick={() => setShowRevokeDialog(true)}
                    disabled={mutating}
                    className="gap-2"
                  >
                    <ShieldOff className="h-4 w-4" aria-hidden="true" />
                    {t("aiConsent.revoke", { defaultValue: "Revoke consent" })}
                  </Button>
                ) : (
                  <Button
                    id="appliance-ai-consent-accept"
                    onClick={() => setShowAcceptDialog(true)}
                    disabled={mutating}
                    className="gap-2"
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    {t("aiConsent.accept", { defaultValue: "Accept and enable AI" })}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- AI credits balance card -------------------------------------- */}
      <BalanceCard
        summary={summary}
        summaryError={summaryError}
        hasConsent={hasConsent}
        onRefresh={() => void load()}
      />

      {/* ---- Confirmation dialogs ----------------------------------------- */}
      <ConfirmationDialog
        id="appliance-ai-consent-accept-confirm"
        isOpen={showAcceptDialog}
        onClose={() => setShowAcceptDialog(false)}
        onConfirm={handleGrant}
        isConfirming={mutating}
        title={t("aiConsent.acceptDialog.title", {
          defaultValue: "Enable AI data sharing?",
        })}
        confirmLabel={
          mutating
            ? t("aiConsent.acceptDialog.confirming", { defaultValue: "Enabling…" })
            : t("aiConsent.acceptDialog.confirm", { defaultValue: "I agree, enable AI" })
        }
        message={
          <div className="space-y-3 text-sm text-[rgb(var(--color-text-700))]">
            <p>
              {t("aiConsent.acceptDialog.body", {
                defaultValue:
                  "By continuing you agree that AI features may transmit ticket, email, and chat content from this appliance to the Nine Minds cloud AI service and onward to third-party model providers for processing.",
              })}
            </p>
            <p className="text-[rgb(var(--color-text-500))]">
              {t("aiConsent.acceptDialog.termsVersion", {
                defaultValue: "Data-sharing terms version: {{version}}",
                version: AI_DATA_SHARING_TERMS_VERSION,
              })}
            </p>
          </div>
        }
      />

      <ConfirmationDialog
        id="appliance-ai-consent-revoke-confirm"
        isOpen={showRevokeDialog}
        onClose={() => setShowRevokeDialog(false)}
        onConfirm={handleRevoke}
        isConfirming={mutating}
        title={t("aiConsent.revokeDialog.title", {
          defaultValue: "Revoke AI data sharing?",
        })}
        confirmLabel={
          mutating
            ? t("aiConsent.revokeDialog.confirming", { defaultValue: "Revoking…" })
            : t("aiConsent.revokeDialog.confirm", { defaultValue: "Revoke consent" })
        }
        message={
          <div className="space-y-2 text-sm text-[rgb(var(--color-text-700))]">
            <p>
              {t("aiConsent.revokeDialog.body", {
                defaultValue:
                  "AI features stop working immediately across this appliance. No further content will be sent to the cloud AI service until consent is granted again.",
              })}
            </p>
          </div>
        }
      />
    </div>
  );
}

interface BalanceCardProps {
  summary: AiAccountSummary | null;
  summaryError: boolean;
  hasConsent: boolean;
  onRefresh: () => void;
}

function BalanceCard({
  summary,
  summaryError,
  hasConsent,
  onRefresh,
}: BalanceCardProps): React.JSX.Element {
  const { t } = useTranslation("msp/licensing");
  const portalUrl = buildNmStorePortalUrl();

  const subscribed = !!summary && summary.subscriptionStatus !== "none";
  const total = summary?.totalBalanceCredits ?? 0;
  const inGrace = subscribed && total <= 0;
  const lowBalance = subscribed && !!summary?.lowBalance && !inGrace;

  return (
    <Card
      id="appliance-ai-balance-card"
      className="overflow-hidden border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]"
    >
      <CardHeader className="border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))]/70 dark:bg-[rgb(var(--color-border-100))]/40">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))] dark:bg-[rgb(var(--color-primary-400)/0.18)] dark:text-[rgb(var(--color-primary-300))]">
              <Sparkles className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-xl text-[rgb(var(--color-text-900))]">
                {t("aiBalance.title", { defaultValue: "AI credits" })}
              </CardTitle>
              <CardDescription className="max-w-2xl text-[rgb(var(--color-text-600))]">
                {t("aiBalance.subtitle", {
                  defaultValue:
                    "Prepaid credits fund AI features on this appliance. Purchases are made in the Nine Minds store.",
                })}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {summary ? (
              <span
                id="appliance-ai-balance-status"
                className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-medium ${toneBadgeClasses(
                  subscriptionTone(summary.subscriptionStatus),
                )}`}
              >
                {t(`aiBalance.status.${summary.subscriptionStatus}`, {
                  defaultValue: summary.subscriptionStatus,
                })}
              </span>
            ) : null}
            <button
              id="appliance-ai-balance-refresh"
              type="button"
              className="rounded p-1.5 text-[rgb(var(--color-text-500))] transition-colors hover:bg-[rgb(var(--color-border-100))] hover:text-[rgb(var(--color-text-800))]"
              onClick={onRefresh}
              aria-label={t("aiBalance.refresh", { defaultValue: "Refresh" })}
              title={t("aiBalance.refresh", { defaultValue: "Refresh" })}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-6">
        {summaryError ? (
          <div
            id="appliance-ai-balance-error"
            className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>
              {t("aiBalance.unreachable", {
                defaultValue:
                  "Could not reach the AI service to load your credit balance. Try again shortly.",
              })}
            </span>
          </div>
        ) : (
          <>
            {/* AI blocked until consent is granted (balance still shown). */}
            {!hasConsent ? (
              <div
                id="appliance-ai-balance-blocked"
                className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
                role="status"
              >
                <ShieldOff className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span>
                  {t("aiBalance.blockedPendingConsent", {
                    defaultValue:
                      "AI is blocked until data-sharing consent is granted above. Credits are not consumed while AI is off.",
                  })}
                </span>
              </div>
            ) : null}

            {!subscribed ? (
              /* --- Subscribe upsell: link OUT to the nm-store portal --- */
              <div className="rounded-xl border border-[rgb(var(--color-primary-300))] bg-[rgb(var(--color-primary-50))] p-5 dark:border-[rgb(var(--color-primary-400)/0.35)] dark:bg-[rgb(var(--color-primary-400)/0.12)]">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="max-w-2xl">
                    <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
                      {t("aiBalance.upsell.heading", {
                        defaultValue: "Subscribe to the AI add-on",
                      })}
                    </h3>
                    <p className="mt-1 text-sm text-[rgb(var(--color-text-600))]">
                      {t("aiBalance.upsell.body", {
                        defaultValue:
                          "There is no active AI subscription for this appliance. Subscribe in the Nine Minds store to receive a monthly credit allotment; the store manages payment and top-ups.",
                      })}
                    </p>
                  </div>
                  <Button
                    id="appliance-ai-portal-link"
                    asChild
                    className="w-full gap-2 whitespace-nowrap md:w-auto"
                  >
                    <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      {t("aiBalance.upsell.subscribe", {
                        defaultValue: "Subscribe in the store",
                      })}
                    </a>
                  </Button>
                </div>
              </div>
            ) : (
              /* --- Subscribed: balance split + grace/low indicators --- */
              <>
                {inGrace ? (
                  <div
                    id="appliance-ai-balance-grace"
                    className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
                    role="status"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    <span>
                      {t("aiBalance.grace", {
                        defaultValue:
                          "Credits are exhausted. AI keeps working within a small grace buffer of {{grace}} credits before it hard-stops — top up to avoid interruption.",
                        grace: formatFull(summary?.graceLimitCredits ?? 0),
                      })}
                    </span>
                  </div>
                ) : null}

                {lowBalance ? (
                  <div
                    id="appliance-ai-balance-low"
                    className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
                    role="status"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    <span>
                      {t("aiBalance.low", {
                        defaultValue:
                          "Credit balance is running low. Top up in the store to avoid interruptions.",
                      })}
                    </span>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div
                    className={`rounded-xl border p-4 ${
                      inGrace || lowBalance
                        ? "border-amber-300 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-950/20"
                        : "border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))]"
                    }`}
                  >
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--color-text-400))]">
                      {t("aiBalance.total", { defaultValue: "Total balance" })}
                    </p>
                    <p
                      id="appliance-ai-balance-total"
                      className={`mt-2 text-2xl font-bold ${
                        total <= 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-[rgb(var(--color-text-900))]"
                      }`}
                    >
                      {formatFull(total)}
                    </p>
                    <p className="text-xs text-[rgb(var(--color-text-400))]">
                      {t("aiBalance.creditsUnit", { defaultValue: "credits" })}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--color-text-400))]">
                      {t("aiBalance.included", { defaultValue: "Included (monthly)" })}
                    </p>
                    <p
                      id="appliance-ai-balance-included"
                      className="mt-2 text-2xl font-bold text-[rgb(var(--color-text-900))]"
                    >
                      {formatFull(summary?.includedBalanceCredits ?? 0)}
                    </p>
                    <p className="text-xs text-[rgb(var(--color-text-400))]">
                      {t("aiBalance.resetsMonthly", { defaultValue: "resets each cycle" })}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--color-text-400))]">
                      {t("aiBalance.topup", { defaultValue: "Top-up (persists)" })}
                    </p>
                    <p
                      id="appliance-ai-balance-topup"
                      className="mt-2 text-2xl font-bold text-[rgb(var(--color-text-900))]"
                    >
                      {formatFull(summary?.topupBalanceCredits ?? 0)}
                    </p>
                    <p className="text-xs text-[rgb(var(--color-text-400))]">
                      {t("aiBalance.carriesOver", { defaultValue: "carries over" })}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="flex items-center gap-2 font-semibold text-[rgb(var(--color-text-900))]">
                      <Zap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      {t("aiBalance.manage.heading", {
                        defaultValue: "Buy credits or manage the subscription",
                      })}
                    </h3>
                    <p className="mt-1 max-w-2xl text-sm text-[rgb(var(--color-text-500))]">
                      {t("aiBalance.manage.body", {
                        defaultValue:
                          "Top-ups, auto-top-up, and subscription changes are handled in the Nine Minds store.",
                      })}
                    </p>
                  </div>
                  <Button
                    id="appliance-ai-topup-link"
                    variant="outline"
                    asChild
                    className="w-full gap-2 whitespace-nowrap sm:w-auto"
                  >
                    <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      {t("aiBalance.manage.openStore", {
                        defaultValue: "Open the store",
                      })}
                    </a>
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
