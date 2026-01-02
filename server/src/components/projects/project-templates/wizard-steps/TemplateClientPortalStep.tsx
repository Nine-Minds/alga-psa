'use client';

import React from 'react';
import { Alert, AlertDescription, AlertTitle } from 'server/src/components/ui/Alert';
import { Eye } from 'lucide-react';
import { TemplateWizardData } from '../TemplateCreationWizard';
import ClientPortalConfigEditor from 'server/src/components/projects/ClientPortalConfigEditor';
import { DEFAULT_CLIENT_PORTAL_CONFIG } from 'server/src/interfaces/project.interfaces';

interface TemplateClientPortalStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateClientPortalStep({
  data,
  updateData,
}: TemplateClientPortalStepProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Eye className="w-5 h-5 text-purple-600" />
        <h3 className="text-lg font-medium">Client Portal Visibility</h3>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Configure what information clients can see when viewing projects created from this template in the client portal.
      </p>

      <ClientPortalConfigEditor
        config={data.client_portal_config || DEFAULT_CLIENT_PORTAL_CONFIG}
        onChange={(config) => updateData({ client_portal_config: config })}
      />

      <Alert variant="info">
        <AlertTitle>About Client Portal Visibility</AlertTitle>
        <AlertDescription>
          These settings control what project information is visible to clients when they access the client portal.
          You can choose to show phases, task completion progress, and specific task details.
          These settings will be applied to all projects created from this template but can be customized per project.
        </AlertDescription>
      </Alert>
    </div>
  );
}
