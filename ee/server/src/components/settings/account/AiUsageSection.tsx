'use client';

/**
 * AI Usage billing section (plan §5.3).
 *
 * Rendered inside the EE account/billing settings screen. Handles the full
 * add-on lifecycle: subscribe upsell, balance card (included vs top-up split,
 * cycle progress, grace + low-balance indicators), usage history (cursor
 * paginated, feature-filterable), one-time top-ups, and auto-top-up config.
 *
 * Credits are plain numbers throughout (they arrive as JSON numbers).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Progress } from '@alga-psa/ui/components/Progress';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@alga-psa/ui/components/Table';
import { RefreshCw, Sparkles, Zap, AlertTriangle } from 'lucide-react';
import {
  getAiAccountSummary,
  getAiUsageHistory,
  setAiAutoTopup,
  startAiAddonCheckout,
  startAiTopupCheckout,
  getAiTopupPacks,
  type AiTopupPack,
} from '../../../lib/actions/aiUsageActions';
import type {
  AiAccountSummary,
  AiAutoTopupSettings,
  AiFeature,
  AiSubscriptionStatus,
  AiUsageEvent,
} from '../../../lib/aiGateway/types';

const AI_FEATURES: AiFeature[] = [
  'chat',
  'chat-title',
  'email-reply-ack',
  'email-rule-classifier',
  'opportunity-drafting',
  'workflow-inference',
  'inventory-classifier',
  'document-assist',
];

const USAGE_PAGE_SIZE = 25;

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const fullNumberFormatter = new Intl.NumberFormat();

function formatCompact(value: number): string {
  return compactNumberFormatter.format(value);
}

function formatFull(value: number): string {
  return fullNumberFormatter.format(value);
}

function featureLabel(feature: string): string {
  return feature
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function statusBadgeVariant(
  status: AiSubscriptionStatus,
): 'success' | 'warning' | 'error' | 'secondary' {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'success';
    case 'past_due':
      return 'warning';
    case 'canceled':
    case 'unpaid':
      return 'error';
    case 'none':
    default:
      return 'secondary';
  }
}

/** Cycle progress derived from cycleStartedAt assuming a monthly reset. */
function cycleProgress(cycleStartedAt: string | null): {
  percent: number;
  resetsInDays: number | null;
} {
  if (!cycleStartedAt) {
    return { percent: 0, resetsInDays: null };
  }
  const start = new Date(cycleStartedAt).getTime();
  if (Number.isNaN(start)) {
    return { percent: 0, resetsInDays: null };
  }
  const next = new Date(start);
  next.setMonth(next.getMonth() + 1);
  const now = Date.now();
  const span = next.getTime() - start;
  const percent = span > 0 ? Math.min(Math.max(((now - start) / span) * 100, 0), 100) : 0;
  const resetsInDays = Math.max(
    0,
    Math.ceil((next.getTime() - now) / (1000 * 60 * 60 * 24)),
  );
  return { percent, resetsInDays };
}

interface AiUsageSectionProps {
  /**
   * Optional top-up pack override. When omitted, packs come from the
   * env-driven `getAiTopupPacks()` config surface.
   * TODO: remove once the gateway account payload exposes the pack catalogue.
   */
  packs?: AiTopupPack[];
}

export default function AiUsageSection({ packs: propPacks }: AiUsageSectionProps): React.JSX.Element {
  const { t } = useTranslation('msp/account');

  const [summary, setSummary] = useState<AiAccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);

  const [packs, setPacks] = useState<AiTopupPack[]>(propPacks ?? []);
  const [topupPendingPriceId, setTopupPendingPriceId] = useState<string | null>(null);

  const [events, setEvents] = useState<AiUsageEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [featureFilter, setFeatureFilter] = useState<'all' | AiFeature>('all');

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoThreshold, setAutoThreshold] = useState('');
  const [autoPack, setAutoPack] = useState('');
  const [savingAuto, setSavingAuto] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      const next = await getAiAccountSummary();
      setSummary(next);
    } catch (error) {
      toast.error(t('aiUsage.errors.loadSummary', { defaultValue: 'Failed to load AI usage details' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  // Top-up pack catalogue (env config unless overridden by prop).
  useEffect(() => {
    if (propPacks) {
      setPacks(propPacks);
      return;
    }
    getAiTopupPacks()
      .then(setPacks)
      .catch(() => setPacks([]));
  }, [propPacks]);

  // Seed auto-top-up form from the summary whenever it changes.
  useEffect(() => {
    if (!summary) {
      return;
    }
    setAutoEnabled(summary.autoTopup.enabled);
    setAutoThreshold(
      summary.autoTopup.thresholdCredits != null ? String(summary.autoTopup.thresholdCredits) : '',
    );
    setAutoPack(summary.autoTopup.packPriceId ?? '');
  }, [summary]);

  const isSubscribed = !!summary && summary.subscriptionStatus !== 'none';

  const loadUsagePage = useCallback(
    async (fromCursor: string | null, replace: boolean) => {
      setLoadingUsage(true);
      try {
        const page = await getAiUsageHistory({
          limit: USAGE_PAGE_SIZE,
          ...(featureFilter !== 'all' ? { feature: featureFilter } : {}),
          ...(fromCursor ? { cursor: fromCursor } : {}),
        });
        setEvents((prev) => (replace ? page.events : [...prev, ...page.events]));
        setCursor(page.nextCursor);
      } catch (error) {
        toast.error(t('aiUsage.errors.loadHistory', { defaultValue: 'Failed to load usage history' }));
      } finally {
        setLoadingUsage(false);
      }
    },
    [featureFilter, t],
  );

  // (Re)load the first page when subscribed or when the feature filter changes.
  useEffect(() => {
    if (!isSubscribed) {
      setEvents([]);
      setCursor(null);
      return;
    }
    void loadUsagePage(null, true);
  }, [isSubscribed, loadUsagePage]);

  const handleSubscribe = useCallback(async () => {
    setSubscribing(true);
    try {
      const { checkoutUrl } = await startAiAddonCheckout();
      window.location.href = checkoutUrl;
    } catch (error) {
      toast.error(t('aiUsage.errors.subscribe', { defaultValue: 'Failed to start checkout' }));
      setSubscribing(false);
    }
  }, [t]);

  const handleTopup = useCallback(
    async (priceId: string) => {
      setTopupPendingPriceId(priceId);
      try {
        const { checkoutUrl } = await startAiTopupCheckout(priceId);
        window.location.href = checkoutUrl;
      } catch (error) {
        toast.error(t('aiUsage.errors.topup', { defaultValue: 'Failed to start top-up checkout' }));
        setTopupPendingPriceId(null);
      }
    },
    [t],
  );

  const handleSaveAutoTopup = useCallback(
    async (nextEnabled?: boolean) => {
      const enabled = nextEnabled ?? autoEnabled;
      setSavingAuto(true);
      try {
        const settings: AiAutoTopupSettings = { enabled };
        const thresholdValue = Number(autoThreshold);
        if (autoThreshold.trim() !== '' && Number.isFinite(thresholdValue)) {
          settings.thresholdCredits = thresholdValue;
        }
        if (autoPack) {
          settings.packPriceId = autoPack;
        }
        const updated = await setAiAutoTopup(settings);
        setSummary(updated);
        toast.success(t('aiUsage.autoTopup.saved', { defaultValue: 'Auto top-up settings saved' }));
      } catch (error) {
        // Revert the optimistic toggle to the persisted value.
        if (summary) {
          setAutoEnabled(summary.autoTopup.enabled);
        }
        toast.error(t('aiUsage.errors.autoTopup', { defaultValue: 'Failed to save auto top-up settings' }));
      } finally {
        setSavingAuto(false);
      }
    },
    [autoEnabled, autoThreshold, autoPack, summary, t],
  );

  const featureOptions = useMemo(
    () => [
      { value: 'all', label: t('aiUsage.history.allFeatures', { defaultValue: 'All features' }) },
      ...AI_FEATURES.map((feature) => ({ value: feature, label: featureLabel(feature) })),
    ],
    [t],
  );

  const packOptions = useMemo(
    () =>
      packs.map((pack) => ({
        value: pack.priceId,
        label:
          pack.credits != null
            ? t('aiUsage.topup.packWithCredits', {
                defaultValue: '{{label}} ({{credits}} credits)',
                label: pack.label,
                credits: formatFull(pack.credits),
              })
            : pack.label,
      })),
    [packs, t],
  );

  if (loading) {
    return (
      <Card id="ai-usage-section">
        <CardContent className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
        </CardContent>
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card id="ai-usage-section">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Sparkles className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <CardTitle>{t('aiUsage.title', { defaultValue: 'AI Usage' })}</CardTitle>
              <CardDescription>
                {t('aiUsage.subtitle', { defaultValue: 'Credit-based billing for Alga AI features' })}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Alert variant="warning" showIcon={false}>
            <AlertDescription>
              {t('aiUsage.errors.unavailable', {
                defaultValue: 'AI usage details are currently unavailable. Please try again shortly.',
              })}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // --- Subscribe (upsell) state ---------------------------------------------
  if (!isSubscribed) {
    return (
      <Card id="ai-usage-section">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Sparkles className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <CardTitle>{t('aiUsage.title', { defaultValue: 'AI Usage' })}</CardTitle>
              <CardDescription>
                {t('aiUsage.subtitle', { defaultValue: 'Credit-based billing for Alga AI features' })}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Sparkles className="h-12 w-12 text-indigo-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-800 mb-2">
              {t('aiUsage.upsell.heading', { defaultValue: 'Add AI to your workspace' })}
            </h3>
            <p className="text-gray-500 mb-6 max-w-lg mx-auto">
              {t('aiUsage.upsell.body', {
                defaultValue:
                  'Subscribe to the AI add-on to unlock Alga AI across chat, email triage, and more. Your monthly plan includes a credit allotment; buy one-time top-ups or enable auto top-up any time.',
              })}
            </p>
            <Button
              id="ai-usage-subscribe-button"
              onClick={handleSubscribe}
              disabled={subscribing}
            >
              {subscribing ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t('aiUsage.upsell.subscribing', { defaultValue: 'Redirecting…' })}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {t('aiUsage.upsell.subscribe', { defaultValue: 'Subscribe to AI add-on' })}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Subscribed: balance, usage, top-up, auto-top-up ----------------------
  const total = summary.totalBalanceCredits;
  const inGrace = total <= 0;
  const lowBalance = summary.lowBalance && !inGrace;
  const { percent: cyclePercent, resetsInDays } = cycleProgress(summary.cycleStartedAt);

  return (
    <div id="ai-usage-section" className="space-y-6">
      {/* Balance card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Sparkles className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <CardTitle>{t('aiUsage.title', { defaultValue: 'AI Usage' })}</CardTitle>
                <CardDescription>
                  {t('aiUsage.subtitle', { defaultValue: 'Credit-based billing for Alga AI features' })}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={statusBadgeVariant(summary.subscriptionStatus)}>
                {t(`aiUsage.status.${summary.subscriptionStatus}`, {
                  defaultValue: featureLabel(summary.subscriptionStatus),
                })}
              </Badge>
              <button
                id="ai-usage-refresh"
                type="button"
                className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                onClick={() => void loadSummary()}
                aria-label={t('aiUsage.refresh', { defaultValue: 'Refresh' })}
                title={t('aiUsage.refresh', { defaultValue: 'Refresh' })}
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {inGrace && (
            <Alert variant="warning" showIcon={false} id="ai-usage-grace-alert">
              <AlertDescription>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <span className="font-medium">
                    {t('aiUsage.grace.title', { defaultValue: 'Credits exhausted — grace buffer in use' })}
                  </span>
                </div>
                <p className="text-sm mt-1">
                  {t('aiUsage.grace.body', {
                    defaultValue:
                      'AI keeps working within a small grace buffer of {{grace}} credits. Top up to avoid a hard stop.',
                    grace: formatFull(summary.graceLimitCredits),
                  })}
                </p>
              </AlertDescription>
            </Alert>
          )}

          {lowBalance && (
            <Alert variant="warning" showIcon={false} id="ai-usage-low-balance-alert">
              <AlertDescription>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <span className="font-medium">
                    {t('aiUsage.lowBalance.title', { defaultValue: 'Low credit balance' })}
                  </span>
                </div>
                <p className="text-sm mt-1">
                  {t('aiUsage.lowBalance.body', {
                    defaultValue: 'Consider topping up or enabling auto top-up to avoid interruptions.',
                  })}
                </p>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={`rounded-lg border p-4 ${inGrace || lowBalance ? 'border-warning/50 bg-warning/5' : ''}`}>
              <p className="text-sm text-gray-500">
                {t('aiUsage.balance.total', { defaultValue: 'Total balance' })}
              </p>
              <p className={`text-2xl font-bold ${total <= 0 ? 'text-destructive' : 'text-gray-900'}`}>
                {formatFull(total)}
              </p>
              <p className="text-xs text-gray-400">
                {t('aiUsage.balance.creditsUnit', { defaultValue: 'credits' })}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-gray-500">
                {t('aiUsage.balance.included', { defaultValue: 'Included (monthly)' })}
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {formatFull(summary.includedBalanceCredits)}
              </p>
              <p className="text-xs text-gray-400">
                {t('aiUsage.balance.resetsMonthly', { defaultValue: 'resets each cycle' })}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-gray-500">
                {t('aiUsage.balance.topup', { defaultValue: 'Top-up (persists)' })}
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {formatFull(summary.topupBalanceCredits)}
              </p>
              <p className="text-xs text-gray-400">
                {t('aiUsage.balance.carriesOver', { defaultValue: 'carries over' })}
              </p>
            </div>
          </div>

          {/* Cycle progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>{t('aiUsage.cycle.label', { defaultValue: 'Billing cycle' })}</span>
              {resetsInDays != null && (
                <span>
                  {t('aiUsage.cycle.resetsIn', {
                    defaultValue: 'Resets in {{days}} days',
                    days: resetsInDays,
                  })}
                </span>
              )}
            </div>
            <Progress value={cyclePercent} />
          </div>
        </CardContent>
      </Card>

      {/* Top-up card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <Zap className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <CardTitle>{t('aiUsage.topup.title', { defaultValue: 'Buy top-up credits' })}</CardTitle>
              <CardDescription>
                {t('aiUsage.topup.description', {
                  defaultValue: 'One-time credit packs that never expire.',
                })}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {packs.length === 0 ? (
            <p className="text-sm text-gray-500">
              {t('aiUsage.topup.noPacks', {
                defaultValue: 'No top-up packs are configured yet.',
              })}
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {packs.map((pack) => (
                <Button
                  key={pack.priceId}
                  id={`ai-usage-topup-${pack.priceId}`}
                  variant="outline"
                  onClick={() => void handleTopup(pack.priceId)}
                  disabled={topupPendingPriceId !== null}
                >
                  {topupPendingPriceId === pack.priceId ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  {pack.credits != null
                    ? t('aiUsage.topup.packWithCredits', {
                        defaultValue: '{{label}} ({{credits}} credits)',
                        label: pack.label,
                        credits: formatFull(pack.credits),
                      })
                    : pack.label}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auto top-up card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('aiUsage.autoTopup.title', { defaultValue: 'Auto top-up' })}</CardTitle>
          <CardDescription>
            {t('aiUsage.autoTopup.description', {
              defaultValue: 'Automatically buy a pack when your balance drops below a threshold.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t('aiUsage.autoTopup.enable', { defaultValue: 'Enable auto top-up' })}</Label>
              <p className="text-sm text-gray-500">
                {t('aiUsage.autoTopup.enableHelp', {
                  defaultValue: 'Uses your saved payment method for off-session charges.',
                })}
              </p>
            </div>
            <Switch
              id="ai-usage-autotopup-toggle"
              checked={autoEnabled}
              onCheckedChange={(checked) => {
                setAutoEnabled(checked);
                void handleSaveAutoTopup(checked);
              }}
              disabled={savingAuto}
            />
          </div>

          {autoEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ai-usage-autotopup-threshold">
                  {t('aiUsage.autoTopup.threshold', { defaultValue: 'Threshold (credits)' })}
                </Label>
                <Input
                  id="ai-usage-autotopup-threshold"
                  type="number"
                  min={0}
                  value={autoThreshold}
                  onChange={(event) => setAutoThreshold(event.target.value)}
                  disabled={savingAuto}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('aiUsage.autoTopup.pack', { defaultValue: 'Pack to purchase' })}</Label>
                <CustomSelect
                  id="ai-usage-autotopup-pack"
                  options={packOptions}
                  value={autoPack}
                  onValueChange={setAutoPack}
                  placeholder={t('aiUsage.autoTopup.selectPack', { defaultValue: 'Select a pack' })}
                  disabled={savingAuto || packOptions.length === 0}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {autoEnabled && (
            <div className="flex justify-end">
              <Button
                id="ai-usage-autotopup-save"
                onClick={() => void handleSaveAutoTopup()}
                disabled={savingAuto}
              >
                {savingAuto ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {t('aiUsage.autoTopup.saving', { defaultValue: 'Saving…' })}
                  </>
                ) : (
                  t('aiUsage.autoTopup.save', { defaultValue: 'Save auto top-up' })
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Usage history card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>{t('aiUsage.history.title', { defaultValue: 'Usage history' })}</CardTitle>
              <CardDescription>
                {t('aiUsage.history.description', { defaultValue: 'Per-request credit consumption.' })}
              </CardDescription>
            </div>
            <CustomSelect
              id="ai-usage-history-feature-filter"
              options={featureOptions}
              value={featureFilter}
              onValueChange={(value) => setFeatureFilter(value as 'all' | AiFeature)}
              className="w-52"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('aiUsage.history.date', { defaultValue: 'Date' })}</TableHead>
                  <TableHead>{t('aiUsage.history.feature', { defaultValue: 'Feature' })}</TableHead>
                  <TableHead>{t('aiUsage.history.model', { defaultValue: 'Model' })}</TableHead>
                  <TableHead className="text-right">
                    {t('aiUsage.history.tokens', { defaultValue: 'Tokens' })}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('aiUsage.history.credits', { defaultValue: 'Credits' })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 && !loadingUsage ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-gray-500 py-6">
                      {t('aiUsage.history.empty', { defaultValue: 'No usage recorded yet.' })}
                    </TableCell>
                  </TableRow>
                ) : (
                  events.map((event) => (
                    <TableRow key={event.usageId}>
                      <TableCell className="whitespace-nowrap">
                        {new Date(event.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>{featureLabel(event.feature)}</TableCell>
                      <TableCell className="text-gray-500">{event.model}</TableCell>
                      <TableCell className="text-right">{formatCompact(event.totalTokens)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatFull(event.creditsCharged)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {cursor && (
            <div className="flex justify-center pt-4">
              <Button
                id="ai-usage-history-load-more"
                variant="outline"
                size="sm"
                onClick={() => void loadUsagePage(cursor, false)}
                disabled={loadingUsage}
              >
                {loadingUsage ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {t('aiUsage.history.loading', { defaultValue: 'Loading…' })}
                  </>
                ) : (
                  t('aiUsage.history.loadMore', { defaultValue: 'Load more' })
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
