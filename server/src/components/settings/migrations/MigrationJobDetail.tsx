'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import Spinner from '@alga-psa/ui/components/Spinner';
import { getMigrationJobDetails } from '@/lib/migrations/migrationActions';
import type { MigrationJobDetails } from '@/lib/migrations/types';
import MigrationConfigurePanel from './MigrationConfigurePanel';
import MigrationPreflightPanel from './MigrationPreflightPanel';
import MigrationRunPanel from './MigrationRunPanel';
import MigrationResultsPanel from './MigrationResultsPanel';
import {
  MIGRATION_STEPS,
  MIGRATION_STEP_LABELS,
  formatMigrationTimestamp,
  isMigrationStateTransient,
  migrationErrorMessage,
  migrationOutcomeBadge,
  migrationStepForState,
  migrationStepsAvailable,
  type MigrationStep,
} from './migrationUi';

const POLL_INTERVAL_MS = 3000;

interface MigrationJobDetailProps {
  migrationJobId: string;
  onBack: () => void;
}

const MigrationJobDetail = ({ migrationJobId, onBack }: MigrationJobDetailProps): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  // Loaders read the latest translator through a ref so a new `t` (namespace load,
  // language switch) never re-triggers the fetch.
  const tRef = useRef(t);
  tRef.current = t;
  const [details, setDetails] = useState<MigrationJobDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Operator-chosen step within the steps the state allows; null follows the state.
  const [stepOverride, setStepOverride] = useState<MigrationStep | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<MigrationJobDetails | null> => {
    try {
      const next = await getMigrationJobDetails(migrationJobId);
      if (isMountedRef.current) {
        setDetails(next);
        setLoadError(null);
      }
      return next;
    } catch (error) {
      if (isMountedRef.current) {
        setLoadError(migrationErrorMessage(error, tRef.current('importExport.migration.errors.loadJob', { defaultValue: 'Failed to load the migration job.' })));
      }
      return null;
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [migrationJobId]);

  useEffect(() => {
    setDetails(null);
    setIsLoading(true);
    setLoadError(null);
    setStepOverride(null);
    void refresh();
  }, [refresh]);

  // Poll while the job is in a state that changes on its own (inspecting,
  // preflighting, queued, applying).
  useEffect(() => {
    if (!details || !isMigrationStateTransient(details.state)) {
      return;
    }
    const interval = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [details, refresh]);

  const availableSteps = useMemo(
    () => (details ? migrationStepsAvailable(details.state) : []),
    [details]
  );

  const stateStep = details ? migrationStepForState(details.state) : null;
  const activeStep: MigrationStep | null =
    stepOverride && availableSteps.includes(stepOverride) ? stepOverride : stateStep;

  const handleStateChanged = useCallback(async () => {
    setStepOverride(null);
    await refresh();
  }, [refresh]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex h-48 items-center justify-center">
          <Spinner size="md" />
        </CardContent>
      </Card>
    );
  }

  if (loadError || !details) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <Alert variant="destructive">
            <AlertDescription>{loadError ?? t('importExport.migration.errors.jobNotFound', { defaultValue: 'Migration job not found.' })}</AlertDescription>
          </Alert>
          <Button id="amp-job-error-back-button" variant="outline" onClick={onBack}>
            {t('importExport.migration.actions.back', { defaultValue: 'Back to migrations' })}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const badge = migrationOutcomeBadge(details.state, details.entityCounts, t);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{details.sourceFileName}</CardTitle>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <CardDescription>
              {details.sourceSystem
                ? t('importExport.migration.detail.source', { defaultValue: 'Source: {{system}}', system: details.sourceSystem })
                : t('importExport.migration.detail.sourceNotDeclared', { defaultValue: 'Source system not declared' })}
              {details.producer ? ` · ${t('importExport.migration.detail.producer', { defaultValue: 'Producer: {{producer}}', producer: details.producer })}` : ''}
              {` · ${t('importExport.migration.detail.uploaded', { defaultValue: 'Uploaded {{timestamp}}', timestamp: formatMigrationTimestamp(details.createdAt) })}`}
            </CardDescription>
          </div>
          <Button id="amp-back-to-jobs-button" variant="outline" onClick={onBack} className="w-full md:w-auto">
            {t('importExport.migration.actions.back', { defaultValue: 'Back to migrations' })}
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {details.state === 'rejected' ? (
            <RejectionPanel details={details} />
          ) : (
            <>
              <MigrationStepper
                activeStep={activeStep}
                availableSteps={availableSteps}
                onSelectStep={(step) => setStepOverride(step)}
              />

              {details.error && details.state !== 'failed' && (
                <Alert variant="destructive">
                  <AlertDescription>{details.error}</AlertDescription>
                </Alert>
              )}

              {activeStep === 'inspect' && <InspectPanel details={details} />}
              {activeStep === 'configure' && (
                <MigrationConfigurePanel details={details} onSaved={handleStateChanged} />
              )}
              {activeStep === 'preflight' && (
                <MigrationPreflightPanel details={details} onStateChanged={handleStateChanged} />
              )}
              {activeStep === 'run' && (
                <MigrationRunPanel details={details} onStateChanged={handleStateChanged} />
              )}
              {activeStep === 'results' && <MigrationResultsPanel details={details} />}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const MigrationStepper = ({
  activeStep,
  availableSteps,
  onSelectStep,
}: {
  activeStep: MigrationStep | null;
  availableSteps: MigrationStep[];
  onSelectStep: (step: MigrationStep) => void;
}): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  const activeIndex = activeStep ? MIGRATION_STEPS.indexOf(activeStep) : -1;

  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label={t('importExport.migration.detail.lifecycleAria', { defaultValue: 'Migration lifecycle' })}>
      {MIGRATION_STEPS.map((step, index) => {
        const isActive = step === activeStep;
        const isPast = activeIndex >= 0 && index < activeIndex;
        const isSelectable = availableSteps.includes(step) && !isActive;

        const stateClasses = isActive
          ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-500)/0.12)] text-foreground font-medium'
          : isPast
            ? 'border-border text-muted-foreground'
            : 'border-border/60 text-muted-foreground/70';

        return (
          <li key={step} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden className="text-muted-foreground/60">→</span>}
            <button
              type="button"
              id={`amp-step-${step}-button`}
              onClick={() => isSelectable && onSelectStep(step)}
              disabled={!isSelectable && !isActive}
              aria-current={isActive ? 'step' : undefined}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors ${stateClasses} ${
                isSelectable ? 'cursor-pointer hover:bg-muted/60' : 'cursor-default'
              }`}
            >
              <span className="text-xs tabular-nums">{index + 1}</span>
              {MIGRATION_STEP_LABELS[step]}
            </button>
          </li>
        );
      })}
    </ol>
  );
};

const InspectPanel = ({ details }: { details: MigrationJobDetails }): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-4">
      <Spinner size="sm" />
      <p className="text-sm text-muted-foreground">
        {t('importExport.migration.detail.inspecting', { defaultValue: 'The package is being inspected and staged' })}
        {details.packageId ? ` ${t('importExport.migration.detail.packageSuffix', { defaultValue: '(package {{packageId}})', packageId: details.packageId })}` : ''}
        {t('importExport.migration.detail.inspectingRefresh', { defaultValue: '. This view refreshes automatically.' })}
      </p>
    </div>
  );
};

const RejectionPanel = ({ details }: { details: MigrationJobDetails }): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <AlertDescription>
          {t('importExport.migration.detail.rejectedBody', { defaultValue: 'This package was rejected during inspection; nothing was staged and nothing will be imported from it. Fix the package in the source system and upload a new one.' })}
        </AlertDescription>
      </Alert>
      {details.error && (
        <div className="rounded-md border border-border bg-muted/40 p-4">
          <h4 className="text-sm font-semibold text-foreground">{t('importExport.migration.detail.rejectionDetails', { defaultValue: 'Rejection details' })}</h4>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{details.error}</p>
        </div>
      )}
    </div>
  );
};

export default MigrationJobDetail;
