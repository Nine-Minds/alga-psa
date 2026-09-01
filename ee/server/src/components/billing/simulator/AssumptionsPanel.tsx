"use client";

import React, { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@alga-psa/ui/components/Button";
import { DatePicker } from "@alga-psa/ui/components/DatePicker";
import { dateFromString, dateToString } from "@alga-psa/ui/lib/dateInput";
import { cn } from "@alga-psa/ui/lib/utils";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import type { ContractScenario, ScenarioAssumption } from "@alga-psa/types";

interface AssumptionRow {
  key: string;
  lineKey: string;
  lineName: string;
  serviceId: string;
  serviceName: string;
  unit: string;
  billingTiming: "advance" | "arrears";
}

interface AssumptionsPanelProps {
  scenario: ContractScenario;
  periodCount: number;
  periodLabels: string[];
  onFlatChange: (assumptionKey: string, value: number) => void;
  onOverrideChange: (
    assumptionKey: string,
    periodIndex: number,
    value: number | null,
  ) => void;
  onUseRecentAverages: () => void;
  onReplay: (startDate: string, endDateInclusive: string) => void;
  isPrefilling: boolean;
  prefillError: string | null;
  prefillFeedback: AssumptionPrefillFeedback | null;
}

export interface AssumptionPrefillFeedback {
  kind: "recent_average" | "replay";
  periodLabels: string[];
  actualInvoiceCount: number;
  requiresProjectionUpdate: boolean;
  changed: Record<
    string,
    {
      before: ScenarioAssumption;
      after: ScenarioAssumption;
    }
  >;
}

const AssumptionsPanel: React.FC<AssumptionsPanelProps> = ({
  scenario,
  periodCount,
  periodLabels,
  onFlatChange,
  onOverrideChange,
  onUseRecentAverages,
  onReplay,
  isPrefilling,
  prefillError,
  prefillFeedback,
}) => {
  const { t } = useTranslation("msp/contracts");
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [replayStart, setReplayStart] = useState("");
  const [replayEnd, setReplayEnd] = useState("");

  const hoursUnit = t("contractSimulator.assumptions.hoursUnit", {
    defaultValue: "hrs",
  });

  // Activity-driven services need an assumption; Fixed-only lines do not.
  const rows = useMemo<AssumptionRow[]>(() => {
    const derived = new Map<string, AssumptionRow>();
    for (const line of scenario.lines) {
      for (const service of line.services) {
        if (service.item_kind === "product") continue;
        const configurationType = service.configuration.configuration_type;
        if (configurationType === "Fixed") continue;
        const key = `${line.key}:${service.service_id}`;
        const row: AssumptionRow = {
          key,
          lineKey: line.key,
          lineName: line.contract_line_name,
          serviceId: service.service_id,
          serviceName: service.service_name,
          unit:
            configurationType === "Usage"
              ? service.configuration.unit_of_measure
              : hoursUnit,
          billingTiming: line.billing_timing,
        };
        // Bucket is an overlay beside the primary Hourly/Usage config. Both
        // consume the same assumption, so render one control. Prefer Usage to
        // retain its catalog unit when the overlay is usage-based.
        if (!derived.has(key) || configurationType === "Usage") {
          derived.set(key, row);
        }
      }
    }
    return Array.from(derived.values());
  }, [scenario.lines, hoursUnit]);

  const toggleRow = (key: string) => {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const sourceWindow = useMemo(() => {
    if (!prefillFeedback?.periodLabels.length) return null;
    const first = prefillFeedback.periodLabels[0];
    const last =
      prefillFeedback.periodLabels[prefillFeedback.periodLabels.length - 1];
    return `${first.split(" – ")[0]} – ${last.split(" – ").at(-1)}`;
  }, [prefillFeedback]);

  const changedCount = Object.keys(prefillFeedback?.changed ?? {}).length;

  return (
    <section className="overflow-hidden rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
      <div className="border-b border-[rgb(var(--color-border-200))] px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
            {t("contractSimulator.assumptions.title", {
              defaultValue: "Assumed activity",
            })}
          </h3>
          <Button
            id="use-recent-averages-button"
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={isPrefilling || scenario.client_binding.kind !== "client"}
            onClick={onUseRecentAverages}
          >
            {t("contractSimulator.assumptions.useRecent", {
              defaultValue: "Use average from last 3 billing periods",
            })}
          </Button>
        </div>
        <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">
          {t("contractSimulator.assumptions.subtitle", {
            defaultValue:
              "Enter expected work or usage by service period. For arrears, each invoice uses the previous service period.",
          })}
        </p>
      </div>

      {isPrefilling && (
        <div
          role="status"
          className="border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-4 py-3 text-xs text-[rgb(var(--color-text-600))]"
        >
          {t("contractSimulator.assumptions.loadingHistory", {
            defaultValue: "Loading historical activity…",
          })}
        </div>
      )}

      {prefillError && (
        <div
          role="alert"
          className="border-b border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
        >
          {prefillError}
        </div>
      )}

      {prefillFeedback && !isPrefilling && (
        <div
          role="status"
          className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
        >
          {changedCount === 0 && !prefillFeedback.requiresProjectionUpdate ? (
            <p className="font-medium">
              {t("contractSimulator.assumptions.prefillUnchanged", {
                defaultValue:
                  "Loaded values from {{window}} match the current assumed activity.",
                window: sourceWindow,
              })}
            </p>
          ) : (
            <>
              <p className="font-medium">
                {changedCount === 0
                  ? t("contractSimulator.assumptions.replayRangeLoaded", {
                      defaultValue:
                        "Historical activity and {{count}} issued invoices loaded from {{window}}. Assumed activity is unchanged.",
                      window: sourceWindow,
                      count: prefillFeedback.actualInvoiceCount,
                    })
                  : prefillFeedback.kind === "recent_average"
                    ? t("contractSimulator.assumptions.averageLoaded", {
                        defaultValue:
                          "Activity average loaded from {{window}}. {{count}} assumed values changed.",
                        window: sourceWindow,
                        count: changedCount,
                      })
                    : t("contractSimulator.assumptions.replayLoaded", {
                        defaultValue:
                          "Historical activity loaded from {{window}} with {{count}} issued invoices. {{changed}} assumed values changed.",
                        window: sourceWindow,
                        count: prefillFeedback.actualInvoiceCount,
                        changed: changedCount,
                      })}
              </p>
              <p className="mt-1">
                {t("contractSimulator.assumptions.prefillNextStep", {
                  defaultValue:
                    "Updated values are highlighted. Update the simulation to recalculate invoices.",
                })}
              </p>
            </>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-[rgb(var(--color-text-400))]">
          {t("contractSimulator.assumptions.empty", {
            defaultValue: "Fixed-only scenario — nothing to assume.",
          })}
        </div>
      ) : (
        <div className="p-2">
          {rows.map((row) => {
            const assumption = scenario.assumptions[row.key];
            const flat = assumption?.flat ?? 0;
            const overrides = assumption?.overrides ?? {};
            const open = openRows.has(row.key);
            const prefillChange = prefillFeedback?.changed[row.key];
            return (
              <div
                key={row.key}
                className={cn(
                  "border-b border-[rgb(var(--color-border-200))] px-1 py-2.5 last:border-b-0",
                  prefillChange && "bg-emerald-50/70 dark:bg-emerald-500/10",
                )}
              >
                <div className="flex items-end gap-2">
                  <label
                    htmlFor={`assumption-flat-${row.lineKey}-${row.serviceId}`}
                    className="min-w-0 flex-1 text-xs text-[rgb(var(--color-text-700))]"
                  >
                    <span className="block font-medium text-[rgb(var(--color-text-800))]">
                      {t("contractSimulator.assumptions.rowLabel", {
                        defaultValue:
                          "{{service}} — assumed {{unit}} per service period",
                        unit: row.unit,
                        service: row.serviceName,
                      })}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[rgb(var(--color-text-400))]">
                      {row.lineName}
                      {` · ${
                        row.billingTiming === "arrears"
                          ? t("contractSimulator.assumptions.arrearsHint", {
                              defaultValue:
                                "Each invoice bills the previous service period.",
                            })
                          : t("contractSimulator.assumptions.advanceHint", {
                              defaultValue:
                                "Each invoice bills its current service period.",
                            })
                      }`}
                    </span>
                  </label>
                  <div className="flex items-center overflow-hidden rounded-md border border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-card))] focus-within:border-[rgb(var(--color-primary-500))]">
                    <input
                      id={`assumption-flat-${row.lineKey}-${row.serviceId}`}
                      aria-label={t(
                        "contractSimulator.assumptions.inputLabel",
                        {
                          defaultValue:
                            "Assumed {{unit}} per service period — {{service}}",
                          unit: row.unit,
                          service: row.serviceName,
                        },
                      )}
                      type="number"
                      min="0"
                      step="any"
                      value={flat}
                      onChange={(event) =>
                        onFlatChange(
                          row.key,
                          Number.parseFloat(event.target.value) || 0,
                        )
                      }
                      className="w-[88px] border-0 bg-transparent px-2 py-1.5 text-right font-mono text-sm text-[rgb(var(--color-text-900))] outline-none"
                    />
                    <span className="border-l border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-2 py-1.5 text-xs text-[rgb(var(--color-text-500))]">
                      {row.unit}
                    </span>
                  </div>
                </div>
                {flat === 0 && (
                  <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    {t("contractSimulator.assumptions.zeroActivity", {
                      defaultValue:
                        "This service contributes nothing until assumed activity is greater than zero.",
                    })}
                  </p>
                )}
                {prefillChange && (
                  <p className="mt-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    {t("contractSimulator.assumptions.prefillChange", {
                      defaultValue:
                        "Loaded value: {{before}} → {{after}} {{unit}} per service period",
                      before: prefillChange.before.flat,
                      after: prefillChange.after.flat,
                      unit: row.unit,
                    })}
                    {Object.keys(prefillChange.after.overrides ?? {}).length >
                      0 &&
                      ` · ${t(
                        "contractSimulator.assumptions.prefillOverrides",
                        {
                          defaultValue: "{{count}} period values loaded",
                          count: Object.keys(
                            prefillChange.after.overrides ?? {},
                          ).length,
                        },
                      )}`}
                  </p>
                )}

                <button
                  id={`vary-by-period-${row.lineKey}-${row.serviceId}`}
                  type="button"
                  onClick={() => toggleRow(row.key)}
                  className="mt-1.5 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-[rgb(var(--color-text-500))] hover:bg-[rgb(var(--color-primary-50))] hover:text-[rgb(var(--color-primary-700))] dark:hover:bg-[rgb(var(--color-primary-400)/0.15)]"
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 transition-transform",
                      open && "rotate-90",
                    )}
                  />
                  {t("contractSimulator.assumptions.varyByPeriod", {
                    defaultValue: "Set activity for each invoice",
                  })}
                </button>

                {open && (
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    {Array.from({ length: periodCount }, (_, periodIndex) => {
                      const override = overrides[periodIndex];
                      const hasOverride = override !== undefined;
                      return (
                        <label
                          key={periodIndex}
                          className="flex flex-col gap-0.5"
                        >
                          <span className="text-[10px] text-[rgb(var(--color-text-400))]">
                            {t(
                              "contractSimulator.assumptions.invoicePeriodLabel",
                              {
                                defaultValue: "{{period}} invoice",
                                period: periodLabels[periodIndex],
                              },
                            )}
                          </span>
                          <span
                            className={cn(
                              "flex overflow-hidden rounded border focus-within:border-[rgb(var(--color-primary-500))]",
                              hasOverride
                                ? "border-[rgb(var(--color-primary-300))] bg-[rgb(var(--color-primary-50))] dark:bg-[rgb(var(--color-primary-400)/0.15)]"
                                : "border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]",
                            )}
                          >
                            <input
                              id={`assumption-override-${row.lineKey}-${row.serviceId}-${periodIndex}`}
                              aria-label={t(
                                "contractSimulator.assumptions.overrideInputLabel",
                                {
                                  defaultValue:
                                    "{{period}} invoice — {{unit}} from its service period — {{service}}",
                                  period: periodLabels[periodIndex],
                                  unit: row.unit,
                                  service: row.serviceName,
                                },
                              )}
                              type="number"
                              step="any"
                              value={hasOverride ? override : ""}
                              placeholder={String(flat)}
                              onChange={(event) =>
                                onOverrideChange(
                                  row.key,
                                  periodIndex,
                                  event.target.value === ""
                                    ? null
                                    : Number.parseFloat(event.target.value) ||
                                        0,
                                )
                              }
                              className={cn(
                                "min-w-0 flex-1 border-0 bg-transparent px-1.5 py-0.5 text-right font-mono text-[11px] outline-none",
                                hasOverride
                                  ? "font-medium text-[rgb(var(--color-primary-700))]"
                                  : "text-[rgb(var(--color-text-600))]",
                              )}
                            />
                            <span className="border-l border-[rgb(var(--color-border-200))] px-1 py-0.5 text-[10px] text-[rgb(var(--color-text-400))]">
                              {row.unit}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <details className="border-t border-[rgb(var(--color-border-200))]">
        <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-[rgb(var(--color-text-600))]">
          {t("contractSimulator.assumptions.replayTitle", {
            defaultValue: "Compare with past invoices",
          })}
        </summary>
        <div className="flex flex-wrap items-end gap-2 px-4 pb-4">
          <label className="flex flex-col gap-1 text-xs text-[rgb(var(--color-text-500))]">
            {t("contractSimulator.assumptions.replayStart", {
              defaultValue: "From",
            })}
            <DatePicker
              id="simulation-replay-start"
              label={t("contractSimulator.assumptions.replayStart", {
                defaultValue: "From",
              })}
              value={dateFromString(replayStart)}
              onChange={(date) => setReplayStart(dateToString(date))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[rgb(var(--color-text-500))]">
            {t("contractSimulator.assumptions.replayEnd", {
              defaultValue: "Through",
            })}
            <DatePicker
              id="simulation-replay-end"
              label={t("contractSimulator.assumptions.replayEnd", {
                defaultValue: "Through",
              })}
              value={dateFromString(replayEnd)}
              onChange={(date) => setReplayEnd(dateToString(date))}
            />
          </label>
          <Button
            id="load-historical-replay-button"
            variant="outline"
            size="sm"
            disabled={
              isPrefilling ||
              scenario.client_binding.kind !== "client" ||
              !replayStart ||
              !replayEnd ||
              replayEnd < replayStart
            }
            onClick={() => onReplay(replayStart, replayEnd)}
          >
            {t("contractSimulator.assumptions.loadReplay", {
              defaultValue: "Load activity and invoices",
            })}
          </Button>
        </div>
      </details>
    </section>
  );
};

export default AssumptionsPanel;
