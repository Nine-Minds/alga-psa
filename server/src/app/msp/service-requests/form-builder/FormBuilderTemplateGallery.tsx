'use client';

/**
 * What an empty form opens with. The templates are ordinary form schemas shipped as data, so
 * picking one simply fills the canvas; nothing it adds is locked.
 */
import React from 'react';
import * as Icons from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { FormBuilderTemplate } from './formBuilderTemplates';

export interface FormBuilderTemplateGalleryProps {
  templates: FormBuilderTemplate[];
  onChoose: (template: FormBuilderTemplate) => void;
}

export function FormBuilderTemplateGallery({
  templates,
  onChoose,
}: FormBuilderTemplateGalleryProps): React.ReactElement {
  const { t } = useTranslation('msp/service-requests');

  return (
    <div id="service-request-form-template-gallery" className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <div className="space-y-1 text-center">
        <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
          {t('formBuilder.gallery.title')}
        </h2>
        <p className="text-sm text-[rgb(var(--color-text-600))]">{t('formBuilder.gallery.subtitle')}</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {templates.map((template) => {
          const Icon = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
            template.icon
          ] ?? Icons.FileText;
          return (
            <li key={template.id}>
              <button
                id={`service-request-form-template-${template.id}`}
                type="button"
                onClick={() => onChoose(template)}
                className="flex h-full w-full flex-col items-start gap-1 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3 text-left transition-colors hover:border-[rgb(var(--color-primary-300))] hover:bg-[rgb(var(--color-border-100))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-primary-400))]"
              >
                <Icon className="h-5 w-5 text-[rgb(var(--color-primary-500))]" />
                <span className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                  {template.name}
                </span>
                <span className="text-xs text-[rgb(var(--color-text-600))]">
                  {template.description}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
