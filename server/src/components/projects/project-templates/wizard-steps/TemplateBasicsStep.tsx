'use client';

import React from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Alert, AlertDescription, AlertTitle } from 'server/src/components/ui/Alert';
import { FileText, FolderTree } from 'lucide-react';
import { TemplateWizardData } from '../TemplateCreationWizard';

interface TemplateBasicsStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateBasicsStep({
  data,
  updateData,
}: TemplateBasicsStepProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="template_name" className="flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Template Name *
        </Label>
        <Input
          id="template_name"
          value={data.template_name}
          onChange={(e) => updateData({ template_name: e.target.value })}
          placeholder="e.g., Website Development, Network Migration"
          required
        />
        <p className="text-sm text-gray-500">
          Give your template a descriptive name that reflects the type of project
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description" className="flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Description
        </Label>
        <TextArea
          id="description"
          value={data.description || ''}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder="Describe what this template is used for and any important details..."
          rows={4}
        />
        <p className="text-sm text-gray-500">
          Provide context to help users understand when to use this template
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="category" className="flex items-center gap-2">
          <FolderTree className="w-4 h-4" />
          Category
        </Label>
        <Input
          id="category"
          value={data.category || ''}
          onChange={(e) => updateData({ category: e.target.value })}
          placeholder="e.g., Development, Infrastructure, Consulting"
        />
        <p className="text-sm text-gray-500">
          Organize templates by category for easier filtering
        </p>
      </div>

      <Alert variant="info">
        <AlertTitle>What's Next?</AlertTitle>
        <AlertDescription>
          After defining the basics, you'll set up status columns, add phases, create tasks,
          configure client portal visibility, and review your template before saving.
        </AlertDescription>
      </Alert>
    </div>
  );
}
