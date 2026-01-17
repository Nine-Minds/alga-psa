'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { IProject } from 'server/src/interfaces/project.interfaces';
import { toast } from 'react-hot-toast';
import { createTemplateFromProject } from '../../actions/projectTemplateActions';

interface CreateTemplateFormProps {
  projects: IProject[];
  categories: string[];
}

export default function CreateTemplateForm({ projects, categories }: CreateTemplateFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    project_id: '',
    template_name: '',
    description: '',
    category: ''
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.project_id || !formData.template_name) {
      toast.error('Project and template name are required');
      return;
    }

    try {
      setLoading(true);

      const templateId = await createTemplateFromProject(formData.project_id, {
        template_name: formData.template_name,
        description: formData.description || undefined,
        category: formData.category || undefined
      });

      toast.success('Template created successfully');
      router.push(`/msp/projects/templates/${templateId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create template');
      console.error('Error creating template:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create Template from Project</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Source Project *
          </label>
          <CustomSelect
            id="source-project"
            value={formData.project_id}
            onValueChange={(value) => setFormData({ ...formData, project_id: value })}
            options={projects.map(p => ({
              value: p.project_id,
              label: `${p.project_name} (${p.wbs_code})`
            }))}
            placeholder="Select a project"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Template Name *
          </label>
          <Input
            id="template-name"
            value={formData.template_name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, template_name: e.target.value })}
            placeholder="Enter template name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Description
          </label>
          <TextArea
            id="template-description"
            value={formData.description}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Enter template description"
            rows={4}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Category
          </label>
          <Input
            id="template-category"
            value={formData.category}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, category: e.target.value })}
            placeholder="e.g., Software Development, Network Setup"
            list="category-suggestions"
          />
          <datalist id="category-suggestions">
            {categories.map(cat => (
              <option key={cat} value={cat} />
            ))}
          </datalist>
        </div>

        <div className="flex gap-4">
          <Button
            id="create-template-submit"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Creating...' : 'Create Template'}
          </Button>
          <Button
            id="cancel-create-template"
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
