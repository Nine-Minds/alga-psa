'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  listOpportunityStepTemplates,
  saveOpportunityStepTemplates,
} from '@alga-psa/opportunities/actions';
import { OPPORTUNITY_STAGE_LABELS } from '@alga-psa/opportunities/lib/opportunityStages';
import type { OpportunityStage } from '@alga-psa/types';

const STAGES: Array<Exclude<OpportunityStage, 'won' | 'lost'>> = [
  'identified',
  'qualified',
  'assessment',
  'proposed',
  'verbal',
];

interface TemplateRow {
  title: string;
  due_offset_days: number;
}

/**
 * The reusable step list a seller gets when they press "Plan this stage".
 * Editing one replaces the stock list for that stage.
 */
export default function OpportunityStepTemplatesSettings() {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Exclude<OpportunityStage, 'won' | 'lost'>>('identified');
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    setRows(null);
    listOpportunityStepTemplates(stage)
      .then((templates) => {
        if (!mounted) return;
        setRows(templates.map((template) => ({
          title: template.title,
          due_offset_days: template.due_offset_days,
        })));
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
    return () => {
      mounted = false;
    };
  }, [stage]);

  const save = async () => {
    if (!rows) return;
    setSaving(true);
    try {
      const saved = await saveOpportunityStepTemplates(stage, rows);
      setRows(saved.map((template) => ({
        title: template.title,
        due_offset_days: template.due_offset_days,
      })));
      toast.success(t('opportunities.settings.stepTemplatesSaved', 'Step plan saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="opportunity-step-templates" className="space-y-4">
      <CustomSelect
        id="opportunity-step-templates-stage"
        label={t('opportunities.settings.stepTemplatesStage', 'Stage')}
        options={STAGES.map((entry) => ({
          value: entry,
          label: t(OPPORTUNITY_STAGE_LABELS[entry].key, OPPORTUNITY_STAGE_LABELS[entry].fallback),
        }))}
        value={stage}
        onValueChange={(value: string) => setStage(value as Exclude<OpportunityStage, 'won' | 'lost'>)}
      />
      {rows === null ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-end gap-2">
              <Input
                id={`opportunity-step-template-title-${index}`}
                label={index === 0 ? t('opportunities.steps.title', 'Step') : undefined}
                value={row.title}
                containerClassName="flex-1"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setRows(rows.map((entry, i) => (i === index ? { ...entry, title: e.target.value } : entry)))
                }
              />
              <Input
                id={`opportunity-step-template-offset-${index}`}
                type="number"
                label={index === 0 ? t('opportunities.settings.stepTemplateOffset', 'Days out') : undefined}
                value={String(row.due_offset_days)}
                containerClassName="w-28"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const value = Number(e.target.value);
                  if (!Number.isFinite(value) || value < 0) return;
                  setRows(rows.map((entry, i) => (
                    i === index ? { ...entry, due_offset_days: Math.floor(value) } : entry
                  )));
                }}
              />
              <Button
                id={`opportunity-step-template-remove-${index}`}
                size="xs"
                variant="ghost"
                className="mb-1"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button
              id="opportunity-step-template-add"
              size="xs"
              variant="ghost"
              onClick={() => setRows([...rows, { title: '', due_offset_days: 3 }])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {t('opportunities.steps.add', 'Add a step')}
            </Button>
            <Button id="opportunity-step-template-save" size="sm" onClick={save} disabled={saving}>
              {t('common.saveChanges', 'Save changes')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
