import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import {
  getRequestServiceDefinitionDetailAction,
  getRequestServiceVisibilityContextAction,
  submitRequestServiceDefinitionAction,
} from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.requestServices.detail.title', { defaultValue: 'Service Request' }),
  };
}
import { parseVisibilityRules } from '../../../../lib/service-requests/formVisibility';
import { normalizeBasicFormSchema } from '../../../../lib/service-requests/basicFormBuilder';
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
  // One opaque key per rendered form attempt: retries of this rendered form
  // resubmit the same key, letting the server deduplicate them into a single
  // submission. Reloading the page starts a fresh attempt with a fresh key.
  const clientSubmissionKey = crypto.randomUUID();
  // One normalizer decides what an element is, so the portal and the builder agree.
  const formSchema = normalizeBasicFormSchema(detail.formSchema);
  const fields = formSchema.fields;
  // Rules only reach the browser for the advanced provider; in CE the detail is null
  // for such definitions, so this stays disabled and no rules are sent.
  const visibilityRules =
    detail.formBehaviorProvider === 'advanced'
      ? (parseVisibilityRules(detail.formBehaviorConfig) ?? [])
      : [];
  const visibilityEnabled = visibilityRules.length > 0;
  const visibilityContext = visibilityEnabled
    ? await getRequestServiceVisibilityContextAction()
    : null;

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
            {formSchema.settings?.successMessage ? (
              <p className="mb-1">{formSchema.settings.successMessage}</p>
            ) : null}
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

      <section className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
        <h2 className="text-base font-semibold mb-2">{t('detail.formTitle')}</h2>
        {fields.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-600))]">{t('detail.noFields')}</p>
        ) : (
          <RequestServiceForm
            action={submitAction}
            fields={fields}
            settings={formSchema.settings}
            initialValues={detail.initialValues}
            visibility={{
              enabled: visibilityEnabled && visibilityContext !== null,
              rules: visibilityEnabled && visibilityContext !== null ? visibilityRules : [],
              context: visibilityContext ?? { requesterUserId: '', clientId: '', contactId: null },
            }}
            clientSubmissionKey={clientSubmissionKey}
            labels={{
              selectPlaceholder: t('detail.selectOption'),
              datePlaceholder: t('detail.datePlaceholder'),
              submit: t('detail.submit'),
              requiredField: t('detail.requiredField'),
              validation: {
                type: t('detail.validation.type'),
                minLength: t('detail.validation.minLength'),
                maxLength: t('detail.validation.maxLength'),
                pattern: t('detail.validation.pattern'),
                min: t('detail.validation.min'),
                max: t('detail.validation.max'),
                minDate: t('detail.validation.minDate'),
                maxDate: t('detail.validation.maxDate'),
                minSelected: t('detail.validation.minSelected'),
                maxSelected: t('detail.validation.maxSelected'),
              },
            }}
          />
        )}
      </section>

      <section className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
        <h2 className="text-base font-semibold mb-2">{t('detail.initialValuesTitle')}</h2>
        {Object.keys(detail.initialValues).length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            {t('detail.noInitialValues')}
          </p>
        ) : (
          <pre className="text-xs bg-[rgb(var(--color-background))] border border-[rgb(var(--color-border-200))] p-2 rounded overflow-auto">
            {JSON.stringify(detail.initialValues, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
