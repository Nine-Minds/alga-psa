'use client';

/**
 * The route shell for Form Studio: loads the definition's draft schema, then hands the whole
 * screen to the builder. Basics, linkage, execution, answer mapping and publish stay on the
 * definition page, which the back link returns to.
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
    <div className="h-[calc(100vh-4rem)]">
      <ServiceRequestFormBuilder
        definitionId={data.definitionId}
        definitionName={data.definitionName}
        initialSchema={data.schema}
        initialFormBehaviorConfig={data.formBehaviorConfig}
        backHref={`/msp/service-requests/${data.definitionId}`}
      />
    </div>
  );
}
