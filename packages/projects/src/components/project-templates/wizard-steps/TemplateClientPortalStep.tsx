'use client';

import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Eye } from 'lucide-react';
import type { TemplateWizardData } from '../../../types/templateWizard';
import ClientPortalConfigEditor from '../../ClientPortalConfigEditor';
import { DEFAULT_CLIENT_PORTAL_CONFIG } from '@alga-psa/types';
import { useTranslation } from 'react-i18next';

interface TemplateClientPortalStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateClientPortalStep({
  data,
  updateData,
}: TemplateClientPortalStepProps) {
  const { t } = useTranslation(['features/projects']);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Eye className="w-5 h-5 text-purple-600" />
        <h3 className="text-lg font-medium">
          {t('templates.wizard.clientPortal.title', 'Client Portal Visibility')}
        </h3>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        {t('templates.wizard.clientPortal.description', 'Configure what information clients can see when viewing projects created from this template in the client portal.')}
      </p>

      <ClientPortalConfigEditor
        config={data.client_portal_config || DEFAULT_CLIENT_PORTAL_CONFIG}
        onChange={(config) => updateData({ client_portal_config: config })}
      />

      <Alert variant="info">
        <AlertTitle>
          {t('templates.wizard.clientPortal.aboutTitle', 'About Client Portal Visibility')}
        </AlertTitle>
        <AlertDescription>
          {t('templates.wizard.clientPortal.aboutDescription', 'These settings control what project information is visible to clients when they access the client portal. You can choose to show phases, task completion progress, and specific task details. These settings will be applied to all projects created from this template but can be customized per project.')}
        </AlertDescription>
      </Alert>
    </div>
  );
}
