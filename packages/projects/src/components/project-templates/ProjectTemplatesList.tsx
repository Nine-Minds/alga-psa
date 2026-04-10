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
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
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
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import { useTranslation } from 'react-i18next';

const PROJECT_TEMPLATES_PAGE_SIZE_KEY = 'project_templates_page_size';

interface ProjectTemplatesListProps {
  initialTemplates: IProjectTemplate[];
  initialCategories: string[];
}

export default function ProjectTemplatesList({ initialTemplates, initialCategories }: ProjectTemplatesListProps) {
  const { t } = useTranslation(['features/projects', 'common']);
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
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ templateId: string; templateName: string } | null>(null);
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
      handleError(error, t('templates.list.loadFailed', 'Failed to load templates'));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteConfirmation) return;
    try {
      await deleteTemplate(deleteConfirmation.templateId);
      toast.success(t('templates.list.deletedSuccess', 'Template deleted successfully'));
      loadData();
    } catch (error) {
      handleError(error, t('templates.list.deleteFailed', 'Failed to delete template'));
    } finally {
      setDeleteConfirmation(null);
    }
  }

  function handleApply(template: IProjectTemplate) {
    setSelectedTemplateForApply(template);
    setShowApplyDialog(true);
  }

  const columns: ColumnDefinition<IProjectTemplate>[] = [
    {
      title: t('templates.list.columns.name', 'Name'),
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
      title: t('templates.list.columns.description', 'Description'),
      dataIndex: 'description',
      width: '30%',
      render: (value) => (
        <span className="block truncate" title={(value as string) || ''}>
          {(value as string) || '-'}
        </span>
      )
    },
    {
      title: t('templates.list.columns.category', 'Category'),
      dataIndex: 'category',
      render: (value) => (value as string) || '-'
    },
    {
      title: t('templates.list.columns.timesUsed', 'Times Used'),
      dataIndex: 'use_count',
      render: (value) => value as number
    },
    {
      title: t('templates.list.columns.lastUsed', 'Last Used'),
      dataIndex: 'last_used_at',
      render: (value) =>
        value
          ? new Date(value as string).toLocaleDateString()
          : t('templates.list.neverUsed', 'Never')
    },
    {
      title: t('templates.list.columns.actions', 'Actions'),
      dataIndex: 'template_id',
      render: (_value, row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`template-actions-${row.template_id}`}
              variant="ghost"
              size="sm"
              onClick={(e) => e.stopPropagation()}
              aria-label={t('common:actions.openMenu', 'Open menu')}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              onClick={() => router.push(`/msp/projects/templates/${row.template_id}`)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              {t('templates.list.edit', 'Edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleApply(row)}>
              <Play className="mr-2 h-4 w-4" />
              {t('templates.list.applyTemplate', 'Apply Template')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setDeleteConfirmation({ templateId: row.template_id, templateName: row.template_name })}
              className="text-destructive"
            >
              <Trash className="mr-2 h-4 w-4" />
              {t('common:actions.delete', 'Delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  ];

  return (
    <>
      {deleteConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setDeleteConfirmation(null)}
          onConfirm={handleDelete}
          title={t('templates.list.deleteTitle', 'Delete Template')}
          message={t('templates.list.deleteMessage', 'Are you sure you want to delete template "{{templateName}}"? This action cannot be undone.', {
            templateName: deleteConfirmation.templateName,
          })}
          confirmLabel={t('common:actions.delete', 'Delete')}
          cancelLabel={t('common:actions.cancel', 'Cancel')}
        />
      )}

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
          <h1 className="text-2xl font-bold">{t('templates.list.title', 'Project Templates')}</h1>
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
              {t('templates.list.applyTemplate', 'Apply Template')}
            </Button>
            <Button
              id="add-template"
              onClick={() => setShowAddDialog(true)}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
            >
              <Wand2 className="h-4 w-4 mr-2" />
              {t('templates.list.addTemplate', 'Add Template')}
            </Button>
            <Button
              id="create-template-from-project"
              onClick={() => setShowCreateDialog(true)}
              variant="default"
            >
              <Plus className="h-4 w-4" />
              {t('templates.list.createFromProject', 'Create from Project')}
            </Button>
          </div>
        </div>

      <div className="flex gap-4 mb-6">
        <div className="w-80">
          <Input
            id="search-templates"
            type="text"
            placeholder={t('templates.list.searchPlaceholder', 'Search templates...')}
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
              { value: '', label: t('templates.list.allCategories', 'All Categories') },
              ...categories.map(cat => ({ value: cat, label: cat }))
            ]}
            placeholder={t('templates.list.categoryPlaceholder', 'Filter by category')}
          />
        </div>
      </div>

      {loading ? (
        <div>{t('templates.list.loading', 'Loading...')}</div>
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
