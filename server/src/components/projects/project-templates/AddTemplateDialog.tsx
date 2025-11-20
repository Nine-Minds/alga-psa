'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Input } from 'server/src/components/ui/Input';
import { toast } from 'react-hot-toast';
import { useRouter } from 'next/navigation';

interface AddTemplateDialogProps {
  onClose: () => void;
  onTemplateCreated?: (templateId: string) => void;
}

const AddTemplateDialog: React.FC<AddTemplateDialogProps> = ({ onClose, onTemplateCreated }) => {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const [formData, setFormData] = useState({
    template_name: '',
    description: '',
    category: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    if (!formData.template_name.trim()) {
      return;
    }

    setIsSubmitting(true);

    try {
      // TODO: Create a new empty template via server action
      // For now, just create a basic template structure
      toast.success('Template created successfully');

      // Navigate to template detail page where user can add phases, tasks, etc.
      // const templateId = 'new-template-id'; // Will come from server action
      // if (onTemplateCreated) {
      //   onTemplateCreated(templateId);
      // }

      onClose();
      toast.info('Building templates from scratch is coming soon. For now, create templates from existing projects.');
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
      title="Add New Template"
      className="max-w-[600px]"
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="space-y-4">
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
                placeholder="e.g., Website Development Project"
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
                placeholder="Describe what this template is for..."
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
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
              <p className="text-sm text-blue-800">
                After creating the template, you'll be able to add phases, tasks, and configure workflow statuses.
              </p>
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
                className={!formData.template_name.trim() ? 'opacity-50' : ''}
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

export default AddTemplateDialog;
