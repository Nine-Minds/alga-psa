'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useToast } from '@alga-psa/ui';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { X } from 'lucide-react';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import { PrioritySelect } from '@alga-psa/ui/components';
import type { SurveyTemplate, SurveyTrigger } from '@alga-psa/surveys/actions/surveyActions';
import {
  createSurveyTrigger,
  updateSurveyTrigger,
  deleteSurveyTrigger,
} from '@alga-psa/surveys/actions/surveyActions';
import type { IBoard, IPriority, IStatus } from '@alga-psa/types';
import { useTriggerReferenceData } from '../hooks/useTriggerReferenceData';

import type { SurveyTriggerConditions } from '@alga-psa/surveys/actions/surveyActions';

type TriggerType = 'ticket_closed' | 'project_completed';

type TriggerBoardFilterState = 'active' | 'inactive' | 'all';

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
  enabled: boolean;
}

const TRIGGER_TYPE_OPTIONS: TriggerType[] = ['ticket_closed', 'project_completed'];

const TRIGGER_TYPE_FALLBACK_LABELS: Record<TriggerType, string> = {
  ticket_closed: 'Ticket closed',
  project_completed: 'Project completed',
};

interface SelectionChipsProps {
  items: string[];
  getLabel: (id: string) => string;
  onRemove: (id: string) => void;
  removeLabel: string;
  emptyLabel: string;
}

const SelectionChips = ({ items, getLabel, onRemove, removeLabel, emptyLabel }: SelectionChipsProps) => {
  if (items.length === 0) {
    return <span className="text-xs text-gray-500">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((id) => {
        const label = getLabel(id);
        return (
          <Badge key={id} variant="secondary" className="flex items-center gap-1">
            <span>{label}</span>
            <button
              type="button"
              onClick={() => onRemove(id)}
              aria-label={`${removeLabel} ${label}`}
              className="rounded focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        );
      })}
    </div>
  );
};

export function TriggerForm({ templates, trigger, onSuccess, onDeleteSuccess, onCancel }: TriggerFormProps) {
  const { t } = useTranslation('msp/surveys');
  const { t: tCommon } = useTranslation('common');
  const { toast } = useToast();
  const formInstanceId = useId();

  const templateOptions = useMemo<SelectOption[]>(
    () =>
      templates.map((template) => ({
        value: template.templateId,
        label: template.isDefault
          ? `${template.templateName} (${t('settings.templateList.defaultBadge', {
              defaultValue: 'Default',
            })})`
          : template.templateName,
      })),
    [t, templates]
  );

  const templateMissing = templateOptions.length === 0;

  const {
    data: referenceData,
    error: referenceDataError,
    loading: isReferenceLoading,
    reload: reloadReferenceData,
  } = useTriggerReferenceData();

  const boards = useMemo(() => referenceData?.boards ?? [], [referenceData?.boards]);
  const ticketStatuses = useMemo(
    () => referenceData?.ticketStatuses ?? [],
    [referenceData?.ticketStatuses]
  );
  const projectStatuses = useMemo(
    () => referenceData?.projectStatuses ?? [],
    [referenceData?.projectStatuses]
  );
  const priorities = useMemo(
    () => referenceData?.priorities ?? [],
    [referenceData?.priorities]
  );

  const [formState, setFormState] = useState<FormState>({
    templateId: trigger?.templateId ?? (templateOptions[0]?.value ?? null),
    triggerType: trigger?.triggerType ?? 'ticket_closed',
    enabled: trigger?.enabled ?? true,
  });
  const [selectedBoardIds, setSelectedBoardIds] = useState<string[]>(
    (trigger?.triggerType === 'ticket_closed' && 'board_id' in trigger.triggerConditions ? trigger.triggerConditions.board_id : undefined) ?? []
  );
  const [selectedStatusIds, setSelectedStatusIds] = useState<string[]>(
    trigger?.triggerConditions.status_id ?? []
  );
  const [selectedPriorityIds, setSelectedPriorityIds] = useState<string[]>(
    (trigger?.triggerType === 'ticket_closed' && 'priority' in trigger.triggerConditions ? trigger.triggerConditions.priority : undefined) ?? []
  );
  const [boardFilterState, setBoardFilterState] = useState<TriggerBoardFilterState>('active');
  const [boardPickerValue, setBoardPickerValue] = useState<string | null>(null);
  const [statusSelectValue, setStatusSelectValue] = useState<string | null>(null);
  const [prioritySelectValue, setPrioritySelectValue] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setFormState({
      templateId: trigger?.templateId ?? (templateOptions[0]?.value ?? null),
      triggerType: trigger?.triggerType ?? 'ticket_closed',
      enabled: trigger?.enabled ?? true,
    });
    setSelectedBoardIds((trigger?.triggerType === 'ticket_closed' && 'board_id' in trigger.triggerConditions ? trigger.triggerConditions.board_id : undefined) ?? []);
    setSelectedStatusIds(trigger?.triggerConditions.status_id ?? []);
    setSelectedPriorityIds((trigger?.triggerType === 'ticket_closed' && 'priority' in trigger.triggerConditions ? trigger.triggerConditions.priority : undefined) ?? []);
    const boardId = trigger?.triggerType === 'ticket_closed' && 'board_id' in trigger.triggerConditions ? trigger.triggerConditions.board_id?.[0] : undefined;
    setBoardPickerValue(boardId ?? null);
  }, [trigger, templateOptions]);

  useEffect(() => {
    if (selectedBoardIds.length === 0) {
      setBoardPickerValue(null);
      return;
    }

    setBoardPickerValue((prev) => {
      if (prev && selectedBoardIds.includes(prev)) {
        return prev;
      }
      return selectedBoardIds[selectedBoardIds.length - 1] ?? null;
    });
  }, [selectedBoardIds]);

  useEffect(() => {
    if (formState.triggerType === 'project_completed') {
      setSelectedBoardIds([]);
      setBoardPickerValue(null);
      setSelectedPriorityIds([]);
      setPrioritySelectValue(null);
    }
  }, [formState.triggerType]);

  useEffect(() => {
    const source =
      formState.triggerType === 'project_completed' ? projectStatuses : ticketStatuses;
    if (source.length === 0) {
      return;
    }
    const allowed = new Set(
      source
        .map((status) => status.status_id)
        .filter((statusId): statusId is string => Boolean(statusId))
    );
    setSelectedStatusIds((prev) => prev.filter((statusId) => allowed.has(statusId)));
  }, [formState.triggerType, projectStatuses, ticketStatuses]);

  const boardMap = useMemo(() => {
    const map = new Map<string, IBoard>();
    boards.forEach((board) => {
      if (board.board_id) {
        map.set(board.board_id, board);
      }
    });
    return map;
  }, [boards]);

  const statusMap = useMemo(() => {
    const map = new Map<string, IStatus>();
    ticketStatuses.forEach((status) => {
      if (status.status_id) {
        map.set(status.status_id, status);
      }
    });
    projectStatuses.forEach((status) => {
      if (status.status_id) {
        map.set(status.status_id, status);
      }
    });
    return map;
  }, [projectStatuses, ticketStatuses]);

  const priorityMap = useMemo(() => {
    const map = new Map<string, IPriority>();
    priorities.forEach((priority) => {
      if (priority.priority_id) {
        map.set(priority.priority_id, priority);
      }
    });
    return map;
  }, [priorities]);

  const statusOptions = useMemo<SelectOption[]>(() => {
    const source =
      formState.triggerType === 'project_completed' ? projectStatuses : ticketStatuses;
    return source
      .filter((status): status is IStatus & { status_id: string } => Boolean(status.status_id))
      .map((status) => ({
        value: status.status_id,
        label: status.name,
      }));
  }, [formState.triggerType, projectStatuses, ticketStatuses]);

  interface PriorityOption {
    value: string;
    label: string;
    color?: string;
    is_from_itil_standard?: boolean;
    itil_priority_level?: number;
  }

  const priorityOptions = useMemo<PriorityOption[]>(
    () =>
      priorities
        .filter((priority): priority is IPriority & { priority_id: string } => Boolean(priority.priority_id))
        .map((priority) => ({
          value: priority.priority_id,
          label: priority.priority_name,
          color: priority.color,
          is_from_itil_standard: priority.is_from_itil_standard,
          itil_priority_level: priority.itil_priority_level,
        })),
    [priorities]
  );

  const selectedPriorityType = useMemo<'custom' | 'itil' | 'mixed' | null>(() => {
    if (formState.triggerType !== 'ticket_closed' || selectedBoardIds.length === 0) {
      return null;
    }

    const types = new Set<string>();
    selectedBoardIds.forEach((boardId) => {
      const board = boardMap.get(boardId);
      if (board?.priority_type) {
        types.add(board.priority_type);
      }
    });

    if (types.size === 0) {
      return null;
    }
    if (types.size === 1) {
      return types.values().next().value as 'custom' | 'itil';
    }
    return 'mixed';
  }, [boardMap, formState.triggerType, selectedBoardIds]);

  const filteredPriorityOptions = useMemo<PriorityOption[]>(() => {
    if (formState.triggerType !== 'ticket_closed') {
      return [];
    }
    if (selectedPriorityType === 'itil') {
      return priorityOptions.filter((option) => option.is_from_itil_standard);
    }
    if (selectedPriorityType === 'custom') {
      return priorityOptions.filter((option) => !option.is_from_itil_standard);
    }
    return priorityOptions;
  }, [formState.triggerType, priorityOptions, selectedPriorityType]);

  const removeLabel = tCommon('actions.remove', { defaultValue: 'Remove' });
  const anyLabel = t('settings.triggerList.conditions.any', { defaultValue: 'Any' });
  const loadingText = t('common.loading', { defaultValue: 'Loading...' });
  const fieldHelpText = t('settings.triggerForm.help.conditions', {
    defaultValue: 'Leave a field blank to match any value.',
  });
  const referenceErrorFallback = t('settings.triggerForm.errors.reference', {
    defaultValue: 'Unable to load trigger options. Please try again.',
  });
  const noTemplatesMessage = t('settings.triggerForm.noTemplates', {
    defaultValue: 'Create a survey template before adding triggers.',
  });
  const mixedPriorityNotice = t('settings.triggerForm.prioritiesMixed', {
    defaultValue: 'Selected boards use different priority types. Showing all priorities.',
  });

  const referenceErrorMessage = referenceDataError
    ? referenceDataError.message || referenceErrorFallback
    : null;

  const handleChange = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const handleBoardSelect = (boardId: string) => {
    if (formState.triggerType !== 'ticket_closed' || !boardId) {
      return;
    }
    setSelectedBoardIds((prev) => (prev.includes(boardId) ? prev : [...prev, boardId]));
    setBoardPickerValue(boardId);
  };

  const handleRemoveBoard = (boardId: string) => {
    setSelectedBoardIds((prev) => prev.filter((value) => value !== boardId));
  };

  const handleStatusSelect = (statusId: string) => {
    if (!statusId || statusId === 'placeholder') {
      return;
    }
    setSelectedStatusIds((prev) => (prev.includes(statusId) ? prev : [...prev, statusId]));
    setStatusSelectValue(null);
  };

  const handleRemoveStatus = (statusId: string) => {
    setSelectedStatusIds((prev) => prev.filter((value) => value !== statusId));
  };

  const handlePrioritySelect = (priorityId: string) => {
    if (formState.triggerType !== 'ticket_closed' || !priorityId || priorityId === 'placeholder') {
      return;
    }
    setSelectedPriorityIds((prev) => (prev.includes(priorityId) ? prev : [...prev, priorityId]));
    setPrioritySelectValue(null);
  };

  const handleRemovePriority = (priorityId: string) => {
    setSelectedPriorityIds((prev) => prev.filter((value) => value !== priorityId));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!formState.templateId) {
      toast({
        title: tCommon('errors.required', { defaultValue: 'This field is required' }),
        description: t('settings.triggerForm.labels.template', {
          defaultValue: 'Survey template',
        }),
        variant: 'destructive',
      });
      return;
    }

    const triggerConditions: SurveyTriggerConditions = {};
    if (formState.triggerType === 'ticket_closed' && selectedBoardIds.length > 0) {
      (triggerConditions as { board_id?: string[] }).board_id = selectedBoardIds;
    }
    if (selectedStatusIds.length > 0) {
      triggerConditions.status_id = selectedStatusIds;
    }
    if (formState.triggerType === 'ticket_closed' && selectedPriorityIds.length > 0) {
      (triggerConditions as { priority?: string[] }).priority = selectedPriorityIds;
    }

    const payloadConditions = Object.values(triggerConditions).some(
      (value) => Array.isArray(value) && value.length > 0
    )
      ? triggerConditions
      : {};
    const selectedTemplateName = templates.find((item) => item.templateId === formState.templateId)?.templateName;
    const templateDescription = typeof selectedTemplateName === 'string' ? selectedTemplateName : '';

    setIsSubmitting(true);
    try {
      let result: SurveyTrigger;

      if (trigger) {
        result = await updateSurveyTrigger(trigger.triggerId, {
          templateId: formState.templateId,
          triggerType: formState.triggerType,
          triggerConditions: payloadConditions,
          enabled: formState.enabled,
        });
        toast({
          title: t('settings.triggerList.toasts.updated', {
            defaultValue: 'Trigger updated',
          }),
          description: templateDescription,
        });
      } else {
        result = await createSurveyTrigger({
          templateId: formState.templateId,
          triggerType: formState.triggerType,
          triggerConditions: payloadConditions,
          enabled: formState.enabled,
        });
        toast({
          title: t('settings.triggerList.toasts.created', {
            defaultValue: 'Trigger created',
          }),
          description: templateDescription,
        });
      }

      onSuccess(result);
    } catch (error) {
      console.error('[TriggerForm] Failed to save trigger', error);
      toast({
        title: t('settings.triggerList.toasts.error', {
          defaultValue: 'Unable to save trigger',
        }),
        description: error instanceof Error ? error.message : '',
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
      t('settings.triggerList.deleteConfirm', {
        defaultValue: 'Delete this trigger? Invitations already queued will still be sent.',
      })
    );

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteSurveyTrigger(trigger.triggerId);
      toast({
        title: t('settings.triggerList.toasts.deleted', {
          defaultValue: 'Trigger deleted',
        }),
        description: '',
      });
      onDeleteSuccess?.(trigger.triggerId);
    } catch (error) {
      console.error('[TriggerForm] Failed to delete trigger', error);
      toast({
        title: t('settings.triggerList.toasts.deleteError', {
          defaultValue: 'Unable to delete trigger',
        }),
        description: error instanceof Error ? error.message : '',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const getBoardLabel = (boardId: string) => boardMap.get(boardId)?.board_name ?? boardId;
  const getStatusLabel = (statusId: string) => statusMap.get(statusId)?.name ?? statusId;
  const getPriorityLabel = (priorityId: string) => priorityMap.get(priorityId)?.priority_name ?? priorityId;

  if (isReferenceLoading && !referenceData) {
    return (
      <div className="flex justify-center py-12">
        <LoadingIndicator layout="stacked" text={loadingText} />
      </div>
    );
  }

  const isSubmitDisabled =
    isSubmitting || templateMissing || !formState.templateId || (!referenceData && !referenceDataError);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {referenceErrorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{referenceErrorMessage}</AlertDescription>
          <div className="mt-3 flex justify-end">
            <Button
              id="reload-reference-data"
              type="button"
              variant="outline"
              onClick={reloadReferenceData}
              disabled={isReferenceLoading}
            >
              {tCommon('actions.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>
        </Alert>
      )}

      {templateMissing && (
        <Alert variant="destructive">
          <AlertDescription>{noTemplatesMessage}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CustomSelect
          id={`${formInstanceId}-template`}
          options={templateOptions}
          value={formState.templateId}
          onValueChange={(value) => handleChange('templateId', value || null)}
          placeholder={t('settings.triggerForm.labels.template', {
            defaultValue: 'Survey template',
          })}
          disabled={templateOptions.length === 0}
          label={t('settings.triggerForm.labels.template', {
            defaultValue: 'Survey template',
          })}
        />

        <CustomSelect
          id={`${formInstanceId}-trigger-type`}
          options={TRIGGER_TYPE_OPTIONS.map((type) => ({
            value: type,
            label: t(`settings.triggerForm.triggerTypes.${type}`, {
              defaultValue: TRIGGER_TYPE_FALLBACK_LABELS[type],
            }),
          }))}
          value={formState.triggerType}
          onValueChange={(value) => handleChange('triggerType', (value as TriggerType) || 'ticket_closed')}
          placeholder={t('settings.triggerForm.labels.triggerType', {
            defaultValue: 'Trigger type',
          })}
          label={t('settings.triggerForm.labels.triggerType', {
            defaultValue: 'Trigger type',
          })}
        />
      </div>

      <div className="space-y-6">
        {formState.triggerType === 'ticket_closed' && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-board-picker`}>
              {t('settings.triggerForm.labels.boardIds', { defaultValue: 'Boards' })}
            </label>
            <BoardPicker
              id={`${formInstanceId}-board-picker`}
              boards={boards}
              selectedBoardId={boardPickerValue}
              onSelect={handleBoardSelect}
              filterState={boardFilterState}
              onFilterStateChange={setBoardFilterState}
              placeholder={t('settings.triggerForm.placeholders.boardIds', {
                defaultValue: 'Select board',
              })}
            />
            <SelectionChips
              items={selectedBoardIds}
              getLabel={getBoardLabel}
              onRemove={handleRemoveBoard}
              removeLabel={removeLabel}
              emptyLabel={anyLabel}
            />
            <p className="text-xs text-gray-500">{fieldHelpText}</p>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-status`}>
            {t('settings.triggerForm.labels.statusIds', { defaultValue: 'Statuses' })}
          </label>
          <CustomSelect
            id={`${formInstanceId}-status`}
            options={statusOptions}
            value={statusSelectValue}
            onValueChange={handleStatusSelect}
            placeholder={t('settings.triggerForm.placeholders.statusIds', {
              defaultValue: 'Add status',
            })}
            allowClear
          />
          <SelectionChips
            items={selectedStatusIds}
            getLabel={getStatusLabel}
            onRemove={handleRemoveStatus}
            removeLabel={removeLabel}
            emptyLabel={anyLabel}
          />
          <p className="text-xs text-gray-500">{fieldHelpText}</p>
        </div>

        {formState.triggerType === 'ticket_closed' && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-priority`}>
              {t('settings.triggerForm.labels.priorities', { defaultValue: 'Priorities' })}
            </label>
            <PrioritySelect
              id={`${formInstanceId}-priority`}
              value={prioritySelectValue}
              onValueChange={handlePrioritySelect}
              options={filteredPriorityOptions}
              placeholder={t('settings.triggerForm.placeholders.priorities', {
                defaultValue: 'Add priority',
              })}
              isItilBoard={selectedPriorityType === 'itil'}
            />
            {selectedPriorityType === 'mixed' && (
              <p className="text-xs text-gray-500">{mixedPriorityNotice}</p>
            )}
            <SelectionChips
              items={selectedPriorityIds}
              getLabel={getPriorityLabel}
              onRemove={handleRemovePriority}
              removeLabel={removeLabel}
              emptyLabel={anyLabel}
            />
            <p className="text-xs text-gray-500">{fieldHelpText}</p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <Switch
          id={`${formInstanceId}-enabled`}
          checked={formState.enabled}
          onCheckedChange={(checked) => handleChange('enabled', Boolean(checked))}
          label={t('settings.triggerForm.labels.enabled', {
            defaultValue: 'Trigger enabled',
          })}
        />

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          {trigger && (
            <Button
              id={`${formInstanceId}-delete`}
              type="button"
              variant="accent"
              onClick={handleDelete}
              disabled={isDeleting || isSubmitting}
            >
              {t('settings.triggerForm.actions.delete', { defaultValue: 'Delete trigger' })}
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
            <Button
              id={`${formInstanceId}-submit`}
              type="submit"
              disabled={isSubmitDisabled}
            >
              {isSubmitting
                ? tCommon('actions.saving', { defaultValue: 'Saving...' })
                : trigger
                ? t('settings.triggerForm.actions.save', { defaultValue: 'Save changes' })
                : t('settings.triggerForm.actions.create', { defaultValue: 'Create trigger' })}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
