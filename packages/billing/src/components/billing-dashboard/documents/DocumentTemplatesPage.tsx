'use client';

import { documentTypeLabel } from './documentTypeLabel';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Tabs, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import type { ColumnDefinition } from '@alga-psa/types';
import { FileTextIcon, Settings, MoreVertical, CheckCircle2 } from 'lucide-react';
import {
  getDocumentTemplates,
  saveDocumentTemplate,
  setDefaultDocumentTemplate,
  deleteDocumentTemplate,
} from '../../../actions/documentTemplateActions';
import {
  DOCUMENT_TYPES,
  getDocumentTypeRegistryEntry,
  isDocumentType,
} from '../../../lib/document-templates/registry';
import type { DocumentTemplateListItem } from '../../../lib/document-templates/storage';
import DocumentTemplateEditor, { type DocumentTemplateDraft } from './DocumentTemplateEditor';

interface DocumentTemplatesPageProps {
  documentType: string;
}

type ViewState =
  | { mode: 'list' }
  | { mode: 'editor'; draft: DocumentTemplateDraft };

const isDocumentTemplateActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

const DocumentTemplatesPage: React.FC<DocumentTemplatesPageProps> = ({ documentType }) => {
  const { t } = useTranslation('msp/invoicing');
  const router = useRouter();
  const registryEntry = useMemo(
    () => (isDocumentType(documentType) ? getDocumentTypeRegistryEntry(documentType) : null),
    [documentType],
  );
  const typeLabel = documentTypeLabel(documentType, t);
  const documentTypeOptions = useMemo(
    () => DOCUMENT_TYPES.map((type) => ({
      type,
      label: getDocumentTypeRegistryEntry(type).label,
    })),
    [],
  );

  const [templates, setTemplates] = useState<DocumentTemplateListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ mode: 'list' });
  const [templateToDelete, setTemplateToDelete] = useState<DocumentTemplateListItem | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      const result = await getDocumentTemplates(documentType);
      if (isDocumentTemplateActionError(result)) {
        setTemplates([]);
        setError(getErrorMessage(result));
        return;
      }
      setTemplates(result);
      setError(null);
    } catch (loadError) {
      console.error('Error loading document templates:', loadError);
      setError(loadError instanceof Error
        ? loadError.message
        : t('documentTemplates.errors.loadFailed', {
          defaultValue: 'Failed to load {{type}} templates',
          type: typeLabel,
        }));
    }
  }, [documentType, t, typeLabel]);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const openNewTemplate = useCallback(() => {
    const startingAst = registryEntry?.getStandardTemplateAstByCode(registryEntry.defaultStandardCode) ?? undefined;
    setView({
      mode: 'editor',
      draft: { name: '', version: 1, templateAst: startingAst, source: 'custom' },
    });
  }, [registryEntry]);

  const openEditTemplate = useCallback((record: DocumentTemplateListItem) => {
    if (record.source === 'standard') {
      // Standards are read-only — open as a fresh, unsaved custom copy.
      setView({
        mode: 'editor',
        draft: {
          name: t('templates.values.copyOfName', { defaultValue: 'Copy of {{name}}', name: record.name }),
          version: 1,
          templateAst: record.templateAst,
          source: 'standard',
          isClone: true,
        },
      });
      return;
    }
    setView({
      mode: 'editor',
      draft: {
        template_id: record.template_id,
        name: record.name,
        version: 1,
        templateAst: record.templateAst,
        source: 'custom',
      },
    });
  }, [t]);

  const handleCloneTemplate = useCallback(async (record: DocumentTemplateListItem) => {
    try {
      const result = await saveDocumentTemplate(documentType, {
        name: t('documentTemplates.values.copyName', { defaultValue: '{{name}} (Copy)', name: record.name }),
        version: 1,
        templateAst: record.templateAst,
        isClone: true,
      });
      if (isDocumentTemplateActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      if (!result.success) {
        toast.error(result.error ?? t('documentTemplates.errors.cloneFailed', { defaultValue: 'Failed to clone template' }));
        return;
      }
      toast.success(t('documentTemplates.toasts.cloned', { defaultValue: 'Template cloned' }));
      await fetchTemplates();
    } catch (err) {
      console.error('Error cloning template:', err);
      toast.error(t('documentTemplates.errors.cloneFailed', { defaultValue: 'Failed to clone template' }));
    }
  }, [documentType, fetchTemplates, t]);

  const handleSetDefaultTemplate = useCallback(async (record: DocumentTemplateListItem) => {
    try {
      if (record.source === 'standard') {
        if (!record.code) {
          throw new Error('Standard template is missing a template code');
        }
        const result = await setDefaultDocumentTemplate(documentType, {
          templateSource: 'standard',
          standardTemplateCode: record.code,
        });
        if (isDocumentTemplateActionError(result)) {
          toast.error(getErrorMessage(result));
          return;
        }
      } else {
        const result = await setDefaultDocumentTemplate(documentType, {
          templateSource: 'custom',
          templateId: record.template_id,
        });
        if (isDocumentTemplateActionError(result)) {
          toast.error(getErrorMessage(result));
          return;
        }
      }
      toast.success(t('documentTemplates.toasts.defaultUpdated', { defaultValue: 'Default template updated' }));
      await fetchTemplates();
    } catch (err) {
      console.error('Error setting default template:', err);
      toast.error(t('documentTemplates.errors.setDefaultFailed', { defaultValue: 'Failed to set default template' }));
    }
  }, [documentType, fetchTemplates, t]);

  const handleDeleteTemplate = useCallback(async (record: DocumentTemplateListItem) => {
    try {
      const result = await deleteDocumentTemplate(documentType, record.template_id);
      if (isDocumentTemplateActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      if (!result.success) {
        toast.error(result.error ?? t('documentTemplates.errors.deleteFailed', { defaultValue: 'Failed to delete template' }));
        return;
      }
      toast.success(t('documentTemplates.toasts.deleted', { defaultValue: 'Template deleted' }));
      setTemplateToDelete(null);
      await fetchTemplates();
    } catch (err) {
      console.error('Error deleting template:', err);
      toast.error(t('documentTemplates.errors.deleteFailed', { defaultValue: 'Failed to delete template' }));
    }
  }, [documentType, fetchTemplates, t]);

  const handleEditorSaved = useCallback(async () => {
    setView({ mode: 'list' });
    await fetchTemplates();
  }, [fetchTemplates]);

  const handleDocumentTypeChange = useCallback((nextType: string) => {
    if (nextType !== documentType) {
      router.push(`/msp/document-templates/${nextType}`);
    }
  }, [documentType, router]);

  const columns = useMemo((): ColumnDefinition<DocumentTemplateListItem>[] => [
    {
      title: t('documentTemplates.columns.name', { defaultValue: 'Name' }),
      dataIndex: 'name',
      render: (value: string | null | undefined, record: DocumentTemplateListItem) => (
        <div className="flex items-center gap-2">
          {record.source === 'standard' ? (
            <>
              <FileTextIcon className="w-4 h-4" /> {t('documentTemplates.values.nameWithStandardSuffix', {
                defaultValue: '{{name}} (Standard)',
                name: value,
              })}
            </>
          ) : (
            <div className="flex items-center gap-1">
              <Settings className="w-4 h-4" />
              {value}
            </div>
          )}
        </div>
      ),
    },
    {
      title: t('documentTemplates.columns.source', { defaultValue: 'Source' }),
      dataIndex: 'source',
      render: (value: string | null | undefined, record: DocumentTemplateListItem) =>
        record.source === 'standard'
          ? t('templates.types.standard', { defaultValue: 'Standard' })
          : (value || t('templates.types.custom', { defaultValue: 'Custom' })),
    },
    {
      title: t('templates.columns.default', { defaultValue: 'Default' }),
      dataIndex: 'is_default',
      headerClassName: 'text-center align-middle',
      cellClassName: 'text-center align-middle max-w-none',
      render: (_: boolean | null | undefined, record: DocumentTemplateListItem) =>
        record.is_default ? (
          <div className="flex justify-center items-center">
            <CheckCircle2 className="h-4 w-4 text-primary-500" />
          </div>
        ) : null,
    },
    {
      title: t('templates.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'template_id',
      width: '10%',
      render: (_: string | null | undefined, record: DocumentTemplateListItem) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="document-template-actions-menu"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">{t('templates.actions.openMenu', { defaultValue: 'Open menu' })}</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id="edit-document-template-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                openEditTemplate(record);
              }}
            >
              {record.source === 'standard'
                ? t('templates.actions.editAsCopy', { defaultValue: 'Edit as Copy' })
                : t('templates.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="clone-document-template-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                void handleCloneTemplate(record);
              }}
            >
              {t('templates.actions.clone', { defaultValue: 'Clone' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="set-default-document-template-menu-item"
              disabled={record.is_default}
              onClick={(e) => {
                e.stopPropagation();
                void handleSetDefaultTemplate(record);
              }}
            >
              {t('templates.actions.setDefault', { defaultValue: 'Set as Default' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-document-template-menu-item"
              className="text-red-600 focus:text-red-600"
              disabled={record.source === 'standard'}
              onClick={(e) => {
                e.stopPropagation();
                setTemplateToDelete(record);
              }}
            >
              {t('templates.actions.delete', { defaultValue: 'Delete' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], [handleCloneTemplate, handleSetDefaultTemplate, openEditTemplate, t]);

  if (view.mode === 'editor') {
    return (
      <DocumentTemplateEditor
        documentType={documentType}
        template={view.draft}
        onSave={() => void handleEditorSaved()}
        onCancel={() => setView({ mode: 'list' })}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            {t('documentTemplates.title', { defaultValue: '{{type}} Layouts', type: typeLabel })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('documentTemplates.description', {
              defaultValue: 'Design the layouts used to render {{type}} PDFs and previews.',
              type: typeLabel,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Tabs
            value={documentType}
            onValueChange={handleDocumentTypeChange}
            className="w-auto"
          >
            <TabsList>
              {documentTypeOptions.map((option) => (
                <TabsTrigger
                  key={option.type}
                  id={`document-template-type-${option.type}`}
                  value={option.type}
                >
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button id="document-templates-new" onClick={openNewTemplate} disabled={!registryEntry}>
            {t('documentTemplates.actions.newLayout', { defaultValue: 'New Layout' })}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('documentTemplates.title', { defaultValue: '{{type}} Layouts', type: typeLabel })}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('documentTemplates.availableLayouts', { defaultValue: 'Available Layouts' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={templates}
            columns={columns}
            pagination
            onRowClick={(record) => openEditTemplate(record)}
            rowClassName={() => 'cursor-pointer'}
          />
        </CardContent>
      </Card>

      <ConfirmationDialog
        id="delete-document-template-dialog"
        isOpen={templateToDelete !== null}
        onClose={() => setTemplateToDelete(null)}
        onConfirm={() => {
          if (templateToDelete) {
            void handleDeleteTemplate(templateToDelete);
          }
        }}
        title={t('documentTemplates.deleteDialog.title', { defaultValue: 'Delete {{type}} Layout', type: typeLabel })}
        message={
          templateToDelete
            ? t('documentTemplates.deleteDialog.message', {
              defaultValue: 'Are you sure you want to delete "{{name}}"?',
              name: templateToDelete.name,
            })
            : ''
        }
        confirmLabel={t('templates.actions.delete', { defaultValue: 'Delete' })}
      />
    </div>
  );
};

export default DocumentTemplatesPage;
