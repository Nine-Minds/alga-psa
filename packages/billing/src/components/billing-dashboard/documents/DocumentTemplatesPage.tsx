'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Tabs, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
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
  const router = useRouter();
  const registryEntry = useMemo(
    () => (isDocumentType(documentType) ? getDocumentTypeRegistryEntry(documentType) : null),
    [documentType],
  );
  const typeLabel = registryEntry?.label ?? 'Document';
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
      setError(loadError instanceof Error ? loadError.message : `Failed to load ${typeLabel} templates`);
    }
  }, [documentType, typeLabel]);

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
          name: `Copy of ${record.name}`,
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
  }, []);

  const handleCloneTemplate = useCallback(async (record: DocumentTemplateListItem) => {
    try {
      const result = await saveDocumentTemplate(documentType, {
        name: `${record.name} (Copy)`,
        version: 1,
        templateAst: record.templateAst,
        isClone: true,
      });
      if (isDocumentTemplateActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      if (!result.success) {
        toast.error(result.error ?? 'Failed to clone template');
        return;
      }
      toast.success('Template cloned');
      await fetchTemplates();
    } catch (err) {
      console.error('Error cloning template:', err);
      toast.error('Failed to clone template');
    }
  }, [documentType, fetchTemplates]);

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
      toast.success('Default template updated');
      await fetchTemplates();
    } catch (err) {
      console.error('Error setting default template:', err);
      toast.error('Failed to set default template');
    }
  }, [documentType, fetchTemplates]);

  const handleDeleteTemplate = useCallback(async (record: DocumentTemplateListItem) => {
    try {
      const result = await deleteDocumentTemplate(documentType, record.template_id);
      if (isDocumentTemplateActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      if (!result.success) {
        toast.error(result.error ?? 'Failed to delete template');
        return;
      }
      toast.success('Template deleted');
      setTemplateToDelete(null);
      await fetchTemplates();
    } catch (err) {
      console.error('Error deleting template:', err);
      toast.error('Failed to delete template');
    }
  }, [documentType, fetchTemplates]);

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
      title: 'Name',
      dataIndex: 'name',
      render: (value: string | null | undefined, record: DocumentTemplateListItem) => (
        <div className="flex items-center gap-2">
          {record.source === 'standard' ? (
            <>
              <FileTextIcon className="w-4 h-4" /> {value} (Standard)
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
      title: 'Source',
      dataIndex: 'source',
      render: (value: string | null | undefined, record: DocumentTemplateListItem) =>
        record.source === 'standard' ? 'Standard' : (value || 'Custom'),
    },
    {
      title: 'Default',
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
      title: 'Actions',
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
              <span className="sr-only">Open menu</span>
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
              {record.source === 'standard' ? 'Edit as Copy' : 'Edit'}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="clone-document-template-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                void handleCloneTemplate(record);
              }}
            >
              Clone
            </DropdownMenuItem>
            <DropdownMenuItem
              id="set-default-document-template-menu-item"
              disabled={record.is_default}
              onClick={(e) => {
                e.stopPropagation();
                void handleSetDefaultTemplate(record);
              }}
            >
              Set as Default
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
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], [handleCloneTemplate, handleSetDefaultTemplate, openEditTemplate]);

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
          <h2 className="text-xl font-semibold text-foreground">{typeLabel} Layouts</h2>
          <p className="text-sm text-muted-foreground">
            Design the layouts used to render {typeLabel.toLowerCase()} PDFs and previews.
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
            New Layout
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{typeLabel} Layouts</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Available Layouts</CardTitle>
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
        title={`Delete ${typeLabel} Layout`}
        message={
          templateToDelete
            ? `Are you sure you want to delete "${templateToDelete.name}"?`
            : ''
        }
        confirmLabel="Delete"
      />
    </div>
  );
};

export default DocumentTemplatesPage;
