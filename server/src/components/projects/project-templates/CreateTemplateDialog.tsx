'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Input } from 'server/src/components/ui/Input';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { IProject } from 'server/src/interfaces/project.interfaces';
import { toast } from 'react-hot-toast';
import { createTemplateFromProject, getTemplateCategories } from 'server/src/lib/actions/project-actions/projectTemplateActions';
import { getProjects } from 'server/src/lib/actions/project-actions/projectActions';

interface CreateTemplateDialogProps {
  onClose: () => void;
  onTemplateCreated?: (templateId: string) => void;
  initialProjectId?: string;
}

const CreateTemplateDialog: React.FC<CreateTemplateDialogProps> = ({ onClose, onTemplateCreated, initialProjectId }) => {
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
    copyAssignments: false
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        console.log('Fetching projects and categories...');
        const [projectsData, categoriesData] = await Promise.all([
          getProjects(),
          getTemplateCategories()
        ]);
        console.log('Projects loaded:', projectsData.length);
        console.log('Categories loaded:', categoriesData.length);
        setProjects(projectsData);
        setCategories(categoriesData);
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Failed to load projects and categories');
      }
    };
    fetchData();
  }, []);

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

      toast.success('Template created successfully');

      if (onTemplateCreated) {
        onTemplateCreated(templateId);
      }

      onClose();
    } catch (error) {
      console.error('Error creating template:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create template');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={true}
      onClose={() => {
        setHasAttemptedSubmit(false);
        onClose();
      }}
      title="Create Template from Project"
      className="max-w-[600px]"
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
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
                className={hasAttemptedSubmit && !formData.project_id ? 'ring-1 ring-red-500' : ''}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Template Name *
              </label>
              <Input
                id="template-name"
                value={formData.template_name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, template_name: e.target.value })
                }
                placeholder="Enter template name"
                className={hasAttemptedSubmit && !formData.template_name.trim() ? 'ring-1 ring-red-500' : ''}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <TextArea
                id="template-description"
                value={formData.description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Enter template description"
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <Input
                id="template-category"
                value={formData.category}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, category: e.target.value })
                }
                placeholder="e.g., Software Development, Network Setup"
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
                What to include from the project:
              </label>
              <div className="space-y-3">
                <Checkbox
                  id="copy-phases"
                  label="Copy project phases"
                  checked={copyOptions.copyPhases}
                  onChange={(e) => setCopyOptions({ ...copyOptions, copyPhases: e.target.checked })}
                />
                <Checkbox
                  id="copy-statuses"
                  label="Copy project columns/statuses"
                  checked={copyOptions.copyStatuses}
                  onChange={(e) => setCopyOptions({ ...copyOptions, copyStatuses: e.target.checked })}
                />
                <Checkbox
                  id="copy-tasks"
                  label="Copy project tasks"
                  checked={copyOptions.copyTasks}
                  onChange={(e) => setCopyOptions({ ...copyOptions, copyTasks: e.target.checked })}
                />
                <Checkbox
                  id="copy-assignments"
                  label="Copy task assignments"
                  checked={copyOptions.copyAssignments}
                  onChange={(e) => setCopyOptions({ ...copyOptions, copyAssignments: e.target.checked })}
                />
              </div>
            </div>

            <div className="flex justify-between mt-6">
              <Button
                id="cancel-button"
                variant="ghost"
                onClick={() => {
                  setHasAttemptedSubmit(false);
                  onClose();
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                id="create-button"
                type="submit"
                disabled={isSubmitting}
                className={!formData.project_id || !formData.template_name.trim() ? 'opacity-50' : ''}
              >
                {isSubmitting ? 'Creating...' : 'Create Template'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTemplateDialog;
