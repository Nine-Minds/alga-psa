"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Pencil,
  Play,
} from "lucide-react";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import { Button } from "@alga-psa/ui/components/Button";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import LoadingIndicator from "@alga-psa/ui/components/LoadingIndicator";
import { SwitchWithLabel } from "@alga-psa/ui/components/SwitchWithLabel";
import { useFormatters, useTranslation } from "@alga-psa/ui/lib/i18n/client";
import type {
  ContractScenario,
  ContractSimulationResult,
  IInvoiceTemplate,
  ScenarioAssumptionPrefill,
  ScenarioReplayInvoice,
  ScenarioLineService,
  SimulatedInvoiceLine,
} from "@alga-psa/types";
import {
  FEATURE_MINIMUM_TIER,
  TIER_FEATURES,
  isContractSimulationUnavailable,
} from "@alga-psa/types";
import { FeatureUpgradeNotice } from "@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice";
import { useTierFeature } from "server/src/context/TierContext";
import {
  getContractScenarioSnapshot,
  getContractSimulationReplayAssumptions,
  getRecentContractSimulationAssumptions,
  runContractSimulation,
} from "@alga-psa/billing/actions/contractSimulationActions";
import ScenarioPanel from "./ScenarioPanel";
import AssumptionsPanel, {
  type AssumptionPrefillFeedback,
} from "./AssumptionsPanel";
import SimulationTimeline from "./SimulationTimeline";
import SimulatedInvoiceDetail from "./SimulatedInvoiceDetail";
import ChargeExplanationPanel from "./ChargeExplanationPanel";
import { compareSimulations } from "@ee/lib/billing/simulator/compareSimulations";
import { getInvoiceTemplates } from "@alga-psa/billing/actions/invoiceTemplates";

interface ContractSimulatorWorkspaceProps {
  contractId?: string;
  clientContractId?: string | null;
  /** Reserved for replay/prefill entry points; snapshot resolves the binding server-side. */
  clientId?: string | null;
  initialScenario?: ContractScenario | null;
  readOnlyScenario?: boolean;
  forceProfile?: boolean;
}

const HORIZON_OPTIONS = [3, 6, 12];

function dayAfter(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

const ContractSimulatorWorkspace: React.FC<ContractSimulatorWorkspaceProps> = ({
  contractId,
  clientContractId = null,
  clientId = null,
  initialScenario = null,
  readOnlyScenario = false,
  forceProfile = false,
}) => {
  const { t } = useTranslation("msp/contracts");
  const { formatCurrency } = useFormatters();
  const hasSimulatorAccess = useTierFeature(TIER_FEATURES.CONTRACT_SIMULATOR);
  const scenarioRevisionRef = useRef(0);
  const lastProjectedScenarioRef = useRef<string | null>(null);

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
  const [baselineResult, setBaselineResult] =
    useState<ContractSimulationResult | null>(null);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [isPrefilling, setIsPrefilling] = useState(false);
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [prefillFeedback, setPrefillFeedback] =
    useState<AssumptionPrefillFeedback | null>(null);
  const [prefillPeriodLabels, setPrefillPeriodLabels] = useState<string[]>([]);
  const [invoiceTemplate, setInvoiceTemplate] =
    useState<IInvoiceTemplate | null>(null);
  const [actualReplayInvoices, setActualReplayInvoices] = useState<
    ScenarioReplayInvoice[]
  >([]);
  const [focusedLineKey, setFocusedLineKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getInvoiceTemplates().then((templates) => {
      if (cancelled || !Array.isArray(templates)) return;
      setInvoiceTemplate(
        templates.find((template) => template.is_default) ??
          templates[0] ??
          null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState<number | null>(
    null,
  );
  const [explanationLine, setExplanationLine] =
    useState<SimulatedInvoiceLine | null>(null);

  useEffect(() => {
    if (!hasSimulatorAccess) return;
    let cancelled = false;

    const loadSnapshot = async () => {
      setIsLoadingSnapshot(true);
      setLoadError(null);
      try {
        if (initialScenario) {
          setPristine(structuredClone(initialScenario));
          setWorking(structuredClone(initialScenario));
          if (HORIZON_OPTIONS.includes(initialScenario.horizon.period_count)) {
            setHorizonCount(initialScenario.horizon.period_count);
          }
          return;
        }
        if (!contractId) {
          throw new Error("A contract is required to load the simulator");
        }
        const snapshot = await getContractScenarioSnapshot(
          contractId,
          clientContractId,
          clientId,
          forceProfile,
        );
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
  }, [
    contractId,
    clientContractId,
    clientId,
    forceProfile,
    initialScenario,
    hasSimulatorAccess,
  ]);

  const updateWorking = useCallback(
    (mutate: (draft: ContractScenario) => void) => {
      scenarioRevisionRef.current += 1;
      setExplanationLine(null);
      setWorking((prev) => {
        if (!prev) return prev;
        const draft = structuredClone(prev);
        mutate(draft);
        return draft;
      });
      setIsStale(true);
    },
    [],
  );

  const handleRateChange = useCallback(
    (
      lineKey: string,
      serviceId: string | null,
      configurationType:
        | ScenarioLineService["configuration"]["configuration_type"]
        | null,
      cents: number | null,
    ) => {
      updateWorking((draft) => {
        const line = draft.lines.find((candidate) => candidate.key === lineKey);
        if (!line) return;
        if (serviceId === null) {
          line.custom_rate = cents;
          return;
        }
        const service = line.services.find(
          (candidate) =>
            candidate.service_id === serviceId &&
            candidate.configuration.configuration_type === configurationType,
        );
        if (!service) return;
        const configuration = service.configuration;
        if (configuration.configuration_type === "Hourly") {
          configuration.hourly_rate = cents;
        } else if (configuration.configuration_type === "Fixed") {
          configuration.base_rate = cents;
        } else if (configuration.configuration_type === "Usage") {
          configuration.base_rate = cents;
        } else if (configuration.configuration_type === "Bucket") {
          configuration.overage_rate = cents ?? 0;
        }
      });
    },
    [updateWorking],
  );

  const handleFlatAssumptionChange = useCallback(
    (assumptionKey: string, value: number) => {
      setPrefillFeedback(null);
      updateWorking((draft) => {
        const existing = draft.assumptions[assumptionKey];
        draft.assumptions[assumptionKey] = { ...existing, flat: value };
      });
    },
    [updateWorking],
  );

  const handleOverrideChange = useCallback(
    (assumptionKey: string, periodIndex: number, value: number | null) => {
      setPrefillFeedback(null);
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
    [updateWorking],
  );

  const handleResetAll = useCallback(() => {
    if (!pristine) return;
    scenarioRevisionRef.current += 1;
    setWorking(structuredClone(pristine));
    setPrefillFeedback(null);
    setPrefillPeriodLabels([]);
    setExplanationLine(null);
    setIsStale(true);
  }, [pristine]);

  const handleLinesChange = useCallback(
    (lines: ContractScenario["lines"]) => {
      updateWorking((draft) => {
        draft.lines = lines;
      });
    },
    [updateWorking],
  );

  const handlePricingSchedulesChange = useCallback(
    (pricingSchedules: ContractScenario["pricing_schedules"]) => {
      updateWorking((draft) => {
        draft.pricing_schedules = pricingSchedules;
      });
    },
    [updateWorking],
  );

  const handleDiscountsChange = useCallback(
    (discounts: NonNullable<ContractScenario["discounts"]>) => {
      updateWorking((draft) => {
        draft.discounts = discounts;
      });
    },
    [updateWorking],
  );

  const handleAdjustmentsChange = useCallback(
    (adjustments: NonNullable<ContractScenario["adjustments"]>) => {
      updateWorking((draft) => {
        draft.adjustments = adjustments;
      });
    },
    [updateWorking],
  );

  const applyPrefill = useCallback(
    (
      prefill: ScenarioAssumptionPrefill,
      kind: AssumptionPrefillFeedback["kind"],
    ) => {
      const before = working?.assumptions ?? {};
      const changed = Object.fromEntries(
        Object.entries(prefill.assumptions)
          .filter(
            ([key, value]) =>
              JSON.stringify(before[key] ?? { flat: 0 }) !==
              JSON.stringify(value),
          )
          .map(([key, value]) => [
            key,
            {
              before: before[key] ?? { flat: 0 },
              after: value,
            },
          ]),
      );
      const horizonChanged = Boolean(
        prefill.horizon &&
        JSON.stringify(prefill.horizon) !== JSON.stringify(working?.horizon),
      );
      const requiresProjectionUpdate =
        Object.keys(changed).length > 0 || horizonChanged;
      if (requiresProjectionUpdate) {
        updateWorking((draft) => {
          draft.assumptions = {
            ...draft.assumptions,
            ...prefill.assumptions,
          };
          if (prefill.horizon) draft.horizon = prefill.horizon;
        });
      }
      if (prefill.horizon) setHorizonCount(prefill.horizon.period_count);
      setPrefillPeriodLabels(prefill.horizon ? prefill.period_labels : []);
      setActualReplayInvoices(prefill.actual_invoices ?? []);
      setPrefillFeedback({
        kind,
        periodLabels: prefill.period_labels,
        actualInvoiceCount: prefill.actual_invoices?.length ?? 0,
        requiresProjectionUpdate,
        changed,
      });
    },
    [updateWorking, working],
  );

  const handleUseRecentAverages = useCallback(async () => {
    if (!working) return;
    setIsPrefilling(true);
    setPrefillError(null);
    try {
      const outcome = await getRecentContractSimulationAssumptions(working, 3);
      if (isContractSimulationUnavailable(outcome)) {
        setUnavailable(true);
        return;
      }
      applyPrefill(outcome, "recent_average");
    } catch (error) {
      setPrefillError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsPrefilling(false);
    }
  }, [working, applyPrefill]);

  const handleReplay = useCallback(
    async (startDate: string, endDateInclusive: string) => {
      if (!working) return;
      setIsPrefilling(true);
      setPrefillError(null);
      try {
        const outcome = await getContractSimulationReplayAssumptions(
          working,
          `${startDate}T00:00:00Z`,
          `${dayAfter(endDateInclusive)}T00:00:00Z`,
        );
        if (isContractSimulationUnavailable(outcome)) {
          setUnavailable(true);
          return;
        }
        applyPrefill(outcome, "replay");
      } catch (error) {
        setPrefillError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsPrefilling(false);
      }
    },
    [working, applyPrefill],
  );

  const handleSimulate = useCallback(async () => {
    if (!working || !pristine) return;
    const revisionAtStart = scenarioRevisionRef.current;
    setIsSimulating(true);
    setRunError(null);
    try {
      const horizon = { ...working.horizon, period_count: horizonCount };
      const scenarioForRun: ContractScenario = { ...working, horizon };
      const baselineScenario: ContractScenario = {
        ...structuredClone(pristine),
        horizon,
      };

      const [scenarioOutcome, baselineOutcome] = await Promise.all([
        runContractSimulation(scenarioForRun),
        compareEnabled
          ? runContractSimulation(baselineScenario)
          : Promise.resolve(null),
      ]);

      if (isContractSimulationUnavailable(scenarioOutcome)) {
        setUnavailable(true);
        return;
      }
      const resolvedBaseline =
        baselineOutcome && !isContractSimulationUnavailable(baselineOutcome)
          ? baselineOutcome
          : null;
      setResult(scenarioOutcome);
      lastProjectedScenarioRef.current = JSON.stringify(scenarioForRun);
      setBaselineResult(resolvedBaseline);
      setLastRunAt(new Date());
      setIsStale(scenarioRevisionRef.current !== revisionAtStart);
      const firstChangedPeriod = resolvedBaseline
        ? scenarioOutcome.periods.findIndex(
            (period, index) =>
              period.total !== resolvedBaseline.periods[index]?.total,
          )
        : scenarioOutcome.periods.findIndex(
            (period, index, periods) =>
              index > 0 && period.total !== periods[index - 1]?.total,
          );
      setSelectedPeriodIndex(firstChangedPeriod >= 0 ? firstChangedPeriod : 0);
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
      const fromResult = isStale ? null : result?.periods[index]?.label;
      return (
        fromResult ??
        prefillPeriodLabels[index] ??
        t("contractSimulator.assumptions.periodLabel", {
          defaultValue: "P{{number}}",
          number: index + 1,
        })
      );
    });
  }, [horizonCount, isStale, prefillPeriodLabels, result, t]);

  const horizonOptions = useMemo(
    () =>
      Array.from(new Set([...HORIZON_OPTIONS, horizonCount]))
        .sort((a, b) => a - b)
        .map((count) => ({
          value: String(count),
          label: t("contractSimulator.runBar.horizonOption", {
            defaultValue: "{{count}} billing periods",
            count,
          }),
        })),
    [t, horizonCount],
  );

  const selectedPeriod =
    selectedPeriodIndex !== null
      ? (result?.periods[selectedPeriodIndex] ?? null)
      : null;
  const comparison = useMemo(
    () =>
      compareEnabled && result && baselineResult
        ? compareSimulations(baselineResult, result)
        : null,
    [compareEnabled, baselineResult, result],
  );

  if (!hasSimulatorAccess) {
    return (
      <FeatureUpgradeNotice
        featureName={t("contractSimulator.featureName", {
          defaultValue: "Contract Simulator",
        })}
        requiredTier={FEATURE_MINIMUM_TIER[TIER_FEATURES.CONTRACT_SIMULATOR]}
      />
    );
  }

  if (isLoadingSnapshot) {
    return (
      <div className="py-16">
        <LoadingIndicator
          layout="stacked"
          text={t("contractSimulator.loadingSnapshot", {
            defaultValue: "Loading scenario…",
          })}
          spinnerProps={{ size: "sm" }}
        />
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] py-12 text-center">
        <p className="text-lg font-medium text-[rgb(var(--color-text-900))]">
          {t("contractSimulator.unavailable.title", {
            defaultValue: "Pro Feature",
          })}
        </p>
        <p className="mt-2 text-sm text-[rgb(var(--color-text-500))]">
          {t("contractSimulator.unavailable.description", {
            defaultValue:
              "The contract simulator is available in AlgaPSA Pro.",
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
            t("contractSimulator.loadFailed", {
              defaultValue: "Failed to load the contract scenario.",
            })}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <AssumptionsPanel
            scenario={working}
            periodCount={horizonCount}
            periodLabels={periodLabels}
            onFlatChange={handleFlatAssumptionChange}
            onOverrideChange={handleOverrideChange}
            onUseRecentAverages={() => void handleUseRecentAverages()}
            onReplay={(start, end) => void handleReplay(start, end)}
            isPrefilling={isPrefilling}
            prefillError={prefillError}
            prefillFeedback={prefillFeedback}
          />
          {!readOnlyScenario && (
            <ScenarioPanel
              lines={working.lines}
              pristineLines={pristine.lines}
              availableServices={working.available_services ?? []}
              pricingSchedules={working.pricing_schedules}
              discounts={working.discounts ?? []}
              adjustments={working.adjustments ?? []}
              currencyCode={working.currency_code}
              modifiedLineKeys={modifiedLineKeys}
              hasModifications={hasModifications}
              focusedLineKey={focusedLineKey}
              onRateChange={handleRateChange}
              onResetAll={handleResetAll}
              onLinesChange={handleLinesChange}
              onPricingSchedulesChange={handlePricingSchedulesChange}
              onDiscountsChange={handleDiscountsChange}
              onAdjustmentsChange={handleAdjustmentsChange}
            />
          )}
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
                ? t("contractSimulator.runBar.simulating", {
                    defaultValue: "Simulating…",
                  })
                : isStale && result
                  ? t("contractSimulator.runBar.updateSimulation", {
                      defaultValue: "Update simulation",
                    })
                  : t("contractSimulator.runBar.simulate", {
                      defaultValue: "Simulate",
                    })}
            </Button>
            <CustomSelect
              id="simulation-horizon-select"
              options={horizonOptions}
              value={String(horizonCount)}
              onValueChange={(value) => {
                scenarioRevisionRef.current += 1;
                setHorizonCount(Number(value));
                setPrefillPeriodLabels([]);
                setIsStale(true);
              }}
            />
            {!readOnlyScenario && (
              <SwitchWithLabel
                data-automation-id="compare-to-live-toggle"
                label={t("contractSimulator.runBar.compareToggle", {
                  defaultValue: "Show changes from current contract",
                })}
                checked={compareEnabled}
                disabled={isSimulating}
                onCheckedChange={(checked) => {
                  setCompareEnabled(checked);
                  if (checked) {
                    setIsStale(true);
                  } else {
                    setBaselineResult(null);
                    setIsStale(
                      Boolean(
                        result &&
                        lastProjectedScenarioRef.current !==
                          JSON.stringify({
                            ...working,
                            horizon: {
                              ...working.horizon,
                              period_count: horizonCount,
                            },
                          }),
                      ),
                    );
                  }
                }}
              />
            )}
            <div className="ml-auto flex items-center gap-1.5 text-xs text-[rgb(var(--color-text-400))]">
              {isStale ? (
                <>
                  <Pencil className="h-3.5 w-3.5 text-[rgb(var(--color-primary-500))]" />
                  {t("contractSimulator.runBar.stale", {
                    defaultValue: "Changes not simulated",
                  })}
                </>
              ) : lastRunAt ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("contractSimulator.runBar.lastRun", {
                    defaultValue:
                      "Simulation current · {{count}} billing periods",
                    count: result?.periods.length ?? horizonCount,
                  })}
                </>
              ) : (
                t("contractSimulator.runBar.neverRun", {
                  defaultValue: "Not simulated yet",
                })
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
              {isStale && (
                <Alert variant="warning">
                  <Pencil className="h-4 w-4" />
                  <AlertDescription>
                    {t("contractSimulator.runBar.staleBanner", {
                      defaultValue:
                        "These amounts are from the previous simulation. Update the simulation to include your latest changes.",
                    })}
                  </AlertDescription>
                </Alert>
              )}
              {comparison && (
                <div className="flex items-center justify-between rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-4 py-3">
                  <div>
                    <div className="text-xs font-medium text-[rgb(var(--color-text-600))]">
                      {t("contractSimulator.compare.horizonImpact", {
                        defaultValue:
                          "Total change over {{count}} billing periods",
                        count: result.periods.length,
                      })}
                    </div>
                    <div className="text-xs text-[rgb(var(--color-text-400))]">
                      {t("contractSimulator.compare.horizonImpactHint", {
                        defaultValue: "Compared with the current contract",
                      })}
                    </div>
                  </div>
                  <div className="font-mono text-lg font-semibold text-[rgb(var(--color-text-900))]">
                    {comparison.horizon_total_delta === 0
                      ? t("contractSimulator.compare.noChange", {
                          defaultValue: "No simulated change",
                        })
                      : `${
                          comparison.horizon_total_delta > 0 ? "+" : "−"
                        }${formatCurrency(
                          Math.abs(comparison.horizon_total_delta) / 100,
                          result.currency_code,
                        )}`}
                  </div>
                </div>
              )}
              {result.diagnostics.length > 0 && (
                <ul
                  aria-live="polite"
                  aria-label={t("contractSimulator.diagnostics.title", {
                    defaultValue: "Simulation notes",
                  })}
                  className="space-y-1 rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-4 py-3"
                >
                  <li className="pb-1 text-xs font-semibold text-[rgb(var(--color-text-700))]">
                    {t("contractSimulator.diagnostics.title", {
                      defaultValue: "Simulation notes",
                    })}
                  </li>
                  {result.diagnostics.map((diagnostic, index) => (
                    <li
                      key={`${diagnostic.message}-${index}`}
                      className="flex items-start gap-2 text-xs text-[rgb(var(--color-text-600))]"
                    >
                      {diagnostic.severity === "warning" ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      ) : (
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--color-text-400))]" />
                      )}
                      {diagnostic.line_key ? (
                        <button
                          type="button"
                          className="text-left underline decoration-dotted underline-offset-2"
                          onClick={() =>
                            setFocusedLineKey(diagnostic.line_key!)
                          }
                        >
                          <span className="font-medium">
                            {working.lines.find(
                              (line) => line.key === diagnostic.line_key,
                            )?.contract_line_name ?? "Contract line"}
                            {": "}
                          </span>
                          {diagnostic.message}
                        </button>
                      ) : (
                        diagnostic.message
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <SimulationTimeline
                  periods={result.periods}
                  baselinePeriods={
                    compareEnabled ? (baselineResult?.periods ?? null) : null
                  }
                  currencyCode={result.currency_code}
                  selectedIndex={selectedPeriodIndex}
                  onSelectPeriod={(index) => setSelectedPeriodIndex(index)}
                />
              </div>
              {selectedPeriod && (
                <div>
                  <SimulatedInvoiceDetail
                    period={selectedPeriod}
                    currencyCode={result.currency_code}
                    selectedChargeKey={
                      explanationLine?.explanation?.chargeKey ?? null
                    }
                    lineDeltas={
                      comparison?.periods.find(
                        (period) => period.index === selectedPeriod.index,
                      )?.lines ?? []
                    }
                    template={invoiceTemplate}
                    actualInvoice={
                      actualReplayInvoices.find(
                        (invoice) =>
                          invoice.period_start.slice(0, 10) ===
                          selectedPeriod.period_start.slice(0, 10),
                      ) ?? null
                    }
                    onExplainLine={setExplanationLine}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] py-14 text-center text-sm text-[rgb(var(--color-text-500))]">
              {t("contractSimulator.timeline.empty", {
                defaultValue:
                  "Simulate to see upcoming billing periods and inspect each charge.",
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
