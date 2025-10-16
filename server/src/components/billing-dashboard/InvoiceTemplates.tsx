// InvoiceTemplates.tsx
import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; // Added router and searchParams import
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogDescription,
  DialogFooter,
} from 'server/src/components/ui/Dialog'; // Added Dialog imports
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { getInvoiceTemplates, saveInvoiceTemplate, setDefaultTemplate, deleteInvoiceTemplate } from 'server/src/lib/actions/invoiceTemplates'; // Added deleteInvoiceTemplate import
import { IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces';
// Removed InvoiceTemplateManager import
import { FileTextIcon, PencilIcon, MoreVertical } from 'lucide-react'; // Added PencilIcon and MoreVertical imports
import { GearIcon, CheckCircledIcon } from '@radix-ui/react-icons';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

const InvoiceTemplates: React.FC = () => {
  const [invoiceTemplates, setInvoiceTemplates] = useState<IInvoiceTemplate[]>([]);
  // Removed selectedTemplate state
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null); // State for delete-specific errors
  const [templateToDeleteId, setTemplateToDeleteId] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter(); // Initialize router

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
                setIsDeleteDialogOpen(true);
                setDeleteError(null); // Clear previous delete errors
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
    ),
  },
];

const handleDeleteTemplate = async () => {
  if (!templateToDeleteId) return;

  try {
    setDeleteError(null); // Clear previous errors
    const result = await deleteInvoiceTemplate(templateToDeleteId);

    if (result.success) {
      setIsDeleteDialogOpen(false);
      setTemplateToDeleteId(null);
      await fetchTemplates(); // Refresh the list
      // Optional: Show success notification
    } else {
      setDeleteError(result.error || 'Failed to delete template.');
    }
  } catch (err) {
    console.error('Error deleting template:', err);
    setDeleteError('An unexpected error occurred while deleting the template.');
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
      {/* Confirmation Dialog */}
      <Dialog 
        id="delete-template-dialog" 
        isOpen={isDeleteDialogOpen} 
        onClose={() => setIsDeleteDialogOpen(false)} 
        title="Confirm Deletion"
      >
        <DialogContent>
          <DialogDescription>
            Are you sure you want to delete the template "{invoiceTemplates.find(t => t.template_id === templateToDeleteId)?.name || 'this template'}"?
            This action cannot be undone.
            {deleteError && (
              <p className="text-red-600 mt-2">{deleteError}</p>
            )}
          </DialogDescription>
          <DialogFooter>
            <Button
              id="cancel-delete-template-button"
              variant="outline"
              onClick={() => {
                setIsDeleteDialogOpen(false);
                setDeleteError(null);
              }}>Cancel</Button>
            <Button
              id="confirm-delete-template-button"
              variant="destructive"
              onClick={handleDeleteTemplate}
              disabled={!!deleteError} // Disable if there was an error during the attempt
            >
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default InvoiceTemplates;
