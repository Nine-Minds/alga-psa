'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Pencil, Play } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  ContractScenario,
  ContractSimulationResult,
  SimulatedInvoiceLine,
} from '@alga-psa/types';
import { isContractSimulationUnavailable } from '@alga-psa/types';
import {
  getContractScenarioSnapshot,
  runContractSimulation,
} from '@alga-psa/billing/actions/contractSimulationActions';
import ScenarioPanel from './ScenarioPanel';
import AssumptionsPanel from './AssumptionsPanel';
import SimulationTimeline from './SimulationTimeline';
import SimulatedInvoiceDetail from './SimulatedInvoiceDetail';
import ChargeExplanationPanel from './ChargeExplanationPanel';

interface ContractSimulatorWorkspaceProps {
  contractId: string;
  clientContractId: string | null;
  /** Reserved for replay/prefill entry points; snapshot resolves the binding server-side. */
  clientId: string | null;
}

const HORIZON_OPTIONS = [3, 6, 12];

const ContractSimulatorWorkspace: React.FC<ContractSimulatorWorkspaceProps> = ({
  contractId,
  clientContractId,
}) => {
  const { t } = useTranslation('msp/contracts');

  const [pristine, setPristine] = useState<ContractScenario | null>(null);
  const [working, setWorking] = useState<ContractScenario | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [horizonCount, setHorizonCount] = useState(6);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<ContractSimulationResult | null>(null);
  const [baselineResult, setBaselineResult] = useState<ContractSimulationResult | null>(null);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);
  const [isStale, setIsStale] = useState(false);

  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState<number | null>(null);
  const [explanationLine, setExplanationLine] = useState<SimulatedInvoiceLine | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadSnapshot = async () => {
      setIsLoadingSnapshot(true);
      setLoadError(null);
      try {
        const snapshot = await getContractScenarioSnapshot(contractId, clientContractId);
        if (cancelled) return;
        if (isContractSimulationUnavailable(snapshot)) {
          setUnavailable(true);
          return;
        }
        setPristine(snapshot);
        setWorking(structuredClone(snapshot));
        if (HORIZON_OPTIONS.includes(snapshot.horizon.period_count)) {
          setHorizonCount(snapshot.horizon.period_count);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSnapshot(false);
        }
      }
    };

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [contractId, clientContractId]);

  const updateWorking = useCallback((mutate: (draft: ContractScenario) => void) => {
    setWorking((prev) => {
      if (!prev) return prev;
      const draft = structuredClone(prev);
      mutate(draft);
      return draft;
    });
    setIsStale(true);
  }, []);

  const handleRateChange = useCallback(
    (lineKey: string, serviceId: string | null, cents: number | null) => {
      updateWorking((draft) => {
        const line = draft.lines.find((candidate) => candidate.key === lineKey);
        if (!line) return;
        if (serviceId === null) {
          line.custom_rate = cents;
          return;
        }
        const service = line.services.find((candidate) => candidate.service_id === serviceId);
        if (!service) return;
        const configuration = service.configuration;
        if (configuration.configuration_type === 'Hourly') {
          configuration.hourly_rate = cents;
        } else if (configuration.configuration_type === 'Usage') {
          configuration.base_rate = cents;
        } else if (configuration.configuration_type === 'Bucket') {
          configuration.overage_rate = cents ?? 0;
        }
      });
    },
    [updateWorking]
  );

  const handleFlatAssumptionChange = useCallback(
    (assumptionKey: string, value: number) => {
      updateWorking((draft) => {
        const existing = draft.assumptions[assumptionKey];
        draft.assumptions[assumptionKey] = { ...existing, flat: value };
      });
    },
    [updateWorking]
  );

  const handleOverrideChange = useCallback(
    (assumptionKey: string, periodIndex: number, value: number | null) => {
      updateWorking((draft) => {
        const existing = draft.assumptions[assumptionKey] ?? { flat: 0 };
        const overrides = { ...(existing.overrides ?? {}) };
        if (value === null) {
          delete overrides[periodIndex];
        } else {
          overrides[periodIndex] = value;
        }
        draft.assumptions[assumptionKey] = { ...existing, overrides };
      });
    },
    [updateWorking]
  );

  const handleResetAll = useCallback(() => {
    if (!pristine) return;
    setWorking(structuredClone(pristine));
    setIsStale(true);
  }, [pristine]);

  const handleSimulate = useCallback(async () => {
    if (!working || !pristine) return;
    setIsSimulating(true);
    setRunError(null);
    try {
      const horizon = { ...working.horizon, period_count: horizonCount };
      const scenarioForRun: ContractScenario = { ...working, horizon };
      const baselineScenario: ContractScenario = { ...structuredClone(pristine), horizon };

      const [scenarioOutcome, baselineOutcome] = await Promise.all([
        runContractSimulation(scenarioForRun),
        compareEnabled ? runContractSimulation(baselineScenario) : Promise.resolve(null),
      ]);

      if (isContractSimulationUnavailable(scenarioOutcome)) {
        setUnavailable(true);
        return;
      }
      setResult(scenarioOutcome);
      setBaselineResult(
        baselineOutcome && !isContractSimulationUnavailable(baselineOutcome)
          ? baselineOutcome
          : null
      );
      setLastRunAt(new Date());
      setIsStale(false);
      setSelectedPeriodIndex((prev) =>
        prev !== null && prev < scenarioOutcome.periods.length ? prev : null
      );
      setExplanationLine(null);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSimulating(false);
    }
  }, [working, pristine, horizonCount, compareEnabled]);

  const pristineLineJsonByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of pristine?.lines ?? []) {
      map.set(line.key, JSON.stringify(line));
    }
    return map;
  }, [pristine]);

  const modifiedLineKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const line of working?.lines ?? []) {
      if (pristineLineJsonByKey.get(line.key) !== JSON.stringify(line)) {
        keys.add(line.key);
      }
    }
    return keys;
  }, [working, pristineLineJsonByKey]);

  const hasModifications = useMemo(() => {
    if (!working || !pristine) return false;
    return JSON.stringify(working) !== JSON.stringify(pristine);
  }, [working, pristine]);

  const periodLabels = useMemo(() => {
    return Array.from({ length: horizonCount }, (_, index) => {
      const fromResult = result?.periods[index]?.label;
      return fromResult ?? t('contractSimulator.assumptions.periodLabel', {
        defaultValue: 'P{{number}}',
        number: index + 1,
      });
    });
  }, [horizonCount, result, t]);

  const horizonOptions = useMemo(
    () =>
      HORIZON_OPTIONS.map((count) => ({
        value: String(count),
        label: t('contractSimulator.runBar.horizonOption', {
          defaultValue: '{{count}} periods',
          count,
        }),
      })),
    [t]
  );

  const selectedPeriod =
    selectedPeriodIndex !== null ? result?.periods[selectedPeriodIndex] ?? null : null;

  if (isLoadingSnapshot) {
    return (
      <div className="py-16">
        <LoadingIndicator
          layout="stacked"
          text={t('contractSimulator.loadingSnapshot', { defaultValue: 'Loading scenario…' })}
          spinnerProps={{ size: 'sm' }}
        />
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] py-12 text-center">
        <p className="text-lg font-medium text-[rgb(var(--color-text-900))]">
          {t('contractSimulator.unavailable.title', { defaultValue: 'Enterprise Feature' })}
        </p>
        <p className="mt-2 text-sm text-[rgb(var(--color-text-500))]">
          {t('contractSimulator.unavailable.description', {
            defaultValue: 'The contract simulator is available in the Enterprise edition of Alga PSA.',
          })}
        </p>
      </div>
    );
  }

  if (loadError || !working || !pristine) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {loadError ??
            t('contractSimulator.loadFailed', { defaultValue: 'Failed to load the contract scenario.' })}
        </AlertDescription>
      </Alert>
    );
  }

  if (working.lines.length === 0) {
    return (
      <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] py-12 text-center">
        <p className="text-sm font-medium text-[rgb(var(--color-text-700))]">
          {t('contractSimulator.emptyScenario.title', { defaultValue: 'Nothing to simulate yet' })}
        </p>
        <p className="mt-2 text-sm text-[rgb(var(--color-text-500))]">
          {t('contractSimulator.emptyScenario.description', {
            defaultValue: 'This contract has no contract lines. Add contract lines first, then come back to simulate.',
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <ScenarioPanel
            lines={working.lines}
            currencyCode={working.currency_code}
            modifiedLineKeys={modifiedLineKeys}
            hasModifications={hasModifications}
            onRateChange={handleRateChange}
            onResetAll={handleResetAll}
          />
          <AssumptionsPanel
            scenario={working}
            periodCount={horizonCount}
            periodLabels={periodLabels}
            onFlatChange={handleFlatAssumptionChange}
            onOverrideChange={handleOverrideChange}
          />
        </div>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-4 py-3">
            <Button
              id="simulate-scenario-button"
              onClick={() => void handleSimulate()}
              disabled={isSimulating}
              className="gap-2"
            >
              {isSimulating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {isSimulating
                ? t('contractSimulator.runBar.simulating', { defaultValue: 'Simulating…' })
                : t('contractSimulator.runBar.simulate', { defaultValue: 'Simulate' })}
            </Button>
            <CustomSelect
              id="simulation-horizon-select"
              options={horizonOptions}
              value={String(horizonCount)}
              onValueChange={(value) => {
                setHorizonCount(Number(value));
                setIsStale(true);
              }}
            />
            <SwitchWithLabel
              data-automation-id="compare-to-live-toggle"
              label={t('contractSimulator.runBar.compareToggle', {
                defaultValue: 'Compare to live contract',
              })}
              checked={compareEnabled}
              onCheckedChange={(checked) => {
                setCompareEnabled(checked);
                if (checked && !baselineResult) {
                  setIsStale(true);
                }
              }}
            />
            <div className="ml-auto flex items-center gap-1.5 text-xs text-[rgb(var(--color-text-400))]">
              {isStale ? (
                <>
                  <Pencil className="h-3.5 w-3.5 text-[rgb(var(--color-primary-500))]" />
                  {t('contractSimulator.runBar.stale', {
                    defaultValue: 'Scenario edited — simulate to refresh',
                  })}
                </>
              ) : lastRunAt ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t('contractSimulator.runBar.lastRun', {
                    defaultValue: 'Simulated just now · {{count}} periods',
                    count: result?.periods.length ?? horizonCount,
                  })}
                </>
              ) : (
                t('contractSimulator.runBar.neverRun', { defaultValue: 'Not simulated yet' })
              )}
            </div>
          </div>

          {runError && (
            <Alert variant="destructive">
              <AlertDescription>{runError}</AlertDescription>
            </Alert>
          )}

          {result ? (
            <>
              <SimulationTimeline
                periods={result.periods}
                baselinePeriods={compareEnabled ? baselineResult?.periods ?? null : null}
                currencyCode={result.currency_code}
                selectedIndex={selectedPeriodIndex}
                onSelectPeriod={(index) =>
                  setSelectedPeriodIndex((prev) => (prev === index ? null : index))
                }
              />
              {selectedPeriod && (
                <SimulatedInvoiceDetail
                  period={selectedPeriod}
                  currencyCode={result.currency_code}
                  diagnostics={result.diagnostics}
                  selectedChargeKey={explanationLine?.explanation?.chargeKey ?? null}
                  onExplainLine={setExplanationLine}
                />
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] py-14 text-center text-sm text-[rgb(var(--color-text-500))]">
              {t('contractSimulator.timeline.empty', {
                defaultValue: 'Press Simulate to project the upcoming billing periods for this scenario.',
              })}
            </div>
          )}
        </div>
      </div>

      <ChargeExplanationPanel
        line={explanationLine}
        currencyCode={result?.currency_code ?? working.currency_code}
        onClose={() => setExplanationLine(null)}
      />
    </div>
  );
};

export default ContractSimulatorWorkspace;
