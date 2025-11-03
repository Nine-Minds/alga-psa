'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'server/src/lib/i18n/client';
import { useToast } from 'server/src/hooks/use-toast';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import type { SurveyTemplate, SurveyTrigger } from 'server/src/lib/actions/surveyActions';
import {
  createSurveyTrigger,
  updateSurveyTrigger,
  deleteSurveyTrigger,
} from 'server/src/lib/actions/surveyActions';

type TriggerType = 'ticket_closed' | 'project_completed';

interface TriggerFormProps {
  templates: SurveyTemplate[];
  trigger?: SurveyTrigger;
  onSuccess: (trigger: SurveyTrigger) => void;
  onDeleteSuccess?: (triggerId: string) => void;
  onCancel: () => void;
}

interface FormState {
  templateId: string | null;
  triggerType: TriggerType;
  boardIds: string;
  statusIds: string;
  priorities: string;
  enabled: boolean;
}

const TRIGGER_TYPE_OPTIONS: TriggerType[] = ['ticket_closed', 'project_completed'];

function parseList(value: string): string[] | undefined {
  const items = value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function formatList(values?: string[]): string {
  return values?.join('\n') ?? '';
}

export function TriggerForm({ templates, trigger, onSuccess, onDeleteSuccess, onCancel }: TriggerFormProps) {
  const { t } = useTranslation('common');
  const { toast } = useToast();
  const formInstanceId = useId();

  const templateOptions: SelectOption[] = useMemo(
    () =>
      templates.map((template) => ({
        value: template.templateId,
        label: template.templateName,
      })),
    [templates]
  );

  const initialState: FormState = {
    templateId: trigger?.templateId ?? (templateOptions[0]?.value ?? null),
    triggerType: trigger?.triggerType ?? 'ticket_closed',
    boardIds: formatList(trigger?.triggerConditions.board_id),
    statusIds: formatList(trigger?.triggerConditions.status_id),
    priorities: formatList(trigger?.triggerConditions.priority),
    enabled: trigger?.enabled ?? true,
  };

  const [formState, setFormState] = useState<FormState>(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const triggerTypeOptions: SelectOption[] = useMemo(
    () =>
      TRIGGER_TYPE_OPTIONS.map((type) => ({
        value: type,
        label: t(`surveys.settings.triggerForm.triggerTypes.${type}`, type),
      })),
    [t]
  );

  const handleChange = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.templateId) {
      toast({
        title: t('errors.required', 'This field is required'),
        description: t('surveys.settings.triggerForm.labels.template', 'Survey template'),
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const conditions = {
        board_id: parseList(formState.boardIds),
        status_id: parseList(formState.statusIds),
        priority: parseList(formState.priorities),
      };

      // Remove undefined keys to avoid overwriting with null
      const sanitizedConditions = Object.fromEntries(
        Object.entries(conditions).filter(([, value]) => value && value.length > 0)
      );

      let result: SurveyTrigger;
      if (trigger) {
        result = await updateSurveyTrigger(trigger.triggerId, {
          templateId: formState.templateId,
          triggerType: formState.triggerType,
          triggerConditions: sanitizedConditions,
          enabled: formState.enabled,
        });
        toast({
          title: t('surveys.settings.triggerList.toasts.updated', 'Trigger updated'),
        });
      } else {
        result = await createSurveyTrigger({
          templateId: formState.templateId,
          triggerType: formState.triggerType,
          triggerConditions: sanitizedConditions,
          enabled: formState.enabled,
        });
        toast({
          title: t('surveys.settings.triggerList.toasts.created', 'Trigger created'),
        });
      }

      onSuccess(result);
    } catch (error) {
      console.error('[TriggerForm] Failed to save trigger', error);
      toast({
        title: t('surveys.settings.triggerList.toasts.error', 'Unable to save trigger'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!trigger) {
      return;
    }

    const confirmed = window.confirm(
      t(
        'surveys.settings.triggerList.deleteConfirm',
        'Delete this trigger? Invitations already queued will still be sent.'
      )
    );

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteSurveyTrigger(trigger.triggerId);
      toast({
        title: t('surveys.settings.triggerList.toasts.deleted', 'Trigger deleted'),
      });
      onDeleteSuccess?.(trigger.triggerId);
    } catch (error) {
      console.error('[TriggerForm] Failed to delete trigger', error);
      toast({
        title: t('surveys.settings.triggerList.toasts.deleteError', 'Unable to delete trigger'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const title = trigger
    ? t('surveys.settings.triggerForm.titleEdit', 'Edit survey trigger')
    : t('surveys.settings.triggerForm.titleCreate', 'Create survey trigger');

  const submitLabel = trigger
    ? t('surveys.settings.triggerForm.actions.save', 'Save changes')
    : t('surveys.settings.triggerForm.actions.create', 'Create trigger');

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <h2 className="text-xl font-semibold" id={`${formInstanceId}-title`}>
        {title}
      </h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-template`}>
            {t('surveys.settings.triggerForm.labels.template', 'Survey template')}
          </label>
          <CustomSelect
            id={`${formInstanceId}-template`}
            options={templateOptions}
            value={formState.templateId ?? ''}
            onValueChange={(value) => handleChange('templateId', value)}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-trigger-type`}>
            {t('surveys.settings.triggerForm.labels.triggerType', 'Trigger type')}
          </label>
          <CustomSelect
            id={`${formInstanceId}-trigger-type`}
            options={triggerTypeOptions}
            value={formState.triggerType}
            onValueChange={(value) => handleChange('triggerType', value as TriggerType)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-boards`}>
            {t('surveys.settings.triggerForm.labels.boardIds', 'Board IDs')}
          </label>
          <TextArea
            id={`${formInstanceId}-boards`}
            value={formState.boardIds}
            onChange={(event) => handleChange('boardIds', event.target.value)}
            placeholder={t(
              'surveys.settings.triggerForm.placeholders.boardIds',
              'Enter board IDs separated by commas or new lines'
            )}
            className="min-h-[96px]"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-statuses`}>
            {t('surveys.settings.triggerForm.labels.statusIds', 'Status IDs')}
          </label>
          <TextArea
            id={`${formInstanceId}-statuses`}
            value={formState.statusIds}
            onChange={(event) => handleChange('statusIds', event.target.value)}
            placeholder={t(
              'surveys.settings.triggerForm.placeholders.statusIds',
              'Enter status IDs separated by commas or new lines'
            )}
            className="min-h-[96px]"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-priorities`}>
            {t('surveys.settings.triggerForm.labels.priorities', 'Priorities')}
          </label>
          <TextArea
            id={`${formInstanceId}-priorities`}
            value={formState.priorities}
            onChange={(event) => handleChange('priorities', event.target.value)}
            placeholder={t(
              'surveys.settings.triggerForm.placeholders.priorities',
              'Enter priority IDs or names separated by commas or new lines'
            )}
            className="min-h-[96px]"
          />
        </div>
      </div>

      <p className="text-xs text-gray-500">
        {t('surveys.settings.triggerForm.help.conditions', 'Leave a field blank to match any value.')}
      </p>

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <Switch
          id={`${formInstanceId}-enabled`}
          checked={formState.enabled}
          onCheckedChange={(checked) => handleChange('enabled', Boolean(checked))}
          label={t('surveys.settings.triggerForm.labels.enabled', 'Trigger enabled')}
        />

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          {trigger && (
            <Button
              id={`${formInstanceId}-delete`}
              type="button"
              variant="ghost"
              className="text-red-600 hover:text-red-700"
              onClick={handleDelete}
              disabled={isDeleting || isSubmitting}
            >
              {t('surveys.settings.triggerForm.actions.delete', 'Delete trigger')}
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Button
              id={`${formInstanceId}-cancel`}
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              {t('actions.cancel', 'Cancel')}
            </Button>
            <Button id={`${formInstanceId}-submit`} type="submit" disabled={isSubmitting}>
              {isSubmitting ? `${submitLabel}…` : submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

export default TriggerForm;
