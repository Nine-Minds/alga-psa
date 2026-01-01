'use client';

import React, { useState } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Alert, AlertDescription, AlertTitle } from 'server/src/components/ui/Alert';
import { FileText, FolderTree, ChevronDown, ChevronRight, Settings } from 'lucide-react';
import { TemplateWizardData } from '../TemplateCreationWizard';
import ClientPortalConfigEditor from 'server/src/components/projects/ClientPortalConfigEditor';
import { DEFAULT_CLIENT_PORTAL_CONFIG } from 'server/src/interfaces/project.interfaces';

interface TemplateBasicsStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateBasicsStep({
  data,
  updateData,
}: TemplateBasicsStepProps) {
  const [showClientPortalConfig, setShowClientPortalConfig] = useState(false);

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

      {/* Client Portal Visibility - Expandable Section */}
      <div className="border-t pt-4 mt-4">
        <button
          type="button"
          onClick={() => setShowClientPortalConfig(!showClientPortalConfig)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
        >
          {showClientPortalConfig ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <Settings className="h-4 w-4" />
          <span>Client Portal Visibility</span>
        </button>
        {showClientPortalConfig && (
          <div className="mt-3">
            <ClientPortalConfigEditor
              config={data.client_portal_config || DEFAULT_CLIENT_PORTAL_CONFIG}
              onChange={(config) => updateData({ client_portal_config: config })}
            />
          </div>
        )}
      </div>

      <Alert variant="info">
        <AlertTitle>What's Next?</AlertTitle>
        <AlertDescription>
          After defining the basics, you'll set up status columns, add phases, create tasks,
          and review your template before saving.
        </AlertDescription>
      </Alert>
    </div>
  );
}
