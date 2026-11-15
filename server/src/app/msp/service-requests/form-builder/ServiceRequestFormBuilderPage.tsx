'use client';

/**
 * The route shell for Form Studio: loads the definition's draft schema, then hands the whole
 * screen to the builder. Basics, linkage, execution and answer mapping stay on the definition
 * page, which the back link returns to.
 *
 * The builder covers the viewport rather than sitting inside the MSP sidebar and header: three
 * panes plus a canvas need the width, and at 1280 px the app chrome left the canvas unusable.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import { getServiceRequestDefinitionEditorDataAction } from '../actions';
import { ServiceRequestFormBuilder } from './ServiceRequestFormBuilder';

interface BuilderData {
  definitionId: string;
  definitionName: string;
  schema: Record<string, unknown>;
  formBehaviorConfig?: Record<string, unknown>;
  /** The ticket subject and description-prefix templates, read-only here. */
  ticketTextTemplates: string[];
}

/** The execution config values that carry `{{answer_key}}` placeholders. */
function readTicketTextTemplates(config: Record<string, unknown>): string[] {
  return ['titleTemplate', 'descriptionPrefix']
    .map((key) => config[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export default function ServiceRequestFormBuilderPage(): React.ReactElement {
  const { t } = useTranslation('msp/service-requests');
  const params = useParams();
  const definitionId = String(params?.definitionId ?? '');
  const [data, setData] = useState<BuilderData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!definitionId) return;
    void (async () => {
      try {
        const editorData = await getServiceRequestDefinitionEditorDataAction(definitionId);
        if (cancelled) return;
        if (!editorData) {
          setError(t('formBuilder.messages.notFound'));
          return;
        }
        setData({
          definitionId: editorData.definitionId,
          definitionName: editorData.basics.name,
          schema: editorData.form.schema,
          formBehaviorConfig: editorData.execution.showAdvancedFormBehaviorConfigPanel
            ? (editorData.execution.formBehaviorConfig ?? {})
            : undefined,
          ticketTextTemplates: readTicketTextTemplates(
            editorData.execution.executionConfig ?? {}
          ),
        });
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [definitionId, t]);

  if (error) {
    return (
      <Alert id="service-request-form-builder-error" variant="destructive" className="m-4">
        <AlertTitle>{t('formBuilder.messages.loadFailedTitle')}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <p id="service-request-form-builder-loading" className="p-6 text-sm text-[rgb(var(--color-text-600))]">
        {t('formBuilder.messages.loading')}
      </p>
    );
  }

  return (
    <div
      id="service-request-form-builder-surface"
      className="fixed inset-0 z-50 bg-[rgb(var(--color-background))]"
    >
      <ServiceRequestFormBuilder
        definitionId={data.definitionId}
        definitionName={data.definitionName}
        initialSchema={data.schema}
        initialFormBehaviorConfig={data.formBehaviorConfig}
        ticketTextTemplates={data.ticketTextTemplates}
        backHref={`/msp/service-requests/${data.definitionId}`}
      />
    </div>
  );
}
