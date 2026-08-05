'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  listOpportunityStepTemplates,
  saveAllOpportunityStepTemplates,
} from '@alga-psa/opportunities/actions';
import { OPPORTUNITY_STAGE_LABELS } from '@alga-psa/opportunities/lib/opportunityStages';
import type { IOpportunityStepTemplate, OpportunityStage } from '@alga-psa/types';

type PlannableStage = Exclude<OpportunityStage, 'won' | 'lost'>;

const STAGES: PlannableStage[] = ['identified', 'qualified', 'assessment', 'proposed', 'verbal'];

interface TemplateRow {
  title: string;
  due_offset_days: number;
}

type PlanByStage = Record<PlannableStage, TemplateRow[]>;

const toPlan = (templates: IOpportunityStepTemplate[]): PlanByStage =>
  STAGES.reduce((acc, stage) => {
    acc[stage] = templates
      .filter((template) => template.stage === stage)
      .map((template) => ({ title: template.title, due_offset_days: template.due_offset_days }));
    return acc;
  }, {} as PlanByStage);

/**
 * The tenant's standard steps per stage. Blank rows are rejected here rather
 * than dropped server-side, so what the screen shows after a save is what was
 * actually stored.
 */
export default function OpportunityStepTemplatesSettings() {
  const { t } = useTranslation('msp/opportunities');
  const [plan, setPlan] = useState<PlanByStage | null>(null);
  const [saving, setSaving] = useState(false);
  const [showBlankErrors, setShowBlankErrors] = useState(false);

  useEffect(() => {
    let mounted = true;
    listOpportunityStepTemplates()
      .then((templates) => {
        if (mounted) setPlan(toPlan(templates));
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
    return () => {
      mounted = false;
    };
  }, []);

  const setRows = (stage: PlannableStage, rows: TemplateRow[]) =>
    setPlan((current) => (current ? { ...current, [stage]: rows } : current));

  const blankRowCount = plan
    ? STAGES.reduce((count, stage) => count + plan[stage].filter((row) => !row.title.trim()).length, 0)
    : 0;

  const save = async () => {
    if (!plan) return;
    if (blankRowCount > 0) {
      setShowBlankErrors(true);
      toast.error(
        t('opportunities.settings.stepTemplatesBlank', 'Name every step, or remove the empty rows, before saving.')
      );
      return;
    }
    setSaving(true);
    try {
      // One transaction for every stage: a failure commits nothing, so the
      // screen never disagrees with the server about half the plan.
      const saved: IOpportunityStepTemplate[] = await saveAllOpportunityStepTemplates(
        STAGES.map((stage) => ({ stage, titles: plan[stage] })),
      );
      // Show what the server kept, so a silent drop can never look like a save.
      setPlan(toPlan(saved));
      setShowBlankErrors(false);
      toast.success(t('opportunities.settings.stepTemplatesSaved', 'Steps saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (plan === null) return <Skeleton className="h-64 w-full" />;

  return (
    <div id="opportunity-step-templates" className="space-y-6">
      {STAGES.map((stage) => {
        const rows = plan[stage];
        return (
          <section key={stage} id={`opportunity-step-templates-${stage}`}>
            <h3 className="text-sm font-semibold text-[rgb(var(--color-text-800))]">
              {t(OPPORTUNITY_STAGE_LABELS[stage].key, OPPORTUNITY_STAGE_LABELS[stage].fallback)}
            </h3>
            <p className="mb-2 text-xs text-[rgb(var(--color-text-500))]">
              {t('opportunities.settings.stepTemplatesStageHelp', 'Steps offered when an opportunity plans this stage.')}
            </p>
            <div className="space-y-2">
              {rows.length === 0 ? (
                <p className="text-xs text-[rgb(var(--color-text-400))]">
                  {t('opportunities.settings.stepTemplatesEmpty', 'No steps defined for this stage.')}
                </p>
              ) : null}
              {rows.map((row, index) => (
                <div key={index} className="flex items-start gap-2">
                  <Input
                    id={`opportunity-step-template-${stage}-title-${index}`}
                    label={index === 0 ? t('opportunities.settings.stepTemplateName', 'Step name') : undefined}
                    value={row.title}
                    containerClassName="flex-1"
                    error={showBlankErrors && !row.title.trim()
                      ? t('opportunities.settings.stepTemplateNameRequired', 'Enter a step name or remove this row.')
                      : undefined}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setRows(stage, rows.map((entry, i) => (i === index ? { ...entry, title: e.target.value } : entry)))
                    }
                  />
                  <Input
                    id={`opportunity-step-template-${stage}-offset-${index}`}
                    type="number"
                    label={index === 0 ? t('opportunities.settings.stepTemplateOffset', 'Due in (days)') : undefined}
                    value={String(row.due_offset_days)}
                    containerClassName="w-32"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const value = Number(e.target.value);
                      if (!Number.isFinite(value) || value < 0) return;
                      setRows(stage, rows.map((entry, i) => (
                        i === index ? { ...entry, due_offset_days: Math.floor(value) } : entry
                      )));
                    }}
                  />
                  <Button
                    id={`opportunity-step-template-${stage}-remove-${index}`}
                    size="xs"
                    variant="ghost"
                    className={index === 0 ? 'mt-6' : 'mt-1'}
                    aria-label={t('common.delete', 'Delete')}
                    onClick={() => setRows(stage, rows.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button
                id={`opportunity-step-template-${stage}-add`}
                size="xs"
                variant="ghost"
                onClick={() => setRows(stage, [...rows, { title: '', due_offset_days: 3 }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {t('opportunities.steps.add', 'Add a step')}
              </Button>
            </div>
          </section>
        );
      })}
      <div className="flex items-center justify-end gap-3">
        {showBlankErrors && blankRowCount > 0 ? (
          <p id="opportunity-step-template-blank-warning" className="text-xs text-destructive">
            {t('opportunities.settings.stepTemplatesBlank', 'Name every step, or remove the empty rows, before saving.')}
          </p>
        ) : null}
        <Button id="opportunity-step-template-save" size="sm" onClick={save} disabled={saving}>
          {t('common.saveChanges', 'Save changes')}
        </Button>
      </div>
    </div>
  );
}
