import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import {
  getRequestServiceDefinitionDetailAction,
  submitRequestServiceDefinitionAction,
} from './actions';
import { ServiceRequestIcon } from '../ServiceRequestIcon';
import { RequestServiceForm } from './RequestServiceForm';

interface RequestServiceDetailPageProps {
  params: Promise<{
    definitionId: string;
  }>;
  searchParams?: Promise<{
    submitted?: string;
    ticketId?: string;
    error?: string;
  }>;
}

export default async function RequestServiceDetailPage(props: RequestServiceDetailPageProps) {
  const { definitionId } = await props.params;
  const resolvedSearchParams = props.searchParams ? await props.searchParams : undefined;
  const [detail, { t }] = await Promise.all([
    getRequestServiceDefinitionDetailAction(definitionId),
    getServerTranslation(undefined, 'client-portal/service-requests'),
  ]);

  if (!detail) {
    notFound();
  }

  const submittedRequestId =
    typeof resolvedSearchParams?.submitted === 'string' ? resolvedSearchParams.submitted : null;
  const submittedTicketId =
    typeof resolvedSearchParams?.ticketId === 'string' ? resolvedSearchParams.ticketId : null;
  const submitError =
    typeof resolvedSearchParams?.error === 'string' ? resolvedSearchParams.error : null;
  const submitAction = submitRequestServiceDefinitionAction.bind(null, definitionId);
  const fields = Array.isArray((detail.formSchema as any)?.fields)
    ? ((detail.formSchema as any).fields as any[])
    : [];
  const visibleFieldKeySet = new Set(detail.visibleFieldKeys ?? []);
  const visibleFields = fields.filter(
    (field: any, index: number) =>
      visibleFieldKeySet.has(
        typeof field?.key === 'string' ? field.key : `field_${index}`
      )
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{detail.title}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-[rgb(var(--color-text-600))]">
          <ServiceRequestIcon iconName={detail.icon} className="h-4 w-4" />
          <span>{t('detail.version', { version: detail.versionNumber })}</span>
        </div>
      </div>
      {detail.description && (
        <p className="text-sm text-[rgb(var(--color-text-700))]">{detail.description}</p>
      )}

      {submittedRequestId && (
        <Alert variant="success">
          <AlertTitle>{t('detail.submitted')}</AlertTitle>
          <AlertDescription>
            <p>
              {t('detail.requestIdLabel')}
              <span className="font-mono">{submittedRequestId}</span>
            </p>
            {submittedTicketId && (
              <p>
                {t('detail.ticketIdLabel')}
                <Link
                  href={`/client-portal/tickets/${submittedTicketId}`}
                  className="font-mono underline"
                >
                  {submittedTicketId}
                </Link>
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {submitError && (
        <Alert variant="destructive">
          <AlertTitle>{t('detail.unableToSubmit')}</AlertTitle>
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

      <section className="rounded border p-4 bg-[rgb(var(--color-background-100))]">
        <h2 className="text-base font-semibold mb-2">{t('detail.formTitle')}</h2>
        {visibleFields.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-600))]">{t('detail.noFields')}</p>
        ) : (
          <RequestServiceForm
            action={submitAction}
            fields={visibleFields.map((field: any, index: number) => ({
              key: typeof field?.key === 'string' ? field.key : `field_${index}`,
              label: typeof field?.label === 'string' ? field.label : (typeof field?.key === 'string' ? field.key : `field_${index}`),
              type: typeof field?.type === 'string' ? field.type : undefined,
              required: !!field?.required,
              helpText: typeof field?.helpText === 'string' ? field.helpText : null,
              options: Array.isArray(field?.options)
                ? field.options.map((option: any, optionIndex: number) => {
                    const value = typeof option?.value === 'string' ? option.value : '';
                    const label =
                      typeof option?.label === 'string'
                        ? option.label
                        : value || t('detail.optionLabel', { index: optionIndex + 1 });
                    return { value, label };
                  })
                : undefined,
            }))}
            initialValues={detail.initialValues}
            labels={{
              selectPlaceholder: t('detail.selectOption'),
              datePlaceholder: t('detail.datePlaceholder'),
              submit: t('detail.submit'),
            }}
          />
        )}
      </section>

      <section className="rounded border p-4 bg-[rgb(var(--color-background-100))]">
        <h2 className="text-base font-semibold mb-2">{t('detail.initialValuesTitle')}</h2>
        {Object.keys(detail.initialValues).length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            {t('detail.noInitialValues')}
          </p>
        ) : (
          <pre className="text-xs bg-white p-2 rounded overflow-auto">
            {JSON.stringify(detail.initialValues, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
