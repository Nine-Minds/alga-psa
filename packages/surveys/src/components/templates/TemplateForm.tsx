'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { DeleteEntityDialog, useToast } from '@alga-psa/ui';
import {
  createSurveyTemplate,
  deleteSurveyTemplate,
  updateSurveyTemplate,
} from '@alga-psa/surveys/actions/surveyActions';
import type { SurveyTemplate } from '@alga-psa/surveys/actions/surveyActions';
import type { DeletionValidationResult } from '@alga-psa/types';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import {
  getDefaultRatingLabels,
  type RatingType,
} from '../shared/RatingDisplay';
import SurveyPreviewPanel from './SurveyPreviewPanel';

interface TemplateFormProps {
  template?: SurveyTemplate;
  onSuccess: (template: SurveyTemplate) => void;
  onDeleteSuccess?: (templateId: string) => void;
  onCancel: () => void;
}

interface FormState {
  templateName: string;
  ratingType: RatingType;
  ratingScale: number;
  ratingLabelsText: string;
  promptText: string;
  commentPrompt: string;
  thankYouText: string;
  isDefault: boolean;
  enabled: boolean;
}

function parseRatingLabels(input: string): Record<string, string> {
  const lines = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const labels: Record<string, string> = {};

  lines.forEach((line, index) => {
    if (line.includes('=')) {
      const [rawValue, ...rawLabel] = line.split('=');
      if (!rawValue || rawLabel.length === 0) {
        return;
      }

      const value = rawValue.trim();
      const label = rawLabel.join('=').trim();
      if (!value || !label) {
        return;
      }

      labels[value] = label;
    } else {
      labels[String(index + 1)] = line;
    }
  });

  return labels;
}

function formatRatingLabels(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, label]) => label)
    .join('\n');
}

const ratingScaleOptions: SelectOption[] = [
  { value: '3', label: '3' },
  { value: '5', label: '5' },
  { value: '10', label: '10' },
];

export function TemplateForm({ template, onSuccess, onDeleteSuccess, onCancel }: TemplateFormProps) {
  const { t } = useTranslation('msp/surveys');
  const { t: tCommon } = useTranslation('common');
  const { toast } = useToast();
  const formInstanceId = useId();

  const initialState: FormState = useMemo(
    () => ({
      templateName: template?.templateName ?? '',
      ratingType: template?.ratingType ?? 'stars',
      ratingScale: template?.ratingScale ?? 5,
      ratingLabelsText: formatRatingLabels(template?.ratingLabels ?? {}),
      promptText:
        template?.promptText ??
        t('settings.templateForm.defaults.promptText', {
          defaultValue: 'Survey prompt',
        }),
      commentPrompt:
        template?.commentPrompt ??
        t('settings.templateForm.defaults.commentPrompt', {
          defaultValue: 'Additional comments (optional)',
        }),
      thankYouText:
        template?.thankYouText ??
        t('settings.templateForm.defaults.thankYouText', {
          defaultValue: 'Thank you!',
        }),
      isDefault: template?.isDefault ?? false,
      enabled: template?.enabled ?? true,
    }),
    [template, t]
  );

  const [formState, setFormState] = useState<FormState>(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);

  const ratingTypeOptions: SelectOption[] = useMemo(
    () => [
      { value: 'stars', label: t('settings.templateForm.ratingTypes.stars', { defaultValue: 'Stars' }) },
      { value: 'numbers', label: t('settings.templateForm.ratingTypes.numbers', { defaultValue: 'Numbers' }) },
      { value: 'emojis', label: t('settings.templateForm.ratingTypes.emojis', { defaultValue: 'Emojis' }) },
    ],
    [t]
  );

  const handleChange = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    const defaultLabels = getDefaultRatingLabels(formState.ratingType, formState.ratingScale, t);
    setFormState((prev) => ({
      ...prev,
      ratingLabelsText: formatRatingLabels(defaultLabels),
    }));
  }, [formState.ratingType, formState.ratingScale, t]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const payload = {
        templateName: formState.templateName.trim(),
        ratingType: formState.ratingType,
        ratingScale: formState.ratingScale as 3 | 5 | 10,
        ratingLabels: parseRatingLabels(formState.ratingLabelsText),
        promptText: formState.promptText.trim(),
        commentPrompt: formState.commentPrompt.trim(),
        thankYouText: formState.thankYouText.trim(),
        isDefault: formState.isDefault,
        enabled: formState.enabled,
      };

      let result: SurveyTemplate;
      if (template) {
        result = await updateSurveyTemplate(template.templateId, payload);
        toast({
          title: t('settings.templateList.toasts.updated', { defaultValue: 'Template updated' }),
          description: payload.templateName,
        });
      } else {
        result = await createSurveyTemplate(payload);
        toast({
          title: t('settings.templateList.toasts.created', { defaultValue: 'Template created' }),
          description: payload.templateName,
        });
      }

      onSuccess(result);
    } catch (error) {
      console.error('[TemplateForm] Failed to save survey template', error);
      toast({
        title: t('settings.templateList.toasts.error', { defaultValue: 'Unable to save template' }),
        description: error instanceof Error ? error.message : '',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!isDeleteDialogOpen || !template) {
      return;
    }

    const runValidation = async () => {
      setIsDeleteValidating(true);
      try {
        const result = await preCheckDeletion('survey_template', template.templateId);
        setDeleteValidation(result);
      } catch (error) {
        console.error('[TemplateForm] Failed to validate survey template deletion', error);
        setDeleteValidation({
          canDelete: false,
          code: 'VALIDATION_FAILED',
          message: t('settings.templateForm.delete.validationFailed', {
            defaultValue: 'Failed to validate deletion. Please try again.',
          }),
          dependencies: [],
          alternatives: [],
        });
      } finally {
        setIsDeleteValidating(false);
      }
    };

    void runValidation();
  }, [isDeleteDialogOpen, t, template]);

  const resetDeleteState = () => {
    setIsDeleteDialogOpen(false);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
  };

  const handleDelete = () => {
    if (!template) {
      return;
    }
    setDeleteValidation(null);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!template) {
      return;
    }

    setIsDeleting(true);
    try {
      const result = await deleteSurveyTemplate(template.templateId);
      if (result.success) {
        toast({
          title: t('settings.templateList.toasts.deleted', { defaultValue: 'Template deleted' }),
          description: template.templateName,
        });
        onDeleteSuccess?.(template.templateId);
        resetDeleteState();
        return;
      }

      setDeleteValidation(result);
    } catch (error) {
      console.error('[TemplateForm] Failed to delete survey template', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message:
          error instanceof Error
            ? error.message
            : t('settings.templateForm.delete.error', {
                defaultValue: 'Unable to delete template',
              }),
        dependencies: [],
        alternatives: [],
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const submitLabel = template
    ? t('settings.templateForm.actions.save', { defaultValue: 'Save changes' })
    : t('settings.templateForm.actions.create', { defaultValue: 'Create template' });

  const parsedRatingLabels = useMemo(
    () => parseRatingLabels(formState.ratingLabelsText),
    [formState.ratingLabelsText]
  );

  const ratingScaleOptionsLocal = useMemo<SelectOption[]>(
    () =>
      ratingScaleOptions.map((option) => ({
        ...option,
        label: option.label,
      })),
    []
  );

  return (
    <>
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Left column: Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-name`}>
              {t('settings.templateForm.labels.name', { defaultValue: 'Template name' })}
            </label>
            <Input
              id={`${formInstanceId}-name`}
              value={formState.templateName}
              onChange={(event) => handleChange('templateName', event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-rating-type`}>
              {t('settings.templateForm.labels.ratingType', { defaultValue: 'Rating type' })}
            </label>
            <CustomSelect
              id={`${formInstanceId}-rating-type`}
              options={ratingTypeOptions}
              value={formState.ratingType}
              onValueChange={(value) => handleChange('ratingType', value as RatingType)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-rating-scale`}>
              {t('settings.templateForm.labels.ratingScale', { defaultValue: 'Rating scale' })}
            </label>
            <CustomSelect
              id={`${formInstanceId}-rating-scale`}
              options={ratingScaleOptionsLocal}
              value={String(formState.ratingScale)}
              onValueChange={(value) => handleChange('ratingScale', Number(value))}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-rating-labels`}>
              {t('settings.templateForm.labels.ratingLabels', { defaultValue: 'Rating labels' })}
            </label>
            <TextArea
              id={`${formInstanceId}-rating-labels`}
              value={formState.ratingLabelsText}
              onChange={(event) => handleChange('ratingLabelsText', event.target.value)}
              className="h-32"
              placeholder={t('settings.templateForm.placeholders.ratingLabels', {
                defaultValue: 'Example:\nVery Poor\nPoor\nAverage\nGood\nExcellent',
              })}
            />
            <p className="text-xs text-gray-500">
              {t('settings.templateForm.help.ratingLabels', {
                defaultValue: 'Provide one label per line, in order from lowest to highest rating.',
              })}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-prompt`}>
              {t('settings.templateForm.labels.promptText', { defaultValue: 'Survey prompt' })}
            </label>
            <TextArea
              id={`${formInstanceId}-prompt`}
              value={formState.promptText}
              onChange={(event) => handleChange('promptText', event.target.value)}
              className="min-h-[80px]"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-comment`}>
              {t('settings.templateForm.labels.commentPrompt', { defaultValue: 'Comment prompt' })}
            </label>
            <TextArea
              id={`${formInstanceId}-comment`}
              value={formState.commentPrompt}
              onChange={(event) => handleChange('commentPrompt', event.target.value)}
              className="min-h-[80px]"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-thank-you`}>
              {t('settings.templateForm.labels.thankYouText', { defaultValue: 'Thank-you message' })}
            </label>
            <TextArea
              id={`${formInstanceId}-thank-you`}
              value={formState.thankYouText}
              onChange={(event) => handleChange('thankYouText', event.target.value)}
              className="min-h-[80px]"
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3">
            <Switch
              id={`${formInstanceId}-default`}
              checked={formState.isDefault}
              onCheckedChange={(checked) => handleChange('isDefault', Boolean(checked))}
              label={t('settings.templateForm.labels.isDefault', {
                defaultValue: 'Set as default template',
              })}
            />
            <Switch
              id={`${formInstanceId}-enabled`}
              checked={formState.enabled}
              onCheckedChange={(checked) => handleChange('enabled', Boolean(checked))}
              label={t('settings.templateForm.labels.enabled', {
                defaultValue: 'Template enabled',
              })}
            />
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            {template && (
              <Button
                id={`${formInstanceId}-delete`}
                type="button"
                variant="accent"
                onClick={handleDelete}
                disabled={isDeleting || isSubmitting}
              >
                {t('settings.templateForm.actions.delete', { defaultValue: 'Delete template' })}
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
                {tCommon('actions.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button id={`${formInstanceId}-submit`} type="submit" disabled={isSubmitting}>
                {isSubmitting ? `${submitLabel}...` : submitLabel}
              </Button>
            </div>
          </div>
        </div>
      </form>

      {/* Right column: Live preview */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <SurveyPreviewPanel
          ratingType={formState.ratingType}
          ratingScale={formState.ratingScale}
          ratingLabels={parsedRatingLabels}
          promptText={formState.promptText}
          commentPrompt={formState.commentPrompt}
          thankYouText={formState.thankYouText}
        />
      </div>
    </div>

    <DeleteEntityDialog
      id={template ? `delete-survey-template-${template.templateId}` : 'delete-survey-template-dialog'}
      isOpen={isDeleteDialogOpen}
      onClose={resetDeleteState}
      onConfirmDelete={handleDeleteConfirm}
      entityName={
        template?.templateName ||
        t('settings.templateForm.delete.entityFallback', {
          defaultValue: 'this survey template',
        })
      }
      validationResult={deleteValidation}
      isValidating={isDeleteValidating}
      isDeleting={isDeleting}
    />
    </>
  );
}

export default TemplateForm;
