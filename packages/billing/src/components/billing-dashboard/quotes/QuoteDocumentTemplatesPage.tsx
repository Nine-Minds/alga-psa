'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import type { ColumnDefinition, IQuoteDocumentTemplate } from '@alga-psa/types';
import { isActionPermissionError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { FileTextIcon, Settings, MoreVertical, CheckCircle2 } from 'lucide-react';
import {
  getQuoteDocumentTemplates,
  saveQuoteDocumentTemplate,
  setDefaultQuoteDocumentTemplate,
  deleteQuoteDocumentTemplate,
} from '../../../actions/quoteDocumentTemplates';
import QuoteDocumentTemplateEditor from './QuoteDocumentTemplateEditor';

const QuoteDocumentTemplatesPage: React.FC = () => {
  const { t } = useTranslation('msp/quotes');
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedTemplateId = searchParams?.get('templateId');
  const standardCode = searchParams?.get('standardCode');
  const [templates, setTemplates] = useState<IQuoteDocumentTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [templateToDeleteId, setTemplateToDeleteId] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      const result = await getQuoteDocumentTemplates();
      if (isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      setTemplates(result as IQuoteDocumentTemplate[]);
      setError(null);
    } catch (loadError) {
      console.error('Error loading quote document templates:', loadError);
      setError(loadError instanceof Error ? loadError.message : t('templatesPage.errors.load', {
        defaultValue: 'Failed to load quote document templates',
      }));
    }
  }, [t]);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates, selectedTemplateId]);

  const handleNavigateToEditor = useCallback((templateId: string | 'new', code?: string) => {
    const params = new URLSearchParams();
    params.set('tab', 'quote-templates');
    params.set('templateId', templateId);
    if (code) {
      params.set('standardCode', code);
    }
    router.push(`/msp/billing?${params.toString()}`);
  }, [router]);

  const handleCloneTemplate = useCallback(async (template: IQuoteDocumentTemplate) => {
    try {
      await saveQuoteDocumentTemplate({
        ...template,
        name: `${template.name} (Copy)`,
        isClone: true,
        isStandard: false,
      });
      await fetchTemplates();
      setError(null);
    } catch (err) {
      console.error('Error cloning template:', err);
      setError(t('templatesPage.errors.clone', {
        defaultValue: 'Failed to clone template',
      }));
    }
  }, [fetchTemplates, t]);

  const handleCloneAndEdit = useCallback(async (template: IQuoteDocumentTemplate) => {
    try {
      const result = await saveQuoteDocumentTemplate({
        ...template,
        name: `Copy of ${template.name}`,
        isClone: true,
        isStandard: false,
      });
      if (!isActionPermissionError(result) && result.success && result.template?.template_id) {
        handleNavigateToEditor(result.template.template_id);
      } else {
        setError(t('templatesPage.errors.editCopy', {
          defaultValue: 'Failed to create editable copy',
        }));
      }
    } catch (err) {
      console.error('Error creating editable copy:', err);
      setError(t('templatesPage.errors.editCopy', {
        defaultValue: 'Failed to create editable copy',
      }));
    }
  }, [handleNavigateToEditor, t]);

  const handleSetDefaultTemplate = useCallback(async (template: IQuoteDocumentTemplate) => {
    try {
      if (template.isStandard) {
        if (!template.standard_quote_document_template_code) {
          throw new Error('Standard template is missing a template code');
        }
        await setDefaultQuoteDocumentTemplate({
          templateSource: 'standard',
          standardTemplateCode: template.standard_quote_document_template_code,
        });
      } else {
        await setDefaultQuoteDocumentTemplate({
          templateSource: 'custom',
          templateId: template.template_id,
        });
      }
      await fetchTemplates();
      setError(null);
    } catch (err) {
      console.error('Error setting default template:', err);
      setError(t('templatesPage.errors.setDefault', {
        defaultValue: 'Failed to set default template',
      }));
    }
  }, [fetchTemplates, t]);

  const handleDeleteTemplate = useCallback(async (templateId: string) => {
    try {
      const result = await deleteQuoteDocumentTemplate(templateId);
      if (isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      if (!result.success) {
        setError(result.error || t('templatesPage.errors.delete', {
          defaultValue: 'Failed to delete template',
        }));
        return;
      }
      setTemplateToDeleteId(null);
      await fetchTemplates();
      setError(null);
    } catch (err) {
      console.error('Error deleting template:', err);
      setError(t('templatesPage.errors.delete', {
        defaultValue: 'Failed to delete template',
      }));
    }
  }, [fetchTemplates, t]);

  const columns = useMemo((): ColumnDefinition<IQuoteDocumentTemplate>[] => [
    {
      title: t('common.columns.name', { defaultValue: 'Name' }),
      dataIndex: 'name',
      render: (value: string | null | undefined, record: IQuoteDocumentTemplate) => (
        <div className="flex items-center gap-2">
          {record.isStandard ? (
            <>
              <FileTextIcon className="w-4 h-4" /> {value} ({t('common.badges.standard', { defaultValue: 'Standard' })})
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
      title: t('common.columns.source', { defaultValue: 'Source' }),
      dataIndex: 'templateSource',
      render: (value: string | null | undefined, record: IQuoteDocumentTemplate) => record.isStandard
        ? t('common.badges.standard', { defaultValue: 'Standard' })
        : (value || t('templatesPage.labels.custom', { defaultValue: 'Custom' })),
    },
    {
      title: t('common.columns.default', { defaultValue: 'Default' }),
      dataIndex: 'isTenantDefault',
      headerClassName: 'text-center align-middle',
      cellClassName: 'text-center align-middle max-w-none',
      render: (_: boolean | null | undefined, record: IQuoteDocumentTemplate) =>
        record.isTenantDefault ? (
          <div className="flex justify-center items-center">
            <CheckCircle2 className="h-4 w-4 text-primary-500" />
          </div>
        ) : null,
    },
    {
      title: t('common.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'template_id',
      width: '10%',
      render: (_: string | null | undefined, record: IQuoteDocumentTemplate) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="quote-template-actions-menu"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">{t('templatesPage.actions.openMenu', { defaultValue: 'Open menu' })}</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id="edit-quote-template-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                if (record.isStandard) {
                  void handleCloneAndEdit(record);
                } else {
                  handleNavigateToEditor(record.template_id);
                }
              }}
            >
              {record.isStandard
                ? t('common.actions.editAsCopy', { defaultValue: 'Edit as Copy' })
                : t('common.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="clone-quote-template-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                void handleCloneTemplate(record);
              }}
            >
              {t('common.actions.clone', { defaultValue: 'Clone' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="set-default-quote-template-menu-item"
              disabled={record.isTenantDefault}
              onClick={(e) => {
                e.stopPropagation();
                void handleSetDefaultTemplate(record);
              }}
            >
              {t('common.actions.setAsDefault', { defaultValue: 'Set as Default' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-quote-template-menu-item"
              className="text-red-600 focus:text-red-600"
              disabled={record.isStandard}
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(t('templatesPage.dialogs.deleteConfirm', {
                  defaultValue: 'Are you sure you want to delete "{{name}}"?',
                  name: record.name,
                }))) {
                  void handleDeleteTemplate(record.template_id);
                }
              }}
            >
              {t('common.actions.delete', { defaultValue: 'Delete' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], [handleCloneAndEdit, handleCloneTemplate, handleDeleteTemplate, handleNavigateToEditor, handleSetDefaultTemplate, t]);

  if (selectedTemplateId || standardCode) {
    return (
      <QuoteDocumentTemplateEditor
        templateId={selectedTemplateId === 'new' ? null : selectedTemplateId}
        standardCode={standardCode}
        onBack={() => router.push('/msp/billing?tab=quote-templates')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            {t('templatesPage.title', { defaultValue: 'Quote Layouts' })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('templatesPage.description', { defaultValue: 'Design the layouts used to render quote PDFs and previews.' })}
          </p>
        </div>
        <Button id="quote-document-templates-new" onClick={() => handleNavigateToEditor('new')}>
          {t('common.actions.newLayout', { defaultValue: 'New Layout' })}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('templatesPage.title', { defaultValue: 'Quote Layouts' })}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('templatesPage.cards.availableLayouts', { defaultValue: 'Available Layouts' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={templates}
            columns={columns}
            pagination
            onRowClick={(record) => {
              if (record.isStandard) {
                handleNavigateToEditor('new', record.standard_quote_document_template_code || 'standard-quote-default');
              } else {
                handleNavigateToEditor(record.template_id);
              }
            }}
            rowClassName={() => 'cursor-pointer'}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default QuoteDocumentTemplatesPage;
