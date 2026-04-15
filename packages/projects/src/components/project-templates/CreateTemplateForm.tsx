'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { IProject } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { createTemplateFromProject } from '../../actions/projectTemplateActions';
import { useTranslation } from 'react-i18next';

interface CreateTemplateFormProps {
  projects: IProject[];
  categories: string[];
}

export default function CreateTemplateForm({ projects, categories }: CreateTemplateFormProps) {
  const { t } = useTranslation(['features/projects', 'common']);
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
      toast.error(t('templates.create.projectRequired', 'Project and template name are required'));
      return;
    }

    try {
      setLoading(true);

      const templateId = await createTemplateFromProject(formData.project_id, {
        template_name: formData.template_name,
        description: formData.description || undefined,
        category: formData.category || undefined
      });

      toast.success(t('templates.create.createdSuccess', 'Template created successfully'));
      router.push(`/msp/projects/templates/${templateId}`);
    } catch (error) {
      handleError(error, t('templates.create.createFailed', 'Failed to create template'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">
        {t('templates.create.title', 'Create Template from Project')}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            {t('templates.create.sourceProjectLabel', 'Source Project *')}
          </label>
          <CustomSelect
            id="source-project"
            value={formData.project_id}
            onValueChange={(value) => setFormData({ ...formData, project_id: value })}
            options={projects.map(p => ({
              value: p.project_id,
              label: `${p.project_name} (${p.wbs_code})`
            }))}
            placeholder={t('templates.create.sourceProjectPlaceholder', 'Select a project')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            {t('templates.create.templateNameLabel', 'Template Name *')}
          </label>
          <Input
            id="template-name"
            value={formData.template_name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, template_name: e.target.value })}
            placeholder={t('templates.create.templateNamePlaceholder', 'Enter template name')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            {t('templates.create.descriptionLabel', 'Description')}
          </label>
          <TextArea
            id="template-description"
            value={formData.description}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData({ ...formData, description: e.target.value })}
            placeholder={t('templates.create.descriptionPlaceholder', 'Enter template description')}
            rows={4}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            {t('templates.create.categoryLabel', 'Category')}
          </label>
          <Input
            id="template-category"
            value={formData.category}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, category: e.target.value })}
            placeholder={t('templates.create.categoryPlaceholder', 'e.g., Software Development, Network Setup')}
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
            {loading
              ? t('templates.create.creating', 'Creating...')
              : t('templates.create.create', 'Create Template')}
          </Button>
          <Button
            id="cancel-create-template"
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            {t('common:actions.cancel', 'Cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}
