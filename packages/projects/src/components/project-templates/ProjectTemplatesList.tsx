'use client';

import React, { useState, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { Plus, Trash, MoreVertical, Pencil, Play, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IProjectTemplate } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import { ColumnDefinition } from '@alga-psa/types';
import { getTemplates, getTemplateCategories, deleteTemplate } from '../../actions/projectTemplateActions';
import CreateTemplateDialog from './CreateTemplateDialog';
import AddTemplateDialog from './AddTemplateDialog';
import { ApplyTemplateDialog } from './ApplyTemplateDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { useUserPreference } from '@alga-psa/ui';

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
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [selectedTemplateForApply, setSelectedTemplateForApply] = useState<IProjectTemplate | null>(null);
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

  function handleApply(template: IProjectTemplate) {
    setSelectedTemplateForApply(template);
    setShowApplyDialog(true);
  }

  const columns: ColumnDefinition<IProjectTemplate>[] = [
    {
      title: 'Name',
      dataIndex: 'template_name',
      width: '25%',
      render: (value, row) => (
        <Link
          id={`view-template-${row.template_id}`}
          href={`/msp/projects/templates/${row.template_id}`}
          className="text-blue-600 hover:underline block truncate"
          title={value as string}
        >
          {value as string}
        </Link>
      )
    },
    {
      title: 'Description',
      dataIndex: 'description',
      width: '30%',
      render: (value) => (
        <span className="block truncate" title={(value as string) || ''}>
          {(value as string) || '-'}
        </span>
      )
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`template-actions-${row.template_id}`}
              variant="ghost"
              size="sm"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              onClick={() => router.push(`/msp/projects/templates/${row.template_id}`)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleApply(row)}>
              <Play className="mr-2 h-4 w-4" />
              Apply Template
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleDelete(row.template_id)}
              className="text-red-600"
            >
              <Trash className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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

      <ApplyTemplateDialog
        open={showApplyDialog}
        onClose={() => {
          setShowApplyDialog(false);
          setSelectedTemplateForApply(null);
        }}
        onSuccess={(projectId) => {
          setShowApplyDialog(false);
          setSelectedTemplateForApply(null);
          loadData(); // Refresh to update use_count
          router.push(`/msp/projects/${projectId}`);
        }}
        initialTemplateId={selectedTemplateForApply?.template_id}
      />

      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Project Templates</h1>
          <div className="flex gap-2">
            <Button
              id="apply-template"
              onClick={() => {
                setSelectedTemplateForApply(null);
                setShowApplyDialog(true);
              }}
              variant="outline"
            >
              <Play className="h-4 w-4 mr-2" />
              Apply Template
            </Button>
            <Button
              id="add-template"
              onClick={() => setShowAddDialog(true)}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
            >
              <Wand2 className="h-4 w-4 mr-2" />
              Add Template
            </Button>
            <Button
              id="create-template-from-project"
              onClick={() => setShowCreateDialog(true)}
              variant="default"
            >
              <Plus className="h-4 w-4" />
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
