'use client';

import React, { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@alga-psa/ui/lib/utils';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ContractScenario } from '@alga-psa/types';

interface AssumptionRow {
  key: string;
  lineKey: string;
  serviceId: string;
  serviceName: string;
  unit: string;
}

interface AssumptionsPanelProps {
  scenario: ContractScenario;
  periodCount: number;
  periodLabels: string[];
  onFlatChange: (assumptionKey: string, value: number) => void;
  onOverrideChange: (assumptionKey: string, periodIndex: number, value: number | null) => void;
}

const AssumptionsPanel: React.FC<AssumptionsPanelProps> = ({
  scenario,
  periodCount,
  periodLabels,
  onFlatChange,
  onOverrideChange,
}) => {
  const { t } = useTranslation('msp/contracts');
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  const hoursUnit = t('contractSimulator.assumptions.hoursUnit', { defaultValue: 'hrs' });

  // Activity-driven services need an assumption; Fixed-only lines do not.
  const rows = useMemo<AssumptionRow[]>(() => {
    const derived: AssumptionRow[] = [];
    for (const line of scenario.lines) {
      for (const service of line.services) {
        const configurationType = service.configuration.configuration_type;
        if (configurationType === 'Fixed') continue;
        derived.push({
          key: `${line.key}:${service.service_id}`,
          lineKey: line.key,
          serviceId: service.service_id,
          serviceName: service.service_name,
          unit:
            configurationType === 'Usage'
              ? service.configuration.unit_of_measure
              : hoursUnit,
        });
      }
    }
    return derived;
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

  return (
    <section className="overflow-hidden rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
      <div className="flex items-center gap-2 border-b border-[rgb(var(--color-border-200))] px-4 py-3">
        <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
          {t('contractSimulator.assumptions.title', { defaultValue: 'Assumptions' })}
        </h3>
        <span className="text-xs text-[rgb(var(--color-text-400))]">
          {t('contractSimulator.assumptions.subtitle', { defaultValue: 'flat per period' })}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-[rgb(var(--color-text-400))]">
          {t('contractSimulator.assumptions.empty', {
            defaultValue: 'Fixed-only scenario — nothing to assume.',
          })}
        </div>
      ) : (
        <div className="p-2">
          {rows.map((row) => {
            const assumption = scenario.assumptions[row.key];
            const flat = assumption?.flat ?? 0;
            const overrides = assumption?.overrides ?? {};
            const open = openRows.has(row.key);
            return (
              <div
                key={row.key}
                className="border-b border-[rgb(var(--color-border-200))] px-1 py-2.5 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <label
                    htmlFor={`assumption-flat-${row.lineKey}-${row.serviceId}`}
                    className="min-w-0 flex-1 truncate text-xs text-[rgb(var(--color-text-700))]"
                  >
                    {t('contractSimulator.assumptions.rowLabel', {
                      defaultValue: 'Assumed {{unit}} — {{service}}',
                      unit: row.unit,
                      service: row.serviceName,
                    })}
                  </label>
                  <input
                    id={`assumption-flat-${row.lineKey}-${row.serviceId}`}
                    type="number"
                    step="any"
                    value={flat}
                    onChange={(event) =>
                      onFlatChange(row.key, Number.parseFloat(event.target.value) || 0)
                    }
                    className="w-[74px] rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-2 py-1 text-right font-mono text-xs text-[rgb(var(--color-text-900))] outline-none focus:border-[rgb(var(--color-primary-500))]"
                  />
                  <span className="w-8 text-[11px] text-[rgb(var(--color-text-400))]">
                    {row.unit}
                  </span>
                </div>

                <button
                  id={`vary-by-period-${row.lineKey}-${row.serviceId}`}
                  type="button"
                  onClick={() => toggleRow(row.key)}
                  className="mt-1.5 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-[rgb(var(--color-text-500))] hover:bg-[rgb(var(--color-primary-50))] hover:text-[rgb(var(--color-primary-700))] dark:hover:bg-[rgb(var(--color-primary-400)/0.15)]"
                >
                  <ChevronRight
                    className={cn('h-3 w-3 transition-transform', open && 'rotate-90')}
                  />
                  {t('contractSimulator.assumptions.varyByPeriod', {
                    defaultValue: 'vary by period',
                  })}
                </button>

                {open && (
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    {Array.from({ length: periodCount }, (_, periodIndex) => {
                      const override = overrides[periodIndex];
                      const hasOverride = override !== undefined;
                      return (
                        <div key={periodIndex} className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-[rgb(var(--color-text-400))]">
                            {periodLabels[periodIndex]}
                          </span>
                          <input
                            id={`assumption-override-${row.lineKey}-${row.serviceId}-${periodIndex}`}
                            type="number"
                            step="any"
                            value={hasOverride ? override : ''}
                            placeholder={String(flat)}
                            onChange={(event) =>
                              onOverrideChange(
                                row.key,
                                periodIndex,
                                event.target.value === ''
                                  ? null
                                  : Number.parseFloat(event.target.value) || 0
                              )
                            }
                            className={cn(
                              'w-full rounded border px-1.5 py-0.5 text-right font-mono text-[11px] outline-none focus:border-[rgb(var(--color-primary-500))]',
                              hasOverride
                                ? 'border-[rgb(var(--color-primary-300))] bg-[rgb(var(--color-primary-50))] font-medium text-[rgb(var(--color-primary-700))] dark:bg-[rgb(var(--color-primary-400)/0.15)]'
                                : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] text-[rgb(var(--color-text-600))]'
                            )}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default AssumptionsPanel;
