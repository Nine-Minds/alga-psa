'use client';

import React, { useState, useEffect } from 'react';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import { Plus, Copy, Trash } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IProjectTemplate } from 'server/src/interfaces/projectTemplate.interfaces';
import { toast } from 'react-hot-toast';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { getTemplates, getTemplateCategories, deleteTemplate } from 'server/src/lib/actions/project-actions/projectTemplateActions';
import CreateTemplateDialog from 'server/src/components/projects/project-templates/CreateTemplateDialog';
import AddTemplateDialog from 'server/src/components/projects/project-templates/AddTemplateDialog';
import { useUserPreference } from 'server/src/hooks/useUserPreference';

const PROJECT_TEMPLATES_PAGE_SIZE_KEY = 'project_templates_page_size';

interface ProjectTemplatesListProps {
  initialTemplates: IProjectTemplate[];
  initialCategories: string[];
}

export default function ProjectTemplatesList({ initialTemplates, initialCategories }: ProjectTemplatesListProps) {
  const router = useRouter();
  const [templates, setTemplates] = useState<IProjectTemplate[]>(initialTemplates);
  const [categories] = useState<string[]>(initialCategories);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const {
    value: pageSize,
    setValue: setPageSize
  } = useUserPreference<number>(PROJECT_TEMPLATES_PAGE_SIZE_KEY, {
    defaultValue: 10,
    localStorageKey: PROJECT_TEMPLATES_PAGE_SIZE_KEY,
  });

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  useEffect(() => {
    loadData();
  }, [selectedCategory, searchTerm]);

  async function loadData() {
    try {
      setLoading(true);

      const templatesData = await getTemplates({
        category: selectedCategory || undefined,
        search: searchTerm || undefined
      });

      setTemplates(templatesData);
    } catch (error) {
      toast.error('Failed to load templates');
      console.error('Error loading templates:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(templateId: string) {
    if (!confirm('Are you sure you want to delete this template?')) {
      return;
    }

    try {
      await deleteTemplate(templateId);
      toast.success('Template deleted successfully');
      loadData();
    } catch (error) {
      toast.error('Failed to delete template');
      console.error('Error deleting template:', error);
    }
  }

  const columns: ColumnDefinition<IProjectTemplate>[] = [
    {
      title: 'Name',
      dataIndex: 'template_name',
      render: (value, row) => (
        <Link
          id={`view-template-${row.template_id}`}
          href={`/msp/projects/templates/${row.template_id}`}
          className="text-blue-600 hover:underline"
        >
          {value as string}
        </Link>
      )
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (value) => (value as string) || '-'
    },
    {
      title: 'Category',
      dataIndex: 'category',
      render: (value) => (value as string) || '-'
    },
    {
      title: 'Times Used',
      dataIndex: 'use_count',
      render: (value) => value as number
    },
    {
      title: 'Last Used',
      dataIndex: 'last_used_at',
      render: (value) =>
        value
          ? new Date(value as string).toLocaleDateString()
          : 'Never'
    },
    {
      title: 'Actions',
      dataIndex: 'template_id',
      render: (_value, row) => (
        <Button
          id={`delete-template-${row.template_id}`}
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(row.template_id);
          }}
          label="Delete"
        >
          <Trash className="h-4 w-4" />
        </Button>
      )
    }
  ];

  return (
    <>
      {showCreateDialog && (
        <CreateTemplateDialog
          onClose={() => setShowCreateDialog(false)}
          onTemplateCreated={(templateId) => {
            loadData();
            router.push(`/msp/projects/templates/${templateId}`);
          }}
        />
      )}

      {showAddDialog && (
        <AddTemplateDialog
          onClose={() => setShowAddDialog(false)}
          onTemplateCreated={(templateId) => {
            loadData();
            router.push(`/msp/projects/templates/${templateId}`);
          }}
        />
      )}

      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Project Templates</h1>
          <div className="flex gap-2">
            <Button
              id="add-template"
              onClick={() => setShowAddDialog(true)}
              variant="outline"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Template
            </Button>
            <Button
              id="create-template-from-project"
              onClick={() => setShowCreateDialog(true)}
            >
              <Copy className="h-4 w-4 mr-2" />
              Create from Project
            </Button>
          </div>
        </div>

      <div className="flex gap-4 mb-6">
        <div className="w-80">
          <Input
            id="search-templates"
            type="text"
            placeholder="Search templates..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="w-64">
          <CustomSelect
            id="category-filter"
            value={selectedCategory}
            onValueChange={setSelectedCategory}
            options={[
              { value: '', label: 'All Categories' },
              ...categories.map(cat => ({ value: cat, label: cat }))
            ]}
            placeholder="Filter by category"
          />
        </div>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <DataTable
          id="project-templates-table"
          data={templates}
          columns={columns}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />
      )}
      </div>
    </>
  );
}
