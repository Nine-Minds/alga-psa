"use client";

import React from "react";
import { Badge, type BadgeVariant } from "@alga-psa/ui/components/Badge";
import { cn } from "@alga-psa/ui/lib/utils";
import { useFormatters, useTranslation } from "@alga-psa/ui/lib/i18n/client";
import type { SimulatedPeriod, SimulatedPeriodMarker } from "@alga-psa/types";

interface SimulationTimelineProps {
  periods: SimulatedPeriod[];
  baselinePeriods: SimulatedPeriod[] | null;
  currencyCode: string;
  selectedIndex: number | null;
  onSelectPeriod: (index: number) => void;
}

const MARKER_META: Record<
  SimulatedPeriodMarker,
  { variant: BadgeVariant; labelKey: string; defaultLabel: string }
> = {
  prorated: {
    variant: "info",
    labelKey: "contractSimulator.markers.prorated",
    defaultLabel: "Prorated",
  },
  bucket_overage: {
    variant: "warning",
    labelKey: "contractSimulator.markers.bucketOverage",
    defaultLabel: "Bucket overage",
  },
  one_time: {
    variant: "default-muted",
    labelKey: "contractSimulator.markers.oneTime",
    defaultLabel: "One-time",
  },
  cadence_coincidence: {
    variant: "secondary",
    labelKey: "contractSimulator.markers.cadenceCoincidence",
    defaultLabel: "Cadence overlap",
  },
  contract_end: {
    variant: "error",
    labelKey: "contractSimulator.markers.contractEnd",
    defaultLabel: "Contract ends",
  },
};

const SimulationTimeline: React.FC<SimulationTimelineProps> = ({
  periods,
  baselinePeriods,
  currencyCode,
  selectedIndex,
  onSelectPeriod,
}) => {
  const { t } = useTranslation("msp/contracts");
  const { formatCurrency, formatDate } = useFormatters();

  const dateRange = (period: SimulatedPeriod) => {
    const options: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    };
    return `${formatDate(period.period_start, options)} – ${formatDate(period.period_end, options)}`;
  };

  const deltaLabels = (period: SimulatedPeriod): string[] => {
    const labels: string[] = [];
    const previous = period.index > 0 ? periods[period.index - 1] : null;
    if (previous) {
      const previousDelta = period.total - previous.total;
      if (previousDelta !== 0) {
        const amount = formatCurrency(
          Math.abs(previousDelta) / 100,
          currencyCode,
        );
        labels.push(
          t("contractSimulator.timeline.previousDelta", {
            defaultValue: "{{sign}}{{amount}} from {{period}} invoice",
            sign: previousDelta > 0 ? "+" : "−",
            amount,
            period: previous.label,
          }),
        );
      }
    }
    const baseline = baselinePeriods?.[period.index];
    if (!baseline) return labels;
    const delta = period.total - baseline.total;
    if (delta === 0) return labels;
    const formatted = formatCurrency(Math.abs(delta) / 100, currencyCode);
    labels.push(
      delta > 0
        ? t("contractSimulator.timeline.deltaUp", {
            defaultValue: "+{{amount}} from current contract",
            amount: formatted,
          })
        : t("contractSimulator.timeline.deltaDown", {
            defaultValue: "−{{amount}} from current contract",
            amount: formatted,
          }),
    );
    return labels;
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold text-[rgb(var(--color-text-600))]">
        {t("contractSimulator.timeline.title", {
          defaultValue: "Projected invoice periods",
        })}
      </h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
        {periods.map((period) => {
          const selected = selectedIndex === period.index;
          const deltas = deltaLabels(period);
          return (
            <button
              key={period.index}
              id={`period-card-${period.index}`}
              type="button"
              aria-pressed={selected}
              aria-label={t("contractSimulator.timeline.periodAria", {
                defaultValue: "{{period}}, {{total}}",
                period: period.label,
                total: formatCurrency(period.total / 100, currencyCode),
              })}
              onClick={() => onSelectPeriod(period.index)}
              className={cn(
                "rounded-xl border bg-[rgb(var(--color-card))] p-3 text-left transition-colors",
                selected
                  ? "border-[rgb(var(--color-primary-500))] ring-2 ring-[rgb(var(--color-primary-200))] dark:ring-[rgb(var(--color-primary-400)/0.30)]"
                  : "border-[rgb(var(--color-border-200))] hover:border-[rgb(var(--color-primary-300))]",
              )}
            >
              <div className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
                {period.label}
              </div>
              <div className="mt-0.5 text-[11px] text-[rgb(var(--color-text-400))]">
                {dateRange(period)}
              </div>
              <div className="mt-2.5 font-mono text-lg font-medium text-[rgb(var(--color-text-900))]">
                {formatCurrency(period.total / 100, currencyCode)}
              </div>
              {deltas.map((delta) => (
                <div
                  key={delta}
                  className="mt-0.5 font-mono text-[11px] text-[rgb(var(--color-text-500))]"
                >
                  {delta}
                </div>
              ))}
              {period.markers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {period.markers.map((marker) => {
                    const meta = MARKER_META[marker];
                    return (
                      <Badge key={marker} variant={meta.variant} size="sm">
                        {t(meta.labelKey, { defaultValue: meta.defaultLabel })}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default SimulationTimeline;
