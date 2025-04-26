// InvoiceTemplates.tsx
import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; // Added router and searchParams import
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { getInvoiceTemplates, saveInvoiceTemplate, setDefaultTemplate } from 'server/src/lib/actions/invoiceTemplates';
import { IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces';
// Removed InvoiceTemplateManager import
import { FileTextIcon, PencilIcon } from 'lucide-react'; // Added PencilIcon import
import { GearIcon, CheckCircledIcon } from '@radix-ui/react-icons';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

const InvoiceTemplates: React.FC = () => {
  const [invoiceTemplates, setInvoiceTemplates] = useState<IInvoiceTemplate[]>([]);
  // Removed selectedTemplate state
  const [error, setError] = useState<string | null>(null);
  const router = useRouter(); // Initialize router
const searchParams = useSearchParams(); // Initialize searchParams

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
      await setDefaultTemplate(template.template_id);
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
    try {
      const templates = await getInvoiceTemplates();
      setInvoiceTemplates(templates);
      setError(null);
    } catch (error) {
      console.error('Error fetching invoice templates:', error);
      setError('Failed to fetch invoice templates');
    }
  };

  // Ensure handleTemplateSelect and handleTemplateUpdate are removed if they exist

  const handleNavigateToEditor = (templateId: string | 'new') => {
    const params = new URLSearchParams(searchParams?.toString() ?? ''); // Keep existing params like 'tab'
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
      dataIndex: 'is_default',
      render: (value) => value ? <CheckCircledIcon className="w-4 h-4 text-blue-500" /> : null,
    },
    {
      title: 'Actions',
      dataIndex: 'template_id',
      width: '10%',
      render: (_, record) => (
        <div className="flex gap-2">
           <Button
             id={`edit-template-${record.template_id}-button`}
             onClick={(e) => {
               e.stopPropagation();
               handleNavigateToEditor(record.template_id);
             }}
             variant="outline"
             size="sm"
             disabled={record.isStandard} // Disable for standard templates
             title={record.isStandard ? "Standard templates cannot be edited" : "Edit Template"}
           >
             <PencilIcon className="h-4 w-4 mr-1" /> Edit
           </Button>
          <Button
            id={`clone-template-${record.template_id}-button`}
            onClick={(e) => {
              e.stopPropagation();
              handleCloneTemplate(record);
            }}
            variant="outline"
            size="sm"
          >
            Clone
          </Button>
          {!record.isStandard && (
            <Button
              id={`set-default-template-${record.template_id}-button`}
              onClick={(e) => {
                e.stopPropagation();
                handleSetDefaultTemplate(record);
              }}
              variant="outline"
              size="sm"
              disabled={record.is_default}
            >
              {record.is_default ? 'Default' : 'Set as Default'}
            </Button>
          )}
        </div>
      ),
    },
  ];

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
            // Ensure onRowClick is removed
            // Ensure InvoiceTemplateManager rendering is removed
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default InvoiceTemplates;
