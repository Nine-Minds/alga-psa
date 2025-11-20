'use client';

import React, { useState, useEffect } from 'react';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import CustomSelect from '@/components/ui/CustomSelect';
import { Input } from '@/components/ui/Input';
import { Plus, Copy, Trash } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { IProjectTemplate } from '@/interfaces/projectTemplate.interfaces';
import { toast } from 'react-hot-toast';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';

export default function ProjectTemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<IProjectTemplate[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [selectedCategory, searchTerm]);

  async function loadData() {
    try {
      setLoading(true);

      // Build query params for templates
      const templatesParams = new URLSearchParams();
      if (selectedCategory) templatesParams.set('category', selectedCategory);
      if (searchTerm) templatesParams.set('search', searchTerm);

      const [templatesRes, categoriesRes] = await Promise.all([
        fetch(`/api/projects/templates?${templatesParams}`),
        fetch('/api/projects/templates/categories')
      ]);

      if (!templatesRes.ok || !categoriesRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const templatesData = await templatesRes.json();
      const categoriesData = await categoriesRes.json();

      setTemplates(templatesData);
      setCategories(categoriesData);
    } catch (error) {
      toast.error('Failed to load templates');
      console.error('Error loading templates:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDuplicate(templateId: string) {
    try {
      const response = await fetch(`/api/projects/templates/${templateId}/duplicate`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to duplicate template');
      }

      const { template_id } = await response.json();
      toast.success('Template duplicated successfully');
      loadData();
    } catch (error) {
      toast.error('Failed to duplicate template');
      console.error('Error duplicating template:', error);
    }
  }

  async function handleDelete(templateId: string) {
    if (!confirm('Are you sure you want to delete this template?')) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/templates/${templateId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete template');
      }

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
        <button
          id={`view-template-${row.template_id}`}
          onClick={() => router.push(`/msp/projects/templates/${row.template_id}`)}
          className="text-primary-500 hover:underline"
        >
          {value as string}
        </button>
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
      render: (value, row) => (
        <div className="flex gap-2">
          <Button
            id={`duplicate-template-${row.template_id}`}
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              handleDuplicate(row.template_id);
            }}
            label="Duplicate"
          >
            <Copy className="h-4 w-4" />
          </Button>
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
        </div>
      )
    }
  ];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Project Templates</h1>
        <Button
          id="create-template-from-project"
          onClick={() => router.push('/msp/projects/templates/create')}
        >
          <Plus className="h-4 w-4 mr-2" />
          Create from Project
        </Button>
      </div>

      <div className="flex gap-4 mb-6">
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
        <div className="flex-1">
          <Input
            id="search-templates"
            type="text"
            placeholder="Search templates..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <DataTable
        id="project-templates-table"
        data={templates}
        columns={columns}
        pagination={true}
        pageSize={10}
      />
    </div>
  );
}
