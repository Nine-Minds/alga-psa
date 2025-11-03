'use client';

import { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'server/src/lib/i18n/client';
import type { SurveyTemplate } from 'server/src/lib/actions/surveyActions';
import {
  updateSurveyTemplate,
  deleteSurveyTemplate,
} from 'server/src/lib/actions/surveyActions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'server/src/components/ui/Table';
import { Switch } from 'server/src/components/ui/Switch';
import { useToast } from 'server/src/hooks/use-toast';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import TemplateForm from './TemplateForm';
import { Dialog } from 'server/src/components/ui/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { MoreVertical, PlusIcon, RefreshCw } from 'lucide-react';

interface TemplateListProps {
  templates: SurveyTemplate[];
  isLoading: boolean;
  onTemplatesChange: React.Dispatch<React.SetStateAction<SurveyTemplate[]>>;
  onRefresh: () => Promise<void>;
}

export function TemplateList({ templates, isLoading, onTemplatesChange, onRefresh }: TemplateListProps) {
  const { t } = useTranslation('common');
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SurveyTemplate | null>(null);
  const [isToggling, setIsToggling] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
        title: t('surveys.settings.templateList.toasts.updated', 'Template updated'),
        description: updated.templateName,
      });
    } catch (error) {
      console.error('[TemplateList] Failed to toggle template enabled', error);
      toast({
        title: t('surveys.settings.templateList.toasts.error', 'Unable to save template'),
        description: error instanceof Error ? error.message : undefined,
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
        title: t('surveys.settings.templateList.toasts.setDefault', 'Default template updated'),
        description: updated.templateName,
      });
    } catch (error) {
      console.error('[TemplateList] Failed to set default template', error);
      toast({
        title: t('surveys.settings.templateList.toasts.error', 'Unable to save template'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsToggling(null);
    }
  };

  const handleDelete = async (template: SurveyTemplate) => {
    try {
      await deleteSurveyTemplate(template.templateId);
      onTemplatesChange((prev) => prev.filter((item) => item.templateId !== template.templateId));
      toast({
        title: t('surveys.settings.templateList.toasts.deleted', 'Template deleted'),
        description: template.templateName,
      });
    } catch (error) {
      console.error('[TemplateList] Failed to delete template', error);
      toast({
        title: t('surveys.settings.templateList.toasts.deleteError', 'Unable to delete template'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      await onRefresh();
    } catch (error) {
      console.error('[TemplateList] Failed to refresh templates', error);
      toast({
        title: t('surveys.settings.templateList.toasts.error', 'Unable to save template'),
        description: error instanceof Error ? error.message : undefined,
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
      return '—';
    }
    return formatDistanceToNow(date, { addSuffix: true });
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>{t('surveys.settings.templateList.title', 'Survey templates')}</CardTitle>
          <CardDescription>
            {t(
              'surveys.settings.templateList.description',
              'Manage the prompts and rating scales sent to your clients.'
            )}
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
            {t('actions.refresh', 'Refresh')}
          </Button>
          <Button
            id="survey-template-add-button"
            onClick={handleOpenCreate}
            className="gap-2"
          >
            <PlusIcon className="h-4 w-4" />
            {t('surveys.settings.templateList.createButton', 'New template')}
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
        ) : sortedTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 py-16 text-center">
            <h3 className="text-lg font-semibold">
              {t('surveys.settings.templateList.emptyTitle', 'No survey templates yet')}
            </h3>
            <p className="max-w-md text-sm text-gray-500">
              {t(
                'surveys.settings.templateList.emptyDescription',
                'Create your first template to define the survey wording and rating scale.'
              )}
            </p>
            <Button id="survey-template-empty-create" onClick={handleOpenCreate} className="mt-2 gap-2">
              <PlusIcon className="h-4 w-4" />
              {t('surveys.settings.templateList.createButton', 'New template')}
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('surveys.settings.templateList.table.name', 'Template')}</TableHead>
                <TableHead>{t('surveys.settings.templateList.table.rating', 'Rating scale')}</TableHead>
                <TableHead>{t('surveys.settings.templateList.table.status', 'Status')}</TableHead>
                <TableHead>{t('surveys.settings.templateList.table.updated', 'Updated')}</TableHead>
                <TableHead className="text-right">
                  {t('surveys.settings.templateList.table.actions', 'Actions')}
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
                          {t('surveys.settings.templateList.defaultBadge', 'Default')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{renderRatingLabels(template.ratingLabels)}</p>
                  </TableCell>
                  <TableCell>
                    {template.ratingScale}{' '}
                    <span className="text-xs uppercase tracking-wide text-gray-500">
                      {t(`surveys.settings.templateForm.ratingTypes.${template.ratingType}`, template.ratingType)}
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
                            ? t('surveys.settings.templateList.status.enabled', 'Enabled')
                            : t('surveys.settings.templateList.status.disabled', 'Disabled')
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
                          aria-label={`Open actions for ${template.templateName}`}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          id={`survey-template-edit-${template.templateId}`}
                          onSelect={() => handleEdit(template)}
                        >
                          {t('actions.edit', 'Edit')}
                        </DropdownMenuItem>
                        {!template.isDefault && (
                          <DropdownMenuItem
                            id={`survey-template-set-default-${template.templateId}`}
                            disabled={isToggling === template.templateId}
                            onSelect={() => handleSetDefault(template)}
                          >
                            {t('surveys.settings.templateList.actions.setDefault', 'Set as default')}
                          </DropdownMenuItem>
                        )}
                        {!template.isDefault && <DropdownMenuSeparator />}
                        <DropdownMenuItem
                          id={`survey-template-delete-${template.templateId}`}
                          className="text-red-600 focus:bg-red-50 focus:text-red-700"
                          onSelect={() => handleDelete(template)}
                        >
                          {t('actions.delete', 'Delete')}
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
            ? t('surveys.settings.templateForm.titleEdit', 'Edit survey template')
            : t('surveys.settings.templateForm.titleCreate', 'Create survey template')
        }
        className="max-w-3xl"
      >
        <TemplateForm
          template={editingTemplate ?? undefined}
          onSuccess={handleFormSuccess}
          onDeleteSuccess={handleDeleteSuccess}
          onCancel={closeDialog}
        />
      </Dialog>
    </Card>
  );
}

export default TemplateList;
