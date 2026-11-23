import type { Metadata } from 'next';
import React from 'react';
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
import {
  getBasicFormWidthClass,
  normalizeBasicFormSchema,
} from '../../../../lib/service-requests/formSchema';
import { ServiceRequestIcon } from '../ServiceRequestIcon';
import { RequestServiceForm } from './RequestServiceForm';

interface RequestServiceDetailPageProps {
  params: Promise<{
    definitionId: string;
  }>;
  searchParams?: Promise<{
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
  // Rules arrive assembled and pre-parsed from the server — element conditions plus, where
  // it applies, the advanced provider's own list — so nothing else about form behavior
  // reaches this page.
  const visibilityRules = detail.visibilityRules;
  const visibilityEnabled = visibilityRules.length > 0;
  const visibilityContext = visibilityEnabled
    ? await getRequestServiceVisibilityContextAction()
    : null;
  // Options for lookup fields arrive with the detail, resolved on the server from the session's client.
  const lookupOptions = detail.lookupOptions ?? {};

  // The page takes the measure the form was authored at, so a boxed form sits in a card its
  // own size instead of a narrow column stranded in a page-wide one. The author chooses it
  // in the builder's form settings; "Full width" gives the page back to the form.
  const widthClass = getBasicFormWidthClass(formSchema.settings);

  return (
    <div className={`${widthClass} space-y-4`}>
      <div>
        <h1 className="text-2xl font-semibold">{detail.title}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-[rgb(var(--color-text-600))]">
          <ServiceRequestIcon iconName={detail.icon} className="h-4 w-4" />
        </div>
      </div>
      {detail.description && (
        <p className="text-sm text-[rgb(var(--color-text-700))]">{detail.description}</p>
      )}

      {/* A successful submit redirects to the catalog, which confirms it and says the form's
          own success message; this page only has to answer a refused one. */}
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
            lookupOptions={lookupOptions}
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
              unsupportedField: t('detail.unsupportedField'),
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
    </div>
  );
}
