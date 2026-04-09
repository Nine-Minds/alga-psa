'use client';

import React from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { FileText, FolderTree } from 'lucide-react';
import type { TemplateWizardData } from '../../../types/templateWizard';
import { useTranslation } from 'react-i18next';

interface TemplateBasicsStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateBasicsStep({
  data,
  updateData,
}: TemplateBasicsStepProps) {
  const { t } = useTranslation(['features/projects']);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="template_name" className="flex items-center gap-2">
          <FileText className="w-4 h-4" />
          {t('templates.wizard.basics.nameLabel', 'Template Name *')}
        </Label>
        <Input
          id="template_name"
          value={data.template_name}
          onChange={(e) => updateData({ template_name: e.target.value })}
          placeholder={t('templates.wizard.basics.namePlaceholder', 'e.g., Website Development, Network Migration')}
          required
        />
        <p className="text-sm text-gray-500">
          {t('templates.wizard.basics.nameHelp', 'Give your template a descriptive name that reflects the type of project')}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description" className="flex items-center gap-2">
          <FileText className="w-4 h-4" />
          {t('templates.wizard.basics.descriptionLabel', 'Description')}
        </Label>
        <TextArea
          id="description"
          value={data.description || ''}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder={t('templates.wizard.basics.descriptionPlaceholder', 'Describe what this template is used for and any important details...')}
          rows={4}
        />
        <p className="text-sm text-gray-500">
          {t('templates.wizard.basics.descriptionHelp', 'Provide context to help users understand when to use this template')}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="category" className="flex items-center gap-2">
          <FolderTree className="w-4 h-4" />
          {t('templates.wizard.basics.categoryLabel', 'Category')}
        </Label>
        <Input
          id="category"
          value={data.category || ''}
          onChange={(e) => updateData({ category: e.target.value })}
          placeholder={t('templates.wizard.basics.categoryPlaceholder', 'e.g., Development, Infrastructure, Consulting')}
        />
        <p className="text-sm text-gray-500">
          {t('templates.wizard.basics.categoryHelp', 'Organize templates by category for easier filtering')}
        </p>
      </div>

      <Alert variant="info">
        <AlertTitle>{t('templates.wizard.basics.nextHintTitle', "What's Next?")}</AlertTitle>
        <AlertDescription>
          {t('templates.wizard.basics.nextHintDescription', `After defining the basics, you'll set up status columns, add phases, create tasks, configure client portal visibility, and review your template before saving.`)}
        </AlertDescription>
      </Alert>
    </div>
  );
}
