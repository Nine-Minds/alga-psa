'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'server/src/lib/i18n/client';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { useToast } from 'server/src/hooks/use-toast';
import {
  createSurveyTemplate,
  deleteSurveyTemplate,
  updateSurveyTemplate,
} from 'server/src/lib/actions/surveyActions';
import type { SurveyTemplate } from 'server/src/lib/actions/surveyActions';
import {
  getDefaultRatingLabels,
  RatingButton,
  type RatingType,
} from 'server/src/components/surveys/shared/RatingDisplay';

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

/**
 * Parse textarea input into rating label mapping
 * Supports both formats:
 * 1. Simple format (one label per line): "Poor\nGood\nExcellent"
 * 2. Legacy format with "=" separator: "1 = Poor\n2 = Good\n3 = Excellent"
 */
function parseRatingLabels(input: string): Record<string, string> {
  const lines = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const labels: Record<string, string> = {};

  lines.forEach((line, index) => {
    // Check if line contains "=" separator (legacy format)
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
      // Simple format: just use line index + 1 as the rating value
      const rating = index + 1;
      labels[String(rating)] = line;
    }
  });

  return labels;
}

function formatRatingLabels(labels: Record<string, string>): string {
  // Sort by numeric key to ensure proper order
  return Object.entries(labels)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([_, label]) => label)
    .join('\n');
}

const ratingScaleOptions: SelectOption[] = [
  { value: '3', label: '3' },
  { value: '5', label: '5' },
  { value: '10', label: '10' },
];

export function TemplateForm({ template, onSuccess, onDeleteSuccess, onCancel }: TemplateFormProps) {
  const { t } = useTranslation('common');
  const { toast } = useToast();
  const formInstanceId = useId();

  const initialState: FormState = useMemo(
    () => ({
      templateName: template?.templateName ?? '',
      ratingType: template?.ratingType ?? 'stars',
      ratingScale: template?.ratingScale ?? 5,
      ratingLabelsText: formatRatingLabels(template?.ratingLabels ?? {}),
      promptText: template?.promptText ?? t('surveys.settings.templateForm.labels.promptText', 'Survey prompt'),
      commentPrompt:
        template?.commentPrompt ??
        t('surveys.settings.templateForm.labels.commentPrompt', 'Additional comments (optional)'),
      thankYouText: template?.thankYouText ?? t('surveys.settings.templateForm.labels.thankYouText', 'Thank you!'),
      isDefault: template?.isDefault ?? false,
      enabled: template?.enabled ?? true,
    }),
    [template, t]
  );

  const [formState, setFormState] = useState<FormState>(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const ratingTypeOptions: SelectOption[] = useMemo(
    () => [
      { value: 'stars', label: t('surveys.settings.templateForm.ratingTypes.stars', 'Stars') },
      { value: 'numbers', label: t('surveys.settings.templateForm.ratingTypes.numbers', 'Numbers') },
      { value: 'emojis', label: t('surveys.settings.templateForm.ratingTypes.emojis', 'Emojis') },
    ],
    [t]
  );

  const handleChange = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  // Auto-generate default labels when rating type or scale changes
  useEffect(() => {
    // Always regenerate labels when rating type or scale changes
    const defaultLabels = getDefaultRatingLabels(formState.ratingType, formState.ratingScale);
    setFormState((prev) => ({
      ...prev,
      ratingLabelsText: formatRatingLabels(defaultLabels),
    }));
  }, [formState.ratingType, formState.ratingScale]);

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
          title: t('surveys.settings.templateList.toasts.updated', 'Template updated'),
          description: payload.templateName,
        });
      } else {
        result = await createSurveyTemplate(payload);
        toast({
          title: t('surveys.settings.templateList.toasts.created', 'Template created'),
          description: payload.templateName,
        });
      }

      onSuccess(result);
    } catch (error) {
      console.error('[TemplateForm] Failed to save survey template', error);
      toast({
        title: t('surveys.settings.templateList.toasts.error', 'Unable to save template'),
        description: error instanceof Error ? error.message : '',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!template) {
      return;
    }

    const confirmed = window.confirm(
      t(
        'surveys.settings.templateList.deleteConfirm',
        'Delete this template? Invitations already sent will not be affected.'
      )
    );

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteSurveyTemplate(template.templateId);
      toast({
        title: t('surveys.settings.templateList.toasts.deleted', 'Template deleted'),
        description: template.templateName,
      });
      onDeleteSuccess?.(template.templateId);
    } catch (error) {
      console.error('[TemplateForm] Failed to delete survey template', error);
      toast({
        title: t('surveys.settings.templateList.toasts.deleteError', 'Unable to delete template'),
        description: error instanceof Error ? error.message : '',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const submitLabel = template
    ? t('surveys.settings.templateForm.actions.save', 'Save changes')
    : t('surveys.settings.templateForm.actions.create', 'Create template');

  const title = template
    ? t('surveys.settings.templateForm.titleEdit', 'Edit survey template')
    : t('surveys.settings.templateForm.titleCreate', 'Create survey template');

  const ratingScaleOptionsLocal = useMemo<SelectOption[]>(
    () =>
      ratingScaleOptions.map((option) => ({
        ...option,
        label: option.label,
      })),
    []
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-name`}>
            {t('surveys.settings.templateForm.labels.name', 'Template name')}
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
            {t('surveys.settings.templateForm.labels.ratingType', 'Rating type')}
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
            {t('surveys.settings.templateForm.labels.ratingScale', 'Rating scale')}
          </label>
          <CustomSelect
            id={`${formInstanceId}-rating-scale`}
            options={ratingScaleOptionsLocal}
            value={String(formState.ratingScale)}
            onValueChange={(value) => handleChange('ratingScale', Number(value))}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-rating-labels`}>
            {t('surveys.settings.templateForm.labels.ratingLabels', 'Rating labels')}
          </label>
          <TextArea
            id={`${formInstanceId}-rating-labels`}
            value={formState.ratingLabelsText}
            onChange={(event) => handleChange('ratingLabelsText', event.target.value)}
            className="h-32"
            placeholder={t(
              'surveys.settings.templateForm.placeholders.ratingLabels',
              'Example:\nVery Poor\nPoor\nAverage\nGood\nExcellent'
            )}
          />
          <p className="text-xs text-gray-500">
            {t(
              'surveys.settings.templateForm.help.ratingLabels',
              'Provide one label per line, in order from lowest to highest rating.'
            )}
          </p>
        </div>

        {/* Rating Preview */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 md:col-span-2">
          <h3 className="mb-3 text-sm font-medium text-gray-700">
            {t('surveys.settings.templateForm.labels.preview', 'Preview')}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {Array.from({ length: formState.ratingScale }, (_, index) => {
              const rating = index + 1;
              const labels = parseRatingLabels(formState.ratingLabelsText);
              const label = labels[String(rating)];
              return (
                <RatingButton
                  key={rating}
                  rating={rating}
                  type={formState.ratingType}
                  scale={formState.ratingScale}
                  label={label}
                  selected={false}
                  disabled
                  onClick={() => {}}
                  className="cursor-default opacity-100"
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-prompt`}>
            {t('surveys.settings.templateForm.labels.promptText', 'Survey prompt')}
          </label>
          <TextArea
            id={`${formInstanceId}-prompt`}
            value={formState.promptText}
            onChange={(event) => handleChange('promptText', event.target.value)}
            className="min-h-[96px]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-comment`}>
            {t('surveys.settings.templateForm.labels.commentPrompt', 'Comment prompt')}
          </label>
          <TextArea
            id={`${formInstanceId}-comment`}
            value={formState.commentPrompt}
            onChange={(event) => handleChange('commentPrompt', event.target.value)}
            className="min-h-[96px]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-thank-you`}>
            {t('surveys.settings.templateForm.labels.thankYouText', 'Thank-you message')}
          </label>
          <TextArea
            id={`${formInstanceId}-thank-you`}
            value={formState.thankYouText}
            onChange={(event) => handleChange('thankYouText', event.target.value)}
            className="min-h-[96px]"
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-3">
          <Switch
            id={`${formInstanceId}-default`}
            checked={formState.isDefault}
            onCheckedChange={(checked) => handleChange('isDefault', Boolean(checked))}
            label={t('surveys.settings.templateForm.labels.isDefault', 'Set as default template')}
          />
          <Switch
            id={`${formInstanceId}-enabled`}
            checked={formState.enabled}
            onCheckedChange={(checked) => handleChange('enabled', Boolean(checked))}
            label={t('surveys.settings.templateForm.labels.enabled', 'Template enabled')}
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
              {isDeleting
                ? t('surveys.settings.templateForm.actions.delete', 'Delete template')
                : t('surveys.settings.templateForm.actions.delete', 'Delete template')}
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

export default TemplateForm;
