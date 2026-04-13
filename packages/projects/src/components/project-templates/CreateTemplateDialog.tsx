'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import type { IProject } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { createTemplateFromProject, getTemplateCategories } from '../../actions/projectTemplateActions';
import { getProjects } from '../../actions/projectActions';
import { useTranslation } from 'react-i18next';

interface CreateTemplateDialogProps {
  onClose: () => void;
  onTemplateCreated?: (templateId: string) => void;
  initialProjectId?: string;
}

const CreateTemplateDialog: React.FC<CreateTemplateDialogProps> = ({ onClose, onTemplateCreated, initialProjectId }) => {
  const { t } = useTranslation(['features/projects', 'common']);
  const [projects, setProjects] = useState<IProject[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const [formData, setFormData] = useState({
    project_id: initialProjectId || '',
    template_name: '',
    description: '',
    category: ''
  });

  const [copyOptions, setCopyOptions] = useState({
    copyPhases: true,
    copyStatuses: true,
    copyTasks: true,
    copyAssignments: false,
    copyChecklists: true,
    copyServices: true
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        console.log('Fetching projects and categories...');
        const [projectsResult, categoriesData] = await Promise.all([
          getProjects(),
          getTemplateCategories()
        ]);
        if (isActionPermissionError(projectsResult)) {
          handleError(projectsResult.permissionError);
          return;
        }
        console.log('Projects loaded:', projectsResult.length);
        console.log('Categories loaded:', categoriesData.length);
        setProjects(projectsResult);
        setCategories(categoriesData);
      } catch (error) {
        handleError(error, t('templates.create.loadFailed', 'Failed to load projects and categories'));
      }
    };
    fetchData();
  }, [t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    if (!formData.project_id || !formData.template_name.trim()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const templateId = await createTemplateFromProject(
        formData.project_id,
        {
          template_name: formData.template_name,
          description: formData.description || undefined,
          category: formData.category || undefined
        },
        copyOptions
      );

      toast.success(t('templates.create.createdSuccess', 'Template created successfully'));

      if (onTemplateCreated) {
        onTemplateCreated(templateId);
      }

      onClose();
    } catch (error) {
      handleError(error, t('templates.create.createFailed', 'Failed to create template'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const footer = (
    <div className="flex justify-between">
      <Button
        id="cancel-button"
        variant="ghost"
        onClick={() => {
          setHasAttemptedSubmit(false);
          onClose();
        }}
        disabled={isSubmitting}
      >
        {t('common:actions.cancel', 'Cancel')}
      </Button>
      <Button
        id="create-button"
        type="button"
        disabled={isSubmitting}
        className={!formData.project_id || !formData.template_name.trim() ? 'opacity-50' : ''}
        onClick={() => (document.getElementById('create-template-dialog-form') as HTMLFormElement | null)?.requestSubmit()}
      >
        {isSubmitting
          ? t('templates.create.creating', 'Creating...')
          : t('templates.create.create', 'Create Template')}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={true}
      onClose={() => {
        setHasAttemptedSubmit(false);
        onClose();
      }}
      title={t('templates.create.title', 'Create Template from Project')}
      className="max-w-[600px]"
      footer={footer}
    >
      <DialogContent>
        <form id="create-template-dialog-form" onSubmit={handleSubmit} className="flex flex-col">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
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
                className={hasAttemptedSubmit && !formData.project_id ? 'ring-1 ring-red-500' : ''}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('templates.create.templateNameLabel', 'Template Name *')}
              </label>
              <Input
                id="template-name"
                value={formData.template_name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, template_name: e.target.value })
                }
                placeholder={t('templates.create.templateNamePlaceholder', 'Enter template name')}
                className={hasAttemptedSubmit && !formData.template_name.trim() ? 'ring-1 ring-red-500' : ''}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('templates.create.descriptionLabel', 'Description')}
              </label>
              <TextArea
                id="template-description"
                value={formData.description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder={t('templates.create.descriptionPlaceholder', 'Enter template description')}
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('templates.create.categoryLabel', 'Category')}
              </label>
              <Input
                id="template-category"
                value={formData.category}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, category: e.target.value })
                }
                placeholder={t('templates.create.categoryPlaceholder', 'e.g., Software Development, Network Setup')}
                list="category-suggestions"
              />
              <datalist id="category-suggestions">
                {categories.map(cat => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>

            <div className="border-t pt-4 mt-2">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                {t('templates.create.whatToInclude', 'What to include from the project:')}
              </label>
              <div className="space-y-3">
                <Checkbox
                  id="copy-phases"
                  label={t('templates.create.copyPhases', 'Copy project phases')}
                  checked={copyOptions.copyPhases}
                  onChange={(e) => setCopyOptions({ ...copyOptions, copyPhases: e.target.checked })}
                />
                <Checkbox
                  id="copy-statuses"
                  label={t('templates.create.copyStatuses', 'Copy project columns/statuses')}
                  checked={copyOptions.copyStatuses}
                  onChange={(e) => setCopyOptions({ ...copyOptions, copyStatuses: e.target.checked })}
                />
                <Checkbox
                  id="copy-tasks"
                  label={t('templates.create.copyTasks', 'Copy project tasks')}
                  checked={copyOptions.copyTasks}
                  onChange={(e) => {
                    setCopyOptions({
                      ...copyOptions,
                      copyTasks: e.target.checked,
                      // Disable dependent options if tasks are disabled
                      copyChecklists: e.target.checked ? copyOptions.copyChecklists : false,
                      copyServices: e.target.checked ? copyOptions.copyServices : false,
                      copyAssignments: e.target.checked ? copyOptions.copyAssignments : false
                    });
                  }}
                />
                <Checkbox
                  id="copy-checklists"
                  label={t('templates.create.copyChecklists', 'Copy task checklists')}
                  checked={copyOptions.copyChecklists}
                  disabled={!copyOptions.copyTasks}
                  onChange={(e) => setCopyOptions({ ...copyOptions, copyChecklists: e.target.checked })}
                />
                <Checkbox
                  id="copy-services"
                  label={t('templates.create.copyServices', 'Copy task services')}
                  checked={copyOptions.copyServices}
                  disabled={!copyOptions.copyTasks}
                  onChange={(e) => setCopyOptions({ ...copyOptions, copyServices: e.target.checked })}
                />
                <Checkbox
                  id="copy-assignments"
                  label={t('templates.create.copyAssignments', 'Copy task assignments')}
                  checked={copyOptions.copyAssignments}
                  disabled={!copyOptions.copyTasks}
                  onChange={(e) => setCopyOptions({ ...copyOptions, copyAssignments: e.target.checked })}
                />
              </div>
            </div>

          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTemplateDialog;
