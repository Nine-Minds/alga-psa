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
  saveOpportunityStepTemplates,
} from '@alga-psa/opportunities/actions';
import { OPPORTUNITY_STAGE_LABELS } from '@alga-psa/opportunities/lib/opportunityStages';
import type { OpportunityStage } from '@alga-psa/types';

type PlannableStage = Exclude<OpportunityStage, 'won' | 'lost'>;

const STAGES: PlannableStage[] = ['identified', 'qualified', 'assessment', 'proposed', 'verbal'];

interface TemplateRow {
  title: string;
  due_offset_days: number;
}

type PlanByStage = Record<PlannableStage, TemplateRow[]>;

/**
 * The firm's sales process, written down once for the whole tenant. Every stage
 * is on the screen together so the process can be read end to end and handed to
 * a new hire; these lists are what the suggestion buttons and "add the suggested
 * steps" offer on every deal.
 */
export default function OpportunityStepTemplatesSettings() {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<PlanByStage | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    listOpportunityStepTemplates()
      .then((templates) => {
        if (!mounted) return;
        setPlan(STAGES.reduce((acc, stage) => {
          acc[stage] = templates
            .filter((template) => template.stage === stage)
            .map((template) => ({ title: template.title, due_offset_days: template.due_offset_days }));
          return acc;
        }, {} as PlanByStage));
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
    return () => {
      mounted = false;
    };
  }, []);

  const setRows = (stage: PlannableStage, rows: TemplateRow[]) =>
    setPlan((current) => (current ? { ...current, [stage]: rows } : current));

  const save = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      for (const stage of STAGES) {
        await saveOpportunityStepTemplates(stage, plan[stage]);
      }
      toast.success(t('opportunities.settings.stepTemplatesSaved', 'Sales process saved'));
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
            <h3 className="mb-2 text-sm font-semibold text-[rgb(var(--color-text-800))]">
              {t(OPPORTUNITY_STAGE_LABELS[stage].key, OPPORTUNITY_STAGE_LABELS[stage].fallback)}
            </h3>
            <div className="space-y-2">
              {rows.length === 0 ? (
                <p className="text-xs text-[rgb(var(--color-text-400))]">
                  {t('opportunities.settings.stepTemplatesEmpty', 'No steps suggested for this stage yet.')}
                </p>
              ) : null}
              {rows.map((row, index) => (
                <div key={index} className="flex items-end gap-2">
                  <Input
                    id={`opportunity-step-template-${stage}-title-${index}`}
                    label={index === 0 ? t('opportunities.steps.title', 'Step') : undefined}
                    value={row.title}
                    containerClassName="flex-1"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setRows(stage, rows.map((entry, i) => (i === index ? { ...entry, title: e.target.value } : entry)))
                    }
                  />
                  <Input
                    id={`opportunity-step-template-${stage}-offset-${index}`}
                    type="number"
                    label={index === 0 ? t('opportunities.settings.stepTemplateOffset', 'Days out') : undefined}
                    value={String(row.due_offset_days)}
                    containerClassName="w-28"
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
                    className="mb-1"
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
      <div className="flex justify-end">
        <Button id="opportunity-step-template-save" size="sm" onClick={save} disabled={saving}>
          {t('common.saveChanges', 'Save changes')}
        </Button>
      </div>
    </div>
  );
}
