// InvoiceTemplates.tsx
import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { getInvoiceTemplates, saveInvoiceTemplate, setDefaultTemplate } from 'server/src/lib/actions/invoiceTemplates';
import { IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces';
import InvoiceTemplateManager from './InvoiceTemplateManager';
import { FileTextIcon } from 'lucide-react';
import { GearIcon, CheckCircledIcon } from '@radix-ui/react-icons';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

const InvoiceTemplates: React.FC = () => {
  const [invoiceTemplates, setInvoiceTemplates] = useState<IInvoiceTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<IInvoiceTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  
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
      setSelectedTemplate(savedTemplate);
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

  const handleTemplateSelect = (template: IInvoiceTemplate) => {
    setSelectedTemplate(template);
  };

  const handleTemplateUpdate = async (updatedTemplate: IInvoiceTemplate) => {
    try {
      await fetchTemplates();
      setSelectedTemplate(updatedTemplate);
      setError(null);
    } catch (error) {
      console.error('Error updating templates:', error);
      setError('Failed to refresh templates');
    }
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
            id="clone-template-button"
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
              id="set-default-template-button"
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
          <DataTable
            data={invoiceTemplates}
            columns={templateColumns}
            pagination={false}
            onRowClick={handleTemplateSelect}
          />
          {selectedTemplate && (
            <InvoiceTemplateManager
              templates={invoiceTemplates}
              onTemplateSelect={handleTemplateSelect}
              onTemplateUpdate={handleTemplateUpdate}
              selectedTemplate={selectedTemplate}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default InvoiceTemplates;
