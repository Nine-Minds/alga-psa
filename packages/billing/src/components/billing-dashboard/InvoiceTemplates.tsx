'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import {
  getInvoiceTemplates,
  saveInvoiceTemplate,
  setDefaultTemplate,
  deleteInvoiceTemplate,
} from '@alga-psa/billing/actions/invoiceTemplates';
import type { DeletionValidationResult, IInvoiceTemplate } from '@alga-psa/types';
import { FileTextIcon, MoreVertical, Settings, CheckCircle2 } from 'lucide-react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const InvoiceTemplates: React.FC = () => {
  const { t } = useTranslation('msp/invoicing');
  const [invoiceTemplates, setInvoiceTemplates] = useState<IInvoiceTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [templateToDeleteId, setTemplateToDeleteId] = useState<string | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const templateToDeleteName = useMemo(() => {
    if (!templateToDeleteId) {
      return t('templates.values.thisTemplate', {
        defaultValue: 'this template',
      });
    }

    return invoiceTemplates.find((template) => template.template_id === templateToDeleteId)?.name || t('templates.values.thisTemplate', {
      defaultValue: 'this template',
    });
  }, [invoiceTemplates, templateToDeleteId, t]);

  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const templates = await getInvoiceTemplates();
      setInvoiceTemplates(templates);
      setError(null);
    } catch (fetchError) {
      console.error('Error fetching invoice templates:', fetchError);
      setError(t('templates.errors.fetchFailed', {
        defaultValue: 'Failed to fetch templates.',
      }));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const handleNavigateToEditor = (templateId: string | 'new') => {
    const params = new URLSearchParams(window.location.search);
    params.set('templateId', templateId);
    router.push(`/msp/billing?${params.toString()}`);
  };

  const handleCloneTemplate = async (template: IInvoiceTemplate) => {
    try {
      await saveInvoiceTemplate({
        ...template,
        name: `${template.name}${t('templates.values.copySuffix', {
          defaultValue: ' (Copy)',
        })}`,
        isClone: true,
        isStandard: false,
      });
      await fetchTemplates();
      setError(null);
    } catch (cloneError) {
      console.error('Error cloning template:', cloneError);
      setError(t('templates.errors.cloneFailed', {
        defaultValue: 'Failed to clone template.',
      }));
    }
  };

  const handleCloneAndEdit = async (template: IInvoiceTemplate) => {
    try {
      const savedResult = await saveInvoiceTemplate({
        ...template,
        name: t('templates.values.copyOfName', {
          name: template.name,
          defaultValue: 'Copy of {{name}}',
        }),
        isClone: true,
        isStandard: false,
      });

      if (savedResult.success && savedResult.template?.template_id) {
        handleNavigateToEditor(savedResult.template.template_id);
      } else {
        setError(savedResult.error || t('templates.errors.cloneEditFailed', {
          defaultValue: 'Failed to create editable copy.',
        }));
      }
    } catch (cloneError) {
      console.error('Error creating editable copy:', cloneError);
      setError(t('templates.errors.cloneEditFailed', {
        defaultValue: 'Failed to create editable copy.',
      }));
    }
  };

  const handleSetDefaultTemplate = async (template: IInvoiceTemplate) => {
    try {
      if (template.templateSource === 'standard' || template.isStandard) {
        if (!template.standard_invoice_template_code) {
          throw new Error('Standard template is missing a template code');
        }

        await setDefaultTemplate({
          templateSource: 'standard',
          standardTemplateCode: template.standard_invoice_template_code,
        });
      } else {
        await setDefaultTemplate({
          templateSource: 'custom',
          templateId: template.template_id,
        });
      }

      await fetchTemplates();
      setError(null);
    } catch (setDefaultError) {
      console.error('Error setting default template:', setDefaultError);
      setError(t('templates.errors.setDefaultFailed', {
        defaultValue: 'Failed to set template as default.',
      }));
    }
  };

  const resetDeleteState = () => {
    setTemplateToDeleteId(null);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleteProcessing(false);
  };

  const runDeleteValidation = useCallback(async (templateId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('invoice_template', templateId);
      setDeleteValidation(result);
    } catch (validationError) {
      console.error('Error validating invoice template deletion:', validationError);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('templates.errors.deleteValidationFailed', {
          defaultValue: 'Failed to validate deletion. Please try again.',
        }),
        dependencies: [],
        alternatives: [],
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [t]);

  const handleDeleteTemplate = async () => {
    if (!templateToDeleteId) {
      return;
    }

    setIsDeleteProcessing(true);
    try {
      const result = await deleteInvoiceTemplate(templateToDeleteId);

      if (!result.success) {
        setDeleteValidation(result);
        return;
      }

      resetDeleteState();
      await fetchTemplates();
    } catch (deleteError) {
      console.error('Error deleting template:', deleteError);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('templates.errors.deleteUnexpected', {
          defaultValue: 'An unexpected error occurred while deleting the template.',
        }),
        dependencies: [],
        alternatives: [],
      });
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const templateColumns: ColumnDefinition<IInvoiceTemplate>[] = [
    {
      title: t('templates.columns.templateName', {
        defaultValue: 'Template Name',
      }),
      dataIndex: 'name',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          {record.isStandard ? (
            <>
              <FileTextIcon className="w-4 h-4" /> {value}
              {t('templates.values.standardSuffix', {
                defaultValue: ' (Standard)',
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
      title: t('templates.columns.type', { defaultValue: 'Type' }),
      dataIndex: 'isStandard',
      render: (value) => value
        ? t('templates.types.standard', { defaultValue: 'Standard' })
        : t('templates.types.custom', { defaultValue: 'Custom' }),
    },
    {
      title: t('templates.columns.default', { defaultValue: 'Default' }),
      dataIndex: 'isTenantDefault',
      headerClassName: 'text-center align-middle',
      cellClassName: 'text-center align-middle max-w-none',
      render: (_, record) =>
        record.isTenantDefault ? (
          <div className="flex justify-center items-center">
            <CheckCircle2 className="h-4 w-4 text-primary-500" />
          </div>
        ) : null,
    },
    {
      title: t('templates.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'template_id',
      width: '10%',
      render: (_, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="invoice-template-actions-menu"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">
                {t('templates.actions.openMenu', {
                  defaultValue: 'Open menu',
                })}
              </span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id="edit-invoice-template-menu-item"
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
                ? t('templates.actions.editAsCopy', {
                  defaultValue: 'Edit as Copy',
                })
                : t('templates.actions.edit', {
                  defaultValue: 'Edit',
                })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="clone-invoice-template-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                void handleCloneTemplate(record);
              }}
            >
              {t('templates.actions.clone', { defaultValue: 'Clone' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="set-default-invoice-template-menu-item"
              disabled={record.isTenantDefault}
              onClick={(e) => {
                e.stopPropagation();
                void handleSetDefaultTemplate(record);
              }}
            >
              {t('templates.actions.setDefault', {
                defaultValue: 'Set as Default',
              })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-invoice-template-menu-item"
              className="text-red-600 focus:text-red-600"
              disabled={record.isStandard}
              onClick={(e) => {
                e.stopPropagation();
                setTemplateToDeleteId(record.template_id);
                void runDeleteValidation(record.template_id);
              }}
            >
              {t('templates.actions.delete', { defaultValue: 'Delete' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">
          {t('templates.title', { defaultValue: 'Invoice Layouts' })}
        </h3>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {isLoading ? (
          <LoadingIndicator
            layout="stacked"
            className="py-10 text-muted-foreground"
            spinnerProps={{ size: 'md' }}
            text={t('templates.loading', {
              defaultValue: 'Loading invoice layouts',
            })}
          />
        ) : (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button
                id="create-new-template-button"
                onClick={() => handleNavigateToEditor('new')}
              >
                {t('templates.actions.create', {
                  defaultValue: 'Create New Layout',
                })}
              </Button>
            </div>
            <DataTable
              id="invoice-templates-table"
              data={invoiceTemplates}
              columns={templateColumns}
              onRowClick={(record) => {
                if (record.isStandard) {
                  void handleCloneAndEdit(record);
                } else {
                  handleNavigateToEditor(record.template_id);
                }
              }}
            />
          </div>
        )}
      </CardContent>
      <DeleteEntityDialog
        id="delete-template-dialog"
        isOpen={Boolean(templateToDeleteId)}
        onClose={resetDeleteState}
        onConfirmDelete={handleDeleteTemplate}
        entityName={templateToDeleteName}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />
    </Card>
  );
};

export default InvoiceTemplates;
