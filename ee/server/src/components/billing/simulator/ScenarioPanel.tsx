'use client';

import React, { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { cn } from '@alga-psa/ui/lib/utils';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ScenarioLine, ScenarioLineService } from '@alga-psa/types';

interface ScenarioPanelProps {
  lines: ScenarioLine[];
  currencyCode: string;
  modifiedLineKeys: Set<string>;
  hasModifications: boolean;
  onRateChange: (lineKey: string, serviceId: string | null, cents: number | null) => void;
  onResetAll: () => void;
}

const TYPE_BADGE_CLASSES: Record<string, string> = {
  Fixed: 'bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  Hourly: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
  Usage: 'bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  Bucket:
    'bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-700))]',
};

const TypeBadge: React.FC<{ type: string }> = ({ type }) => (
  <span
    className={cn(
      'rounded px-1.5 py-px text-[10px] font-semibold lowercase tracking-wide',
      TYPE_BADGE_CLASSES[type] ??
        'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-600))]'
    )}
  >
    {type}
  </span>
);

interface InlineRateEditorProps {
  id: string;
  cents: number | null;
  suffix?: string;
  currencyCode: string;
  onCommit: (cents: number | null) => void;
}

/** Click-to-edit rate: text button that swaps to a number input, edited in dollars. */
const InlineRateEditor: React.FC<InlineRateEditorProps> = ({
  id,
  cents,
  suffix,
  currencyCode,
  onCommit,
}) => {
  const { t } = useTranslation('msp/contracts');
  const { formatCurrency } = useFormatters();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const commit = () => {
    setEditing(false);
    if (text.trim() === '') {
      onCommit(null);
      return;
    }
    const parsed = Number.parseFloat(text);
    if (!Number.isNaN(parsed)) {
      onCommit(Math.round(parsed * 100));
    }
  };

  if (!editing) {
    return (
      <button
        id={id}
        type="button"
        onClick={() => {
          setText(cents !== null ? (cents / 100).toFixed(2) : '');
          setEditing(true);
        }}
        className="ml-auto rounded border border-dashed border-transparent px-1 py-px font-mono text-xs text-[rgb(var(--color-text-800))] hover:border-[rgb(var(--color-primary-300))] hover:bg-[rgb(var(--color-primary-50))] dark:hover:bg-[rgb(var(--color-primary-400)/0.15)]"
      >
        {cents !== null
          ? formatCurrency(cents / 100, currencyCode)
          : t('contractSimulator.scenario.defaultRate', { defaultValue: 'default' })}
        {suffix && <span className="text-[rgb(var(--color-text-400))]">{suffix}</span>}
      </button>
    );
  }

  return (
    <input
      id={`${id}-input`}
      type="number"
      step="0.01"
      autoFocus
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setEditing(false);
      }}
      className="ml-auto w-20 rounded border border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-card))] px-1 py-px font-mono text-xs text-[rgb(var(--color-text-900))] outline-none"
    />
  );
};

const serviceRateEditor = (
  line: ScenarioLine,
  service: ScenarioLineService,
  currencyCode: string,
  onRateChange: ScenarioPanelProps['onRateChange']
): React.ReactNode => {
  const configuration = service.configuration;
  if (configuration.configuration_type === 'Hourly') {
    return (
      <InlineRateEditor
        id={`edit-rate-${line.key}-${service.service_id}`}
        cents={configuration.hourly_rate}
        suffix="/hr"
        currencyCode={currencyCode}
        onCommit={(cents) => onRateChange(line.key, service.service_id, cents)}
      />
    );
  }
  if (configuration.configuration_type === 'Usage') {
    return (
      <InlineRateEditor
        id={`edit-rate-${line.key}-${service.service_id}`}
        cents={configuration.base_rate}
        suffix={`/${configuration.unit_of_measure}`}
        currencyCode={currencyCode}
        onCommit={(cents) => onRateChange(line.key, service.service_id, cents)}
      />
    );
  }
  if (configuration.configuration_type === 'Bucket') {
    return (
      <InlineRateEditor
        id={`edit-rate-${line.key}-${service.service_id}`}
        cents={configuration.overage_rate}
        suffix="/hr"
        currencyCode={currencyCode}
        onCommit={(cents) => onRateChange(line.key, service.service_id, cents)}
      />
    );
  }
  return null;
};

const ScenarioPanel: React.FC<ScenarioPanelProps> = ({
  lines,
  currencyCode,
  modifiedLineKeys,
  hasModifications,
  onRateChange,
  onResetAll,
}) => {
  const { t } = useTranslation('msp/contracts');

  return (
    <section className="overflow-hidden rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
      <div className="flex items-center gap-2 border-b border-[rgb(var(--color-border-200))] px-4 py-3">
        <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
          {t('contractSimulator.scenario.title', { defaultValue: 'Scenario' })}
        </h3>
        <span className="text-xs text-[rgb(var(--color-text-400))]">
          {t('contractSimulator.scenario.lineCount', {
            defaultValue: '{{count}} lines',
            count: lines.length,
          })}
        </span>
        <Button
          id="reset-scenario-button"
          variant="ghost"
          size="xs"
          className="ml-auto"
          onClick={onResetAll}
          disabled={!hasModifications}
        >
          {t('contractSimulator.scenario.resetAll', { defaultValue: 'Reset all' })}
        </Button>
      </div>

      <div className="space-y-1.5 p-2">
        {lines.map((line) => {
          const modified = modifiedLineKeys.has(line.key);
          return (
            <div
              key={line.key}
              className={cn(
                'rounded-lg border p-2.5',
                modified
                  ? 'border-[rgb(var(--color-primary-300))] bg-[rgb(var(--color-primary-50))] dark:bg-[rgb(var(--color-primary-400)/0.10)]'
                  : 'border-[rgb(var(--color-border-200))]'
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[rgb(var(--color-text-800))]">
                  {line.contract_line_name}
                </span>
                {modified && (
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[rgb(var(--color-primary-500))]"
                    title={t('contractSimulator.scenario.modified', { defaultValue: 'Modified' })}
                  />
                )}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <TypeBadge type={line.contract_line_type} />
                {line.contract_line_type === 'Fixed' && (
                  <InlineRateEditor
                    id={`edit-rate-${line.key}`}
                    cents={line.custom_rate}
                    currencyCode={currencyCode}
                    onCommit={(cents) => onRateChange(line.key, null, cents)}
                  />
                )}
              </div>

              {line.services.map((service) => {
                const editor = serviceRateEditor(line, service, currencyCode, onRateChange);
                if (
                  service.configuration.configuration_type === 'Fixed' &&
                  line.contract_line_type === 'Fixed'
                ) {
                  // Fixed services on Fixed lines price through the line-level rate above.
                  return null;
                }
                return (
                  <div
                    key={service.service_id}
                    className="mt-1.5 flex items-center gap-1.5 border-t border-[rgb(var(--color-border-200))] pt-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[rgb(var(--color-text-600))]">
                      {service.service_name}
                    </span>
                    <TypeBadge type={service.configuration.configuration_type} />
                    {editor}
                  </div>
                );
              })}

              {line.services.some(
                (service) => service.configuration.configuration_type === 'Bucket'
              ) && (
                <div className="mt-1.5 text-[10px] text-[rgb(var(--color-text-400))]">
                  {t('contractSimulator.scenario.bucketIncluded', {
                    defaultValue: 'Includes {{hours}} hrs; rate above is the overage rate',
                    hours:
                      ((line.services.find(
                        (service) => service.configuration.configuration_type === 'Bucket'
                      )?.configuration as { total_minutes?: number })?.total_minutes ?? 0) / 60,
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default ScenarioPanel;
