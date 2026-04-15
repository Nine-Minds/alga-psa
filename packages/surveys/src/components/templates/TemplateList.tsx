'use client';

import { useCallback, useMemo, useState } from 'react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { SurveyTemplate } from '@alga-psa/surveys/actions/surveyActions';
import {
  updateSurveyTemplate,
  deleteSurveyTemplate,
} from '@alga-psa/surveys/actions/surveyActions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useToast } from '@alga-psa/ui';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import TemplateForm from './TemplateForm';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { DeleteEntityDialog } from '@alga-psa/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { MoreVertical, PlusIcon, RefreshCw } from 'lucide-react';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import type { DeletionValidationResult } from '@alga-psa/types';

interface TemplateListProps {
  templates: SurveyTemplate[];
  isLoading: boolean;
  onTemplatesChange: React.Dispatch<React.SetStateAction<SurveyTemplate[]>>;
  onRefresh: () => Promise<void>;
}

export function TemplateList({ templates, isLoading, onTemplatesChange, onRefresh }: TemplateListProps) {
  const { t } = useTranslation('msp/surveys');
  const { t: tCommon } = useTranslation('common');
  const { formatRelativeTime } = useFormatters();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SurveyTemplate | null>(null);
  const [isToggling, setIsToggling] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SurveyTemplate | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);

  const resetDeleteState = useCallback(() => {
    setIsDeleteDialogOpen(false);
    setDeleteTarget(null);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleteProcessing(false);
  }, []);

  const runDeleteValidation = useCallback(async (templateId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('survey_template', templateId);
      setDeleteValidation(result);
    } catch (error) {
      console.error('[TemplateList] Failed to validate survey template deletion', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('settings.templateList.delete.validationFailed', {
          defaultValue: 'Failed to validate deletion. Please try again.',
        }),
        dependencies: [],
        alternatives: [],
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [t]);

  const sortedTemplates = useMemo(
    () =>
      [...templates].sort((a, b) => {
        const dateB = b.updatedAt?.getTime?.() ?? new Date(b.updatedAt).getTime();
        const dateA = a.updatedAt?.getTime?.() ?? new Date(a.updatedAt).getTime();
        return dateB - dateA;
      }),
    [templates]
  );

  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (template: SurveyTemplate) => {
    setEditingTemplate(template);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingTemplate(null);
  };

  const handleFormSuccess = (template: SurveyTemplate) => {
    onTemplatesChange((prev) => {
      const exists = prev.some((item) => item.templateId === template.templateId);
      if (exists) {
        return prev.map((item) => (item.templateId === template.templateId ? template : item));
      }
      return [template, ...prev];
    });
    closeDialog();
  };

  const handleDeleteSuccess = (templateId: string) => {
    onTemplatesChange((prev) => prev.filter((template) => template.templateId !== templateId));
    closeDialog();
  };

  const handleToggleEnabled = async (template: SurveyTemplate, enabled: boolean) => {
    setIsToggling(template.templateId);
    try {
      const updated = await updateSurveyTemplate(template.templateId, { enabled });
      onTemplatesChange((prev) =>
        prev.map((item) => (item.templateId === updated.templateId ? updated : item))
      );
      toast({
        title: t('settings.templateList.toasts.updated', {
          defaultValue: 'Template updated',
        }),
        description: updated.templateName,
      });
    } catch (error) {
      console.error('[TemplateList] Failed to toggle template enabled', error);
      toast({
        title: t('settings.templateList.toasts.error', {
          defaultValue: 'Unable to save template',
        }),
        description: error instanceof Error ? error.message : '',
        variant: 'destructive',
      });
    } finally {
      setIsToggling(null);
    }
  };

  const handleSetDefault = async (template: SurveyTemplate) => {
    setIsToggling(template.templateId);
    try {
      const updated = await updateSurveyTemplate(template.templateId, { isDefault: true });
      onTemplatesChange((prev) =>
        prev.map((item) => ({
          ...item,
          isDefault: item.templateId === updated.templateId,
        }))
      );
      toast({
        title: t('settings.templateList.toasts.setDefault', {
          defaultValue: 'Default template updated',
        }),
        description: updated.templateName,
      });
    } catch (error) {
      console.error('[TemplateList] Failed to set default template', error);
      toast({
        title: t('settings.templateList.toasts.error', {
          defaultValue: 'Unable to save template',
        }),
        description: error instanceof Error ? error.message : '',
        variant: 'destructive',
      });
    } finally {
      setIsToggling(null);
    }
  };

  const handleDelete = (template: SurveyTemplate) => {
    setDeleteTarget(template);
    setDeleteValidation(null);
    setIsDeleteDialogOpen(true);
    void runDeleteValidation(template.templateId);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) {
      return;
    }
    setIsDeleteProcessing(true);
    try {
      const result = await deleteSurveyTemplate(deleteTarget.templateId);
      if (result.success) {
        onTemplatesChange((prev) => prev.filter((item) => item.templateId !== deleteTarget.templateId));
        toast({
          title: t('settings.templateList.toasts.deleted', {
            defaultValue: 'Template deleted',
          }),
          description: deleteTarget.templateName,
        });
        resetDeleteState();
        return;
      }
      setDeleteValidation(result);
    } catch (error) {
      console.error('[TemplateList] Failed to delete template', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message:
          error instanceof Error
            ? error.message
            : t('settings.templateList.delete.error', {
                defaultValue: 'Unable to delete template',
              }),
        dependencies: [],
        alternatives: [],
      });
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      await onRefresh();
    } catch (error) {
      console.error('[TemplateList] Failed to refresh templates', error);
      toast({
        title: t('settings.templateList.toasts.error', {
          defaultValue: 'Unable to save template',
        }),
        description: error instanceof Error ? error.message : '',
        variant: 'destructive',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const renderRatingLabels = (labels: Record<string, string>) =>
    Object.entries(labels)
      .map(([value, label]) => `${value}: ${label}`)
      .join(', ');

  const renderUpdatedAt = (updatedAt: SurveyTemplate['updatedAt']) => {
    const date =
      updatedAt instanceof Date ? updatedAt : updatedAt ? new Date(updatedAt) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return '-';
    }
    return formatRelativeTime(date);
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>
            {t('settings.templateList.title', { defaultValue: 'Survey templates' })}
          </CardTitle>
          <CardDescription>
            {t('settings.templateList.description', {
              defaultValue: 'Manage the prompts and rating scales sent to your clients.',
            })}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            id="survey-template-refresh-button"
            variant="outline"
            onClick={handleRefresh}
            className="gap-2"
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {tCommon('actions.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button
            id="survey-template-add-button"
            onClick={handleOpenCreate}
            className="gap-2"
          >
            <PlusIcon className="h-4 w-4" />
            {t('settings.templateList.createButton', { defaultValue: 'New template' })}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <LoadingIndicator
              layout="stacked"
              text={t('common.loading', { defaultValue: 'Loading...' })}
            />
          </div>
        ) : sortedTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 py-16 text-center">
            <h3 className="text-lg font-semibold">
              {t('settings.templateList.emptyTitle', {
                defaultValue: 'No survey templates yet',
              })}
            </h3>
            <p className="max-w-md text-sm text-gray-500">
              {t('settings.templateList.emptyDescription', {
                defaultValue: 'Create your first template to define the survey wording and rating scale.',
              })}
            </p>
            <Button id="survey-template-empty-create" onClick={handleOpenCreate} className="mt-2 gap-2">
              <PlusIcon className="h-4 w-4" />
              {t('settings.templateList.createButton', { defaultValue: 'New template' })}
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.templateList.table.name', { defaultValue: 'Template' })}</TableHead>
                <TableHead>{t('settings.templateList.table.rating', { defaultValue: 'Rating scale' })}</TableHead>
                <TableHead>{t('settings.templateList.table.status', { defaultValue: 'Status' })}</TableHead>
                <TableHead>{t('settings.templateList.table.updated', { defaultValue: 'Updated' })}</TableHead>
                <TableHead className="text-right">
                  {t('settings.templateList.table.actions', { defaultValue: 'Actions' })}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTemplates.map((template) => (
                <TableRow key={template.templateId}>
                  <TableCell className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{template.templateName}</span>
                      {template.isDefault && (
                        <Badge variant="outline">
                          {t('settings.templateList.defaultBadge', { defaultValue: 'Default' })}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{renderRatingLabels(template.ratingLabels)}</p>
                  </TableCell>
                  <TableCell>
                    {template.ratingScale}{' '}
                    <span className="text-xs uppercase tracking-wide text-gray-500">
                      {t(`settings.templateForm.ratingTypes.${template.ratingType}`, {
                        defaultValue: template.ratingType,
                      })}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`survey-template-enabled-${template.templateId}`}
                        checked={template.enabled}
                        disabled={isToggling === template.templateId}
                        onCheckedChange={(checked) => handleToggleEnabled(template, Boolean(checked))}
                        label={
                          template.enabled
                            ? t('settings.templateList.status.enabled', {
                                defaultValue: 'Enabled',
                              })
                            : t('settings.templateList.status.disabled', {
                                defaultValue: 'Disabled',
                              })
                        }
                      />
                    </div>
                  </TableCell>
                  <TableCell>{renderUpdatedAt(template.updatedAt)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          id={`survey-template-actions-${template.templateId}`}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t('settings.templateList.actionsMenuAria', {
                            defaultValue: 'Open actions for {{name}}',
                            name: template.templateName,
                          })}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          id={`survey-template-edit-${template.templateId}`}
                          onSelect={() => handleEdit(template)}
                        >
                          {tCommon('actions.edit', { defaultValue: 'Edit' })}
                        </DropdownMenuItem>
                        {!template.isDefault && (
                          <DropdownMenuItem
                            id={`survey-template-set-default-${template.templateId}`}
                            disabled={isToggling === template.templateId}
                            onSelect={() => handleSetDefault(template)}
                          >
                            {t('settings.templateList.actions.setDefault', {
                              defaultValue: 'Set as default',
                            })}
                          </DropdownMenuItem>
                        )}
                        {!template.isDefault && <DropdownMenuSeparator />}
                        <DropdownMenuItem
                          id={`survey-template-delete-${template.templateId}`}
                          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                          onSelect={() => handleDelete(template)}
                        >
                          {tCommon('actions.delete', { defaultValue: 'Delete' })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog
        id="survey-template-dialog"
        isOpen={isDialogOpen}
        onClose={closeDialog}
        title={
          editingTemplate
            ? t('settings.templateForm.titleEdit', {
                defaultValue: 'Edit survey template',
              })
            : t('settings.templateForm.titleCreate', {
                defaultValue: 'Create survey template',
              })
        }
        className="max-w-6xl"
      >
        <TemplateForm
          template={editingTemplate ?? undefined}
          onSuccess={handleFormSuccess}
          onDeleteSuccess={handleDeleteSuccess}
          onCancel={closeDialog}
        />
      </Dialog>

      <DeleteEntityDialog
        id={deleteTarget ? `delete-survey-template-${deleteTarget.templateId}` : 'delete-survey-template-dialog'}
        isOpen={isDeleteDialogOpen}
        onClose={resetDeleteState}
        onConfirmDelete={handleDeleteConfirm}
        entityName={
          deleteTarget?.templateName ||
          t('settings.templateList.delete.entityFallback', {
            defaultValue: 'this survey template',
          })
        }
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />

    </Card>
  );
}

export default TemplateList;
