'use client'

// InvoiceTemplates.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; // Added router and searchParams import
import { Card, CardHeader, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { getInvoiceTemplates, saveInvoiceTemplate, setDefaultTemplate, deleteInvoiceTemplate } from '@alga-psa/billing/actions/invoiceTemplates'; // Added deleteInvoiceTemplate import
import { IInvoiceTemplate, DeletionValidationResult } from '@alga-psa/types';
// Removed InvoiceTemplateManager import
import { FileTextIcon, PencilIcon, MoreVertical } from 'lucide-react'; // Added PencilIcon and MoreVertical imports
import { GearIcon, CheckCircledIcon } from '@radix-ui/react-icons';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { preCheckDeletion } from '@alga-psa/core';

const InvoiceTemplates: React.FC = () => {
  const [invoiceTemplates, setInvoiceTemplates] = useState<IInvoiceTemplate[]>([]);
  // Removed selectedTemplate state
  const [error, setError] = useState<string | null>(null);
  const [templateToDeleteId, setTemplateToDeleteId] = useState<string | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter(); // Initialize router
  const templateToDeleteName = useMemo(() => {
    if (!templateToDeleteId) {
      return 'this template';
    }
    return invoiceTemplates.find((template) => template.template_id === templateToDeleteId)?.name || 'this template';
  }, [invoiceTemplates, templateToDeleteId]);

  const handleCloneTemplate = async (template: IInvoiceTemplate) => {
    try {
      const clonedTemplate = {
        ...template,
        name: `${template.name} (Copy)`,
        isClone: true,
        isStandard: false
      };
      const savedTemplate = await saveInvoiceTemplate(clonedTemplate);
      await fetchTemplates();
      // Removed setSelectedTemplate(savedTemplate); as the state is no longer used
      setError(null);
    } catch (error) {
      console.error('Error cloning template:', error);
      setError('Failed to clone template');
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
    } catch (error) {
      console.error('Error setting default template:', error);
      setError('Failed to set default template');
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setIsLoading(true);
    try {
      const templates = await getInvoiceTemplates();
      setInvoiceTemplates(templates);
      setError(null);
    } catch (error) {
      console.error('Error fetching invoice templates:', error);
      setError('Failed to fetch invoice templates');
    } finally {
      setIsLoading(false);
    }
  };

  // Ensure handleTemplateSelect and handleTemplateUpdate are removed if they exist

  const handleNavigateToEditor = (templateId: string | 'new') => {
    const params = new URLSearchParams(window.location.search); // Use window.location.search
    params.set('templateId', templateId);
    router.push(`/msp/billing?${params.toString()}`);
  };

  const templateColumns: ColumnDefinition<IInvoiceTemplate>[] = [
    {
      title: 'Template Name',
      dataIndex: 'name',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          {record.isStandard ? (
            <><FileTextIcon className="w-4 h-4" /> {value} (Standard)</>
          ) : (
            <div className="flex items-center gap-1">
              <GearIcon className="w-4 h-4" />
              {value}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'isStandard',
      render: (value) => value ? 'Standard' : 'Custom',
    },
    {
      title: 'Default',
      dataIndex: 'isTenantDefault',
      headerClassName: 'text-center align-middle',
      cellClassName: 'text-center align-middle max-w-none',
      render: (_, record) =>
        record.isTenantDefault ? (
          <div className="flex justify-center items-center">
            <CheckCircledIcon className="h-4 w-4 text-primary-500" />
          </div>
        ) : null,
    },
    {
      title: 'Actions',
      dataIndex: 'template_id',
      width: '10%',
      render: (_, record) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id="invoice-template-actions-menu" // Per standard: {object}-actions-menu
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={(e) => e.stopPropagation()} // Prevent row click
              >
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id="edit-invoice-template-menu-item" // Per standard: edit-{object}-menu-item
                disabled={record.isStandard}
                onClick={(e) => {
                  e.stopPropagation();
                  handleNavigateToEditor(record.template_id);
                }}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                id="clone-invoice-template-menu-item" // Per standard: clone-{object}-menu-item
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloneTemplate(record);
                }}
              >
                Clone
              </DropdownMenuItem>
              <DropdownMenuItem
                id="set-default-invoice-template-menu-item" // Per standard: set-default-{object}-menu-item
                disabled={record.isTenantDefault}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSetDefaultTemplate(record);
                }}
              >
                Set as Default
              </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-invoice-template-menu-item" // Per standard: delete-{object}-menu-item
              className="text-red-600 focus:text-red-600" // Destructive styling
              disabled={record.isStandard} // Cannot delete standard templates
              onClick={(e) => {
                e.stopPropagation();
                setTemplateToDeleteId(record.template_id);
                void runDeleteValidation(record.template_id);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
    ),
  },
];

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
  } catch (err) {
    console.error('Error validating invoice template deletion:', err);
    setDeleteValidation({
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: 'Failed to validate deletion. Please try again.',
      dependencies: [],
      alternatives: []
    });
  } finally {
    setIsDeleteValidating(false);
  }
}, []);

const handleDeleteTemplate = async () => {
  if (!templateToDeleteId) return;

  setIsDeleteProcessing(true);
  try {
    const result = await deleteInvoiceTemplate(templateToDeleteId);

    if (!result.success) {
      setDeleteValidation(result);
      return;
    }

    resetDeleteState();
    await fetchTemplates(); // Refresh the list
  } catch (err) {
    console.error('Error deleting template:', err);
    setDeleteValidation({
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: 'An unexpected error occurred while deleting the template.',
      dependencies: [],
      alternatives: []
    });
  } finally {
    setIsDeleteProcessing(false);
  }
};

return (
  <Card>
    <CardHeader>
        <h3 className="text-lg font-semibold">Invoice Templates</h3>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
            {error}
          </div>
        )}
        {isLoading ? (
          <LoadingIndicator
            layout="stacked"
            className="py-10 text-gray-600"
            spinnerProps={{ size: 'md' }}
            text="Loading invoice templates"
          />
        ) : (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button
                id="create-new-template-button"
                onClick={() => handleNavigateToEditor('new')}
              >
                Create New Template
              </Button>
            </div>
            <DataTable
              id="invoice-templates-table"
              data={invoiceTemplates}
              columns={templateColumns}
              pagination={false}
              onRowClick={(record) => {
                if (!record.isStandard) {
                  handleNavigateToEditor(record.template_id);
                }
              }}
              // Ensure InvoiceTemplateManager rendering is removed
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
