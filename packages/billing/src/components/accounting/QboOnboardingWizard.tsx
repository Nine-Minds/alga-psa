'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { dateFromString, dateToString } from '@alga-psa/ui/lib/dateInput';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { QboCustomerMappingPanel } from './QboCustomerMappingPanel';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getHistoricalInvoiceMatches,
  bulkLinkHistoricalInvoices,
  backfillPaymentsForLinkedInvoices,
  completeOnboardingWizard,
  getOnboardingWizardState,
  type HistMatch,
} from '../../actions/qboOnboardingActions';

// ─── Stepper ──────────────────────────────────────────────────────────────────

const STEPS = ['Customers', 'History', 'Go-live'] as const;
type Step = 0 | 1 | 2;

function StepIndicator({ step, current }: { step: number; current: Step }) {
  const isCompleted = step < current;
  const isCurrent = step === current;
  return (
    <div className="flex items-center gap-2">
      <div
        className={[
          'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
          isCompleted ? 'bg-primary text-primary-foreground' : '',
          isCurrent ? 'ring-2 ring-primary bg-primary/10 text-primary' : '',
          !isCompleted && !isCurrent ? 'bg-muted text-muted-foreground' : '',
        ].join(' ')}
      >
        {step + 1}
      </div>
      <span
        className={[
          'text-sm',
          isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground',
        ].join(' ')}
      >
        {STEPS[step]}
      </span>
    </div>
  );
}

// ─── Step 1: Customers ────────────────────────────────────────────────────────

function StepCustomers() {
  return (
    <div id="qbo-wizard-step-0" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Review and link your Alga clients to their QuickBooks counterparts. Exact matches can be
        accepted in bulk; fuzzy matches need individual confirmation; everything else can be linked
        manually or created in QuickBooks on demand.
      </p>
      <QboCustomerMappingPanel />
    </div>
  );
}

// ─── Step 2: History ──────────────────────────────────────────────────────────

function StepHistory() {
  const { t: tCommon } = useTranslation('common');
  const [windowStart, setWindowStart] = React.useState('');
  const [fetching, setFetching] = React.useState(false);
  const [matches, setMatches] = React.useState<{
    confident: HistMatch[];
    review: Array<HistMatch & { reason: string }>;
  } | null>(null);
  const [fetchError, setFetchError] = React.useState<string | null>(null);

  const [linking, setLinking] = React.useState(false);
  const [linked, setLinked] = React.useState<number | null>(null);
  const [linkedIds, setLinkedIds] = React.useState<string[]>([]);

  const [backfill, setBackfill] = React.useState(true);
  const [backfilling, setBackfilling] = React.useState(false);
  const [backfillResult, setBackfillResult] = React.useState<{
    processed: number;
    paymentsApplied: number;
    skippedPaid: number;
    errors: number;
  } | null>(null);
  const [backfillError, setBackfillError] = React.useState<string | null>(null);

  const handleFetch = async () => {
    setFetching(true);
    setFetchError(null);
    setMatches(null);
    setLinked(null);
    setLinkedIds([]);
    setBackfillResult(null);
    setBackfillError(null);
    try {
      const result = await getHistoricalInvoiceMatches(
        windowStart ? { windowStart } : undefined
      );
      setMatches(result);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load historical matches.');
    } finally {
      setFetching(false);
    }
  };

  const handleLinkAll = async () => {
    if (!matches || matches.confident.length === 0) return;
    setLinking(true);
    try {
      const result = await bulkLinkHistoricalInvoices(matches.confident);
      const ids = matches.confident.map((m) => m.invoiceId);
      setLinked(result.linked);
      setLinkedIds(ids);

      if (backfill && ids.length > 0) {
        setBackfilling(true);
        try {
          const bf = await backfillPaymentsForLinkedInvoices(ids);
          setBackfillResult(bf);
        } catch (err) {
          setBackfillError(err instanceof Error ? err.message : 'Backfill failed.');
        } finally {
          setBackfilling(false);
        }
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to link invoices.');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div id="qbo-wizard-step-1" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Match historical QuickBooks invoices to Alga invoices by document number and total. Matched
        invoices are linked — not exported — so your books stay clean. Zero matches is a normal
        outcome if your Alga invoice numbers differ from QuickBooks.
      </p>

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="qbo-history-window-start" className="text-xs">
            History window start (optional)
          </Label>
          <DatePicker
            id="qbo-history-window-start"
            label="History window start (optional)"
            placeholder="History window start (optional)"
            clearable
            className="w-44"
            value={dateFromString(windowStart)}
            onChange={(date) => setWindowStart(dateToString(date))}
          />
        </div>
        <Button id="qbo-history-load" type="button" variant="outline" disabled={fetching} onClick={() => void handleFetch()}>
          {fetching ? tCommon('status.loading', { defaultValue: 'Loading...' }) : matches === null ? 'Load matches' : 'Reload'}
        </Button>
      </div>

      {fetchError && (
        <Alert variant="destructive">
          <AlertDescription>{fetchError}</AlertDescription>
        </Alert>
      )}

      {matches !== null && (
        <div className="space-y-4">
          {/* Confident matches */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">
                Confident matches ({matches.confident.length})
              </h4>
              {linked !== null ? (
                <span className="text-xs text-muted-foreground">
                  Linked {linked} invoice{linked !== 1 ? 's' : ''}
                </span>
              ) : (
                matches.confident.length > 0 && (
                  <Button
                    id="qbo-history-link-all"
                    type="button"
                    size="sm"
                    disabled={linking}
                    onClick={() => void handleLinkAll()}
                  >
                    {linking ? 'Linking…' : `Link all ${matches.confident.length}`}
                  </Button>
                )
              )}
            </div>

            {matches.confident.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No confident matches found. This is normal if invoice numbers differ between Alga
                and QuickBooks.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="pb-1 pr-3 text-left font-medium">Alga #</th>
                      <th className="pb-1 pr-3 text-left font-medium">QBO Doc #</th>
                      <th className="pb-1 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {matches.confident.map((m) => (
                      <tr key={m.invoiceId}>
                        <td className="py-1 pr-3">{m.invoiceNumber}</td>
                        <td className="py-1 pr-3">{m.externalDocNumber}</td>
                        <td className="py-1 text-right">{(Number(m.invoiceTotal) / 100).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {matches.confident.length > 0 && linked === null && (
              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="qbo-history-backfill"
                  checked={backfill}
                  onChange={(e) => setBackfill(e.target.checked)}
                />
                <Label htmlFor="qbo-history-backfill" className="text-sm cursor-pointer">
                  Backfill payment status for linked invoices (recommended)
                </Label>
              </div>
            )}
          </div>

          {/* Backfill result */}
          {backfilling && (
            <Alert variant="info">
              <AlertDescription>Backfilling payment status…</AlertDescription>
            </Alert>
          )}
          {backfillResult && (
            <Alert variant="success">
              <AlertDescription>
                Payment backfill complete: {backfillResult.paymentsApplied} applied,{' '}
                {backfillResult.skippedPaid} already paid, {backfillResult.errors} error
                {backfillResult.errors !== 1 ? 's' : ''}.
              </AlertDescription>
            </Alert>
          )}
          {backfillError && (
            <Alert variant="destructive">
              <AlertDescription>{backfillError}</AlertDescription>
            </Alert>
          )}

          {/* Review list */}
          {matches.review.length > 0 && (
            <div className="rounded-lg border p-4 space-y-2">
              <h4 className="text-sm font-semibold">
                Needs review ({matches.review.length}) — not auto-linked
              </h4>
              <p className="text-xs text-muted-foreground">
                These candidates have ambiguous matches. Review them manually in QuickBooks.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="pb-1 pr-3 text-left font-medium">Alga #</th>
                      <th className="pb-1 pr-3 text-left font-medium">QBO Doc #</th>
                      <th className="pb-1 pr-3 text-left font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {matches.review.map((m) => (
                      <tr key={`${m.invoiceId}-${m.externalId}`}>
                        <td className="py-1 pr-3">{m.invoiceNumber}</td>
                        <td className="py-1 pr-3">{m.externalDocNumber}</td>
                        <td className="py-1 pr-3 text-muted-foreground">{m.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Go-live ──────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface StepGoLiveProps {
  onDone: () => void;
}

function StepGoLive({ onDone }: StepGoLiveProps) {
  const [autoSyncStartDate, setAutoSyncStartDate] = React.useState(todayISO);
  // Default OFF (plan F004): going live with automatic sync must be an explicit
  // opt-in, here or on the settings health panel — never a wizard side effect.
  const [enableAutoSync, setEnableAutoSync] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleFinish = async () => {
    setSaving(true);
    setError(null);
    try {
      await completeOnboardingWizard({ autoSyncStartDate, enableAutoSync });
      onDone();
    } catch (err) {
      console.error('Failed to complete QBO onboarding wizard:', err);
      setError('Failed to complete wizard.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="qbo-wizard-step-2" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Set a go-live cutoff date. Only invoices finalized on or after this date will be
        automatically exported to QuickBooks. Earlier invoices remain manual-only.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="qbo-golive-date">Auto-sync start date</Label>
          <DatePicker
            id="qbo-golive-date"
            label="Auto-sync start date"
            placeholder="Auto-sync start date"
            clearable
            className="w-full"
            value={dateFromString(autoSyncStartDate)}
            onChange={(date) => setAutoSyncStartDate(dateToString(date))}
          />
          <p className="text-xs text-muted-foreground">
            Only invoices finalized on or after this date will auto-export.
          </p>
        </div>

        <div className="flex flex-col gap-2 justify-center">
          <div className="flex items-center justify-between">
            <Label htmlFor="qbo-golive-autosync" className="text-sm font-medium">
              Enable automatic sync
            </Label>
            <Switch
              id="qbo-golive-autosync"
              checked={enableAutoSync}
              onCheckedChange={setEnableAutoSync}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            When enabled, invoices, payments, and credits sync with QuickBooks
            every 15 minutes starting now. Leave off to review settings first —
            you can turn it on any time from the QuickBooks settings panel.
          </p>
        </div>
      </div>

      <div className="pt-2">
        <Button
          id="qbo-wizard-finish"
          type="button"
          disabled={saving || !autoSyncStartDate}
          onClick={() => void handleFinish()}
        >
          {saving ? 'Saving…' : 'Complete setup'}
        </Button>
      </div>
    </div>
  );
}

// ─── Done state ───────────────────────────────────────────────────────────────

function WizardDone({ onRerun }: { onRerun: () => void }) {
  return (
    <div className="space-y-4 text-center py-8">
      <div className="text-4xl">✓</div>
      <h3 className="text-lg font-semibold">Setup complete</h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Your QuickBooks integration is configured. Customer mappings, historical invoice links,
        and your go-live cutoff are all set.
      </p>
      <Button id="qbo-wizard-rerun" type="button" variant="outline" onClick={onRerun}>
        Re-run wizard
      </Button>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export function QboOnboardingWizard() {
  const [step, setStep] = React.useState<Step>(0);
  const [done, setDone] = React.useState(false);

  if (done) {
    return (
      <Card id="qbo-onboarding-wizard">
        <CardContent className="pt-6">
          <WizardDone onRerun={() => { setDone(false); setStep(0); }} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="qbo-onboarding-wizard">
      <CardHeader>
        <CardTitle>QuickBooks Reconciliation Wizard</CardTitle>
        <CardDescription>
          Map customers, link historical invoices, and set your go-live cutoff in three steps.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Stepper */}
        <div className="flex flex-wrap items-center gap-4 border-b pb-4">
          {STEPS.map((_, i) => (
            <React.Fragment key={i}>
              <StepIndicator step={i} current={step} />
              {i < STEPS.length - 1 && (
                <div className="hidden h-px flex-1 bg-border sm:block" />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step content */}
        {step === 0 && <StepCustomers />}
        {step === 1 && <StepHistory />}
        {step === 2 && <StepGoLive onDone={() => setDone(true)} />}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-3">
        <Button
          id="qbo-wizard-back"
          type="button"
          variant="outline"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
        >
          Back
        </Button>

        {step < 2 ? (
          <Button
            id="qbo-wizard-next"
            type="button"
            onClick={() => setStep((s) => Math.min(2, s + 1) as Step)}
          >
            Next
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

// ─── Entry component (used in SettingsPage via slot injection) ────────────────

export function QboOnboardingWizardEntry() {
  const [state, setState] = React.useState<{
    completedAt: string | null;
    lastRunAt: string | null;
    connected: boolean;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [showWizard, setShowWizard] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const s = await getOnboardingWizardState();
      setState(s);
    } catch {
      // Suppress — not connected or no permission
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading || !state || !state.connected) {
    return null;
  }

  if (showWizard) {
    return (
      <div className="space-y-3">
        <Button
          id="qbo-wizard-entry-back"
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => { setShowWizard(false); void load(); }}
        >
          ← Back to settings
        </Button>
        <QboOnboardingWizard />
      </div>
    );
  }

  if (!state.completedAt) {
    // Never completed — prominent CTA
    return (
      <div className="rounded-lg border bg-primary/5 p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Run the reconciliation wizard</p>
          <p className="text-xs text-muted-foreground">
            Map customers, link historical invoices, and set your go-live cutoff before your first
            sync.
          </p>
        </div>
        <Button id="qbo-wizard-entry-run" type="button" onClick={() => setShowWizard(true)}>
          Run setup wizard
        </Button>
      </div>
    );
  }

  // Completed — subtle re-run link
  const completedDate = new Date(state.completedAt).toLocaleDateString();
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">
        Reconciliation wizard completed {completedDate}
      </span>
      <Button id="qbo-wizard-entry-rerun" type="button" variant="ghost" size="sm" onClick={() => setShowWizard(true)}>
        Re-run reconciliation wizard
      </Button>
    </div>
  );
}
