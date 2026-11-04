'use client';

import React from 'react';
import type { ContractWizardFixedLine } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus } from 'lucide-react';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ContractWizardData } from '../ContractWizard';
import { FixedLineEditor } from './FixedLineEditor';
import { useClientBillingSchedule } from '../../../../hooks/useClientBillingSchedule';
import { createEmptyFixedLine, meaningfulFixedLines } from '../../../../lib/contractWizardFixedLines';

interface FixedFeeServicesStepProps {
  data: ContractWizardData;
  /**
   * Accepts a partial to shallow-merge, or a function that derives the partial
   * from the latest wizard state. Use the function form after an `await`, where
   * `data` is the render that started the async work and may be stale.
   */
  updateData: (
    data: Partial<ContractWizardData> | ((prev: ContractWizardData) => Partial<ContractWizardData>),
  ) => void;
}

export function FixedFeeServicesStep({ data, updateData }: FixedFeeServicesStepProps) {
  const { t } = useTranslation('msp/contracts');

  const updateLine = (
    lineKey: string,
    patch: Partial<ContractWizardFixedLine> | ((line: ContractWizardFixedLine) => Partial<ContractWizardFixedLine>),
  ) => {
    updateData((prev) => ({
      fixed_lines: prev.fixed_lines.map((line) =>
        line.line_key === lineKey ? { ...line, ...(typeof patch === 'function' ? patch(line) : patch) } : line,
      ),
    }));
  };

  const addLine = () => {
    updateData((prev) => ({
      fixed_lines: [...prev.fixed_lines, createEmptyFixedLine(prev.fixed_lines[0]?.enable_proration ?? true)],
    }));
  };

  const removeLine = (lineKey: string) => {
    updateData((prev) => {
      const remaining = prev.fixed_lines.filter((line) => line.line_key !== lineKey);
      // Always keep one placeholder so the step never renders empty.
      return { fixed_lines: remaining.length > 0 ? remaining : [createEmptyFixedLine(true)] };
    });
  };

  const lines = meaningfulFixedLines(data.fixed_lines);

  // One schedule fetch for the whole step; each line's first-invoice hint reads it.
  const { schedule: clientSchedule } = useClientBillingSchedule(
    data.client_id,
    data.cadence_owner !== 'contract',
  );

  return (
    <ReflectionContainer id="fixed-fee-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">
            {t('wizardFixed.heading', { defaultValue: 'Fixed Fee Services' })}
          </h3>
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('wizardFixed.description', {
              defaultValue: 'Configure services that are billed at a fixed rate each billing cycle. You can still track time, but billing is based on this flat amount.',
            })}
          </p>
        </div>

        <div className="p-4 bg-[rgb(var(--color-accent-50))] border border-[rgb(var(--color-accent-200))] rounded-md">
          <p className="text-sm text-[rgb(var(--color-accent-800))]">
            <strong>{t('wizardFixed.explainer.title', { defaultValue: 'What are Fixed Fee Services?' })}</strong>{' '}
            {t('wizardFixed.explainer.description', {
              defaultValue: 'These services have a set recurring price. You\'ll still track time entries for these services, but billing is based on the fixed rate, not hours worked.',
            })}
          </p>
        </div>

        {data.fixed_lines.map((line, index) => (
          <FixedLineEditor
            key={line.line_key}
            line={line}
            index={index}
            contract={data}
            clientSchedule={clientSchedule}
            updateLine={(patch) => updateLine(line.line_key, patch)}
            onRemove={() => removeLine(line.line_key)}
          />
        ))}

        <Button
          id="add-fixed-line-button"
          type="button"
          variant="outline"
          onClick={addLine}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('wizard.fixedLines.addLine', { defaultValue: 'Add fixed line' })}
        </Button>

        {lines.length === 0 && (
          <div className="p-4 bg-[rgb(var(--color-border-50))] border border-[rgb(var(--color-border-200))] rounded-md">
            <p className="text-sm text-[rgb(var(--color-text-500))] text-center">
              {t('wizardFixed.emptyState', {
                defaultValue: 'No fixed fee services added yet. Click “Add Service” above or “Skip” to move on.',
              })}
            </p>
          </div>
        )}
      </div>
    </ReflectionContainer>
  );
}
