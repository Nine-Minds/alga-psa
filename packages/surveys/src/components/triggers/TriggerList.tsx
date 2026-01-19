'use client';

import { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { SurveyTemplate, SurveyTrigger } from '@alga-psa/surveys/actions/surveyActions';
import {
  updateSurveyTrigger,
  deleteSurveyTrigger,
} from '@alga-psa/surveys/actions/surveyActions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useToast } from '@alga-psa/ui';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { TriggerForm } from './TriggerForm';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { MoreVertical, PlusIcon, RefreshCw } from 'lucide-react';
import { useTriggerReferenceData } from '../hooks/useTriggerReferenceData';

interface TriggerListProps {
  templates: SurveyTemplate[];
  triggers: SurveyTrigger[];
  isLoading: boolean;
  onTriggersChange: React.Dispatch<React.SetStateAction<SurveyTrigger[]>>;
  onRefresh: () => Promise<void>;
}

export function TriggerList({ templates, triggers, isLoading, onTriggersChange, onRefresh }: TriggerListProps) {
  const { t } = useTranslation('common');
  const { toast } = useToast();
  const { data: referenceData } = useTriggerReferenceData();

  const triggerTypeFallbackLabels: Record<SurveyTrigger['triggerType'], string> = useMemo(
    () => ({
      ticket_closed: 'Ticket closed',
      project_completed: 'Project completed',
    }),
    []
  );

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<SurveyTrigger | null>(null);
  const [isToggling, setIsToggling] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const templateLookup = useMemo(
    () =>
      templates.reduce<Record<string, SurveyTemplate>>((acc, template) => {
        acc[template.templateId] = template;
        return acc;
      }, {}),
    [templates]
  );

  const sortedTriggers = useMemo(
    () =>
      [...triggers].sort((a, b) => {
        const dateB = b.updatedAt?.getTime?.() ?? new Date(b.updatedAt).getTime();
        const dateA = a.updatedAt?.getTime?.() ?? new Date(a.updatedAt).getTime();
        return dateB - dateA;
      }),
    [triggers]
  );

  const handleOpenCreate = () => {
    setEditingTrigger(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (trigger: SurveyTrigger) => {
    setEditingTrigger(trigger);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingTrigger(null);
  };

  const handleFormSuccess = (trigger: SurveyTrigger) => {
    onTriggersChange((prev) => {
      const exists = prev.some((item) => item.triggerId === trigger.triggerId);
      if (exists) {
        return prev.map((item) => (item.triggerId === trigger.triggerId ? trigger : item));
      }
      return [trigger, ...prev];
    });
    closeDialog();
  };

  const handleDeleteSuccess = (triggerId: string) => {
    onTriggersChange((prev) => prev.filter((item) => item.triggerId !== triggerId));
    closeDialog();
  };

  const renderUpdatedAt = (value: SurveyTrigger['updatedAt']) => {
    const date = value instanceof Date ? value : value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return '—';
    }
    return formatDistanceToNow(date, { addSuffix: true });
  };

  const handleToggleEnabled = async (trigger: SurveyTrigger, enabled: boolean) => {
    setIsToggling(trigger.triggerId);
    try {
      const updated = await updateSurveyTrigger(trigger.triggerId, { enabled });
      onTriggersChange((prev) =>
        prev.map((item) => (item.triggerId === updated.triggerId ? updated : item))
      );
      toast({
        title: t('surveys.settings.triggerList.toasts.updated', 'Trigger updated'),
        description: '',
      });
    } catch (error) {
      console.error('[TriggerList] Failed to toggle trigger enabled', error);
      toast({
        title: t('surveys.settings.triggerList.toasts.error', 'Unable to save trigger'),
        description: error instanceof Error ? error.message : '',
        variant: 'destructive',
      });
    } finally {
      setIsToggling(null);
    }
  };

  const handleDelete = async (trigger: SurveyTrigger) => {
    try {
      await deleteSurveyTrigger(trigger.triggerId);
      onTriggersChange((prev) => prev.filter((item) => item.triggerId !== trigger.triggerId));
      toast({
        title: t('surveys.settings.triggerList.toasts.deleted', 'Trigger deleted'),
        description: '',
      });
    } catch (error) {
      console.error('[TriggerList] Failed to delete trigger', error);
      toast({
        title: t('surveys.settings.triggerList.toasts.deleteError', 'Unable to delete trigger'),
        description: error instanceof Error ? error.message : '',
        variant: 'destructive',
      });
    }
  };

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      await onRefresh();
    } catch (error) {
      console.error('[TriggerList] Failed to refresh triggers', error);
      toast({
        title: t('surveys.settings.triggerList.toasts.error', 'Unable to save trigger'),
        description: error instanceof Error ? error.message : '',
        variant: 'destructive',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const boardsMap = useMemo(() => {
    const map = new Map<string, string>();
    referenceData?.boards?.forEach((board) => {
      if (board.board_id) {
        map.set(board.board_id, board.board_name ?? board.board_id);
      }
    });
    return map;
  }, [referenceData?.boards]);

  const statusMap = useMemo(() => {
    const map = new Map<string, string>();
    referenceData?.ticketStatuses?.forEach((status) => {
      if (status.status_id) {
        map.set(status.status_id, status.name);
      }
    });
    referenceData?.projectStatuses?.forEach((status) => {
      if (status.status_id) {
        map.set(status.status_id, status.name);
      }
    });
    return map;
  }, [referenceData?.ticketStatuses, referenceData?.projectStatuses]);

  const priorityMap = useMemo(() => {
    const map = new Map<string, string>();
    referenceData?.priorities?.forEach((priority) => {
      if (priority.priority_id) {
        map.set(priority.priority_id, priority.priority_name);
      }
    });
    return map;
  }, [referenceData?.priorities]);

  const getConditionText = (values: string[] | undefined, lookup: Map<string, string>) =>
    values && values.length > 0
      ? values.map((value) => lookup.get(value) ?? value).join(', ')
      : null;

  const renderConditions = (trigger: SurveyTrigger) => {
    const boardText =
      trigger.triggerType === 'ticket_closed'
        ? getConditionText(
            'board_id' in trigger.triggerConditions ? trigger.triggerConditions.board_id : undefined,
            boardsMap
          )
        : null;
    const statusText = getConditionText(trigger.triggerConditions.status_id, statusMap);
    const priorityText =
      trigger.triggerType === 'ticket_closed'
        ? getConditionText(
            'priority' in trigger.triggerConditions ? trigger.triggerConditions.priority : undefined,
            priorityMap
          )
        : null;

    const hasFilters = Boolean(boardText || statusText || priorityText);

    if (!hasFilters) {
      return (
        <span className="text-xs text-gray-500">
          {t(
            'surveys.settings.triggerList.conditions.unrestricted',
            'Applies to every ticket and project'
          )}
        </span>
      );
    }

    return (
      <div className="space-y-1 text-xs text-gray-600">
        {boardText && (
          <div>
            <span className="font-medium">
              {t('surveys.settings.triggerList.conditions.boards', 'Boards')}
            </span>{' '}
            <span>{boardText}</span>
          </div>
        )}
        {statusText && (
          <div>
            <span className="font-medium">
              {t('surveys.settings.triggerList.conditions.statuses', 'Statuses')}
            </span>{' '}
            <span>{statusText}</span>
          </div>
        )}
        {priorityText && (
          <div>
            <span className="font-medium">
              {t('surveys.settings.triggerList.conditions.priorities', 'Priorities')}
            </span>{' '}
            <span>{priorityText}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>{t('surveys.settings.triggerList.title', 'Survey triggers')}</CardTitle>
          <CardDescription>
            {t(
              'surveys.settings.triggerList.description',
              'Automatically send invitations when tickets or projects reach completion.'
            )}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            id="survey-trigger-refresh-button"
            variant="outline"
            onClick={handleRefresh}
            className="gap-2"
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {t('actions.refresh', 'Refresh')}
          </Button>
          <Button
            id="survey-trigger-add-button"
            onClick={handleOpenCreate}
            className="gap-2"
          >
            <PlusIcon className="h-4 w-4" />
            {t('surveys.settings.triggerList.createButton', 'New trigger')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <LoadingIndicator
              layout="stacked"
              text={t('surveys.common.loading', 'Loading...')}
            />
          </div>
        ) : sortedTriggers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 py-16 text-center">
            <h3 className="text-lg font-semibold">
              {t('surveys.settings.triggerList.emptyTitle', 'No survey triggers configured')}
            </h3>
            <p className="max-w-md text-sm text-gray-500">
              {t(
                'surveys.settings.triggerList.emptyDescription',
                'Create a trigger to send surveys when tickets close or projects finish.'
              )}
            </p>
            <Button id="survey-trigger-empty-create" onClick={handleOpenCreate} className="mt-2 gap-2">
              <PlusIcon className="h-4 w-4" />
              {t('surveys.settings.triggerList.createButton', 'New trigger')}
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('surveys.settings.triggerList.table.template', 'Template')}</TableHead>
                <TableHead>{t('surveys.settings.triggerList.table.type', 'Trigger')}</TableHead>
                <TableHead>{t('surveys.settings.triggerList.table.conditions', 'Conditions')}</TableHead>
                <TableHead>{t('surveys.settings.triggerList.table.status', 'Status')}</TableHead>
                <TableHead>{t('surveys.settings.triggerList.table.updated', 'Updated')}</TableHead>
                <TableHead className="text-right">{t('surveys.settings.triggerList.table.actions', 'Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTriggers.map((trigger) => {
                const template = templateLookup[trigger.templateId];
                return (
                  <TableRow key={trigger.triggerId}>
                    <TableCell>{template?.templateName ?? trigger.templateId}</TableCell>
                    <TableCell>
                      {t(
                        `surveys.settings.triggerForm.triggerTypes.${trigger.triggerType}`,
                        triggerTypeFallbackLabels[trigger.triggerType]
                      )}
                    </TableCell>
                    <TableCell>{renderConditions(trigger)}</TableCell>
                    <TableCell>
                      <Switch
                        id={`survey-trigger-enabled-${trigger.triggerId}`}
                        checked={trigger.enabled}
                        onCheckedChange={(checked) => handleToggleEnabled(trigger, Boolean(checked))}
                        disabled={isToggling === trigger.triggerId}
                        label={
                          trigger.enabled
                            ? t('surveys.settings.triggerList.status.enabled', 'Enabled')
                            : t('surveys.settings.triggerList.status.disabled', 'Disabled')
                        }
                      />
                    </TableCell>
                    <TableCell>{renderUpdatedAt(trigger.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            id={`survey-trigger-actions-${trigger.triggerId}`}
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Open actions for trigger targeting ${template?.templateName ?? trigger.triggerType}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            id={`survey-trigger-edit-${trigger.triggerId}`}
                            onSelect={() => handleEdit(trigger)}
                          >
                            {t('actions.edit', 'Edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            id={`survey-trigger-delete-${trigger.triggerId}`}
                            className="text-red-600 focus:bg-red-50 focus:text-red-700"
                            onSelect={() => handleDelete(trigger)}
                          >
                            {t('actions.delete', 'Delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog
        id="survey-trigger-dialog"
        isOpen={isDialogOpen}
        onClose={closeDialog}
        title={
          editingTrigger
            ? t('surveys.settings.triggerForm.titleEdit', 'Edit survey trigger')
            : t('surveys.settings.triggerForm.titleCreate', 'Create survey trigger')
        }
        className="max-w-3xl"
      >
        <TriggerForm
          templates={templates}
          trigger={editingTrigger ?? undefined}
          onSuccess={handleFormSuccess}
          onDeleteSuccess={handleDeleteSuccess}
          onCancel={closeDialog}
        />
      </Dialog>
    </Card>
  );
}

export default TriggerList;
