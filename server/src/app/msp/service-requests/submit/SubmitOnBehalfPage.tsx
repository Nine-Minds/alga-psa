'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getContactsByClient } from '@alga-psa/clients/actions';
import type { IContact } from '@alga-psa/types';
import type { ServiceRequestPortalCatalogItem } from '../../../../lib/service-requests';
import { RequestServiceForm } from '../../../../components/service-requests/RequestServiceForm';
import {
  getOnBehalfDefinitionFormAction,
  listOnBehalfCatalogAction,
  submitOnBehalfServiceRequestAction,
  type OnBehalfFormView,
  type OnBehalfSubmitOutcome,
} from '../onBehalfActions';

interface SubmitOnBehalfPageProps {
  initialClientId: string | null;
  initialContactId: string | null;
  initialDefinitionId: string | null;
}

export default function SubmitOnBehalfPage({
  initialClientId,
  initialContactId,
  initialDefinitionId,
}: SubmitOnBehalfPageProps) {
  const { t } = useTranslation('msp/service-requests');
  const [clientId, setClientId] = useState<string | null>(initialClientId);
  const [contactId, setContactId] = useState<string>(initialContactId ?? '');
  const [definitionId, setDefinitionId] = useState<string>(initialDefinitionId ?? '');
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [catalog, setCatalog] = useState<ServiceRequestPortalCatalogItem[] | null>(null);
  const [formView, setFormView] = useState<OnBehalfFormView | null>(null);
  const [formUnavailable, setFormUnavailable] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [outcome, setOutcome] = useState<OnBehalfSubmitOutcome | null>(null);
  // One idempotency key per rendered form attempt; double-clicks and retries resend it.
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());

  // Client -> contacts. Changing the client clears everything downstream.
  useEffect(() => {
    let cancelled = false;
    setContacts([]);
    if (!clientId) return;
    getContactsByClient(clientId)
      .then((rows) => {
        if (cancelled) return;
        setContacts(rows);
        setContactId((current) => (rows.some((row) => row.contact_name_id === current) ? current : ''));
      })
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Contact -> that contact's catalog. Reloaded whenever the contact changes.
  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setLoadError(false);
    if (!clientId || !contactId) return;
    listOnBehalfCatalogAction(clientId, contactId)
      .then((items) => {
        if (cancelled) return;
        setCatalog(items);
        setDefinitionId((current) => (items.some((item) => item.definitionId === current) ? current : ''));
      })
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [clientId, contactId]);

  // Definition -> the shared form, rendered with the contact's identity.
  useEffect(() => {
    let cancelled = false;
    setFormView(null);
    setFormUnavailable(false);
    setOutcome(null);
    setSubmissionKey(crypto.randomUUID());
    if (!clientId || !contactId || !definitionId) return;
    getOnBehalfDefinitionFormAction(clientId, contactId, definitionId)
      .then((view) => {
        if (cancelled) return;
        setFormView(view);
        setFormUnavailable(view === null);
      })
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [clientId, contactId, definitionId]);

  const submit = useCallback(
    async (formData: FormData) => {
      if (!clientId || !contactId || !definitionId) return;
      setOutcome(await submitOnBehalfServiceRequestAction(clientId, contactId, definitionId, formData));
    },
    [clientId, contactId, definitionId]
  );

  const fields = Array.isArray((formView?.form.formSchema as any)?.fields)
    ? ((formView!.form.formSchema as any).fields as any[])
    : [];
  const rules = formView?.form.visibilityRules ?? [];

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('submit.title', { defaultValue: 'Submit service request' })}</h1>
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          {t('submit.description', {
            defaultValue: 'File a published service request for a client contact. The contact is recorded as the requester and you as the submitter.',
          })}
        </p>
      </div>

      {outcome?.status === 'success' ? (
        <Alert variant="success">
          <AlertTitle>
            {outcome.replayed
              ? t('submit.alreadySubmitted', { defaultValue: 'This request was already submitted' })
              : t('submit.submitted', { defaultValue: 'Service request submitted' })}
          </AlertTitle>
          <AlertDescription>
            {outcome.ticketId ? (
              <Link id="service-request-submit-ticket-link" href={`/msp/tickets/${outcome.ticketId}`} className="underline">
                {t('submit.viewTicket', { defaultValue: 'View the ticket' })}
              </Link>
            ) : (
              t('submit.noTicket', { defaultValue: 'No ticket was created for this request.' })
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <span className="text-sm font-medium">{t('submit.client', { defaultValue: 'Client' })}</span>
              <ClientPicker
                id="service-request-submit-client"
                selectedClientId={clientId}
                onSelect={(id) => {
                  setClientId(id);
                  setContactId('');
                }}
                filterState="active"
                onFilterStateChange={() => {}}
                clientTypeFilter="all"
                onClientTypeFilterChange={() => {}}
                placeholder={t('submit.clientPlaceholder', { defaultValue: 'Select client' })}
              />
            </div>
            <div className="space-y-1">
              <span className="text-sm font-medium">{t('submit.contact', { defaultValue: 'Requester (contact)' })}</span>
              <ContactPicker
                id="service-request-submit-contact"
                contacts={contacts}
                value={contactId}
                onValueChange={setContactId}
                clientId={clientId ?? undefined}
                disabled={!clientId}
                placeholder={t('submit.contactPlaceholder', { defaultValue: 'Select contact' })}
              />
            </div>
            <div className="space-y-1">
              <span className="text-sm font-medium">{t('submit.definition', { defaultValue: 'Service request' })}</span>
              <CustomSelect
                id="service-request-submit-definition"
                value={definitionId}
                onValueChange={setDefinitionId}
                disabled={!contactId || catalog === null}
                placeholder={t('submit.definitionPlaceholder', { defaultValue: 'Select a service request' })}
                options={(catalog ?? []).map((item) => ({ value: item.definitionId, label: item.title }))}
              />
            </div>
          </section>

          {loadError && (
            <Alert variant="destructive">
              <AlertDescription>
                {t('submit.loadError', { defaultValue: 'Unable to load service requests for this contact.' })}
              </AlertDescription>
            </Alert>
          )}
          {catalog !== null && catalog.length === 0 && (
            <p className="text-sm text-[rgb(var(--color-text-600))]">
              {t('submit.emptyCatalog', { defaultValue: 'This contact cannot see any published service requests.' })}
            </p>
          )}
          {formUnavailable && (
            <Alert variant="destructive">
              <AlertDescription>
                {t('submit.notAvailable', { defaultValue: 'This service request is not available to this contact.' })}
              </AlertDescription>
            </Alert>
          )}
          {outcome?.status === 'error' && (
            <Alert variant="destructive">
              <AlertTitle>{t('submit.unableToSubmit', { defaultValue: 'Unable to submit' })}</AlertTitle>
              <AlertDescription>{outcome.message}</AlertDescription>
            </Alert>
          )}

          {formView && clientId && contactId && (
            <section className="rounded border p-4 bg-[rgb(var(--color-border-100))] space-y-2">
              <h2 className="text-base font-semibold">{formView.form.title}</h2>
              {formView.form.description && (
                <p className="text-sm text-[rgb(var(--color-text-700))]">{formView.form.description}</p>
              )}
              {fields.length === 0 ? (
                <p className="text-sm text-[rgb(var(--color-text-600))]">
                  {t('submit.noFields', { defaultValue: 'This request has no fields.' })}
                </p>
              ) : (
                <RequestServiceForm
                  action={submit}
                  fields={fields.map((field: any, index: number) => ({
                    key: typeof field?.key === 'string' ? field.key : `field_${index}`,
                    label: typeof field?.label === 'string' ? field.label : (typeof field?.key === 'string' ? field.key : `field_${index}`),
                    type: typeof field?.type === 'string' ? field.type : undefined,
                    required: !!field?.required,
                    helpText: typeof field?.helpText === 'string' ? field.helpText : null,
                    options: Array.isArray(field?.options)
                      ? field.options.map((option: any, optionIndex: number) => {
                          const value = typeof option?.value === 'string' ? option.value : '';
                          return {
                            value,
                            label:
                              typeof option?.label === 'string'
                                ? option.label
                                : value || t('submit.optionLabel', { defaultValue: 'Option {{index}}', index: optionIndex + 1 }),
                          };
                        })
                      : undefined,
                  }))}
                  initialValues={formView.form.initialValues}
                  visibility={{
                    enabled: rules.length > 0,
                    rules,
                    context: formView.visibilityContext,
                  }}
                  clientSubmissionKey={submissionKey}
                  labels={{
                    selectPlaceholder: t('submit.selectOption', { defaultValue: 'Select an option' }),
                    datePlaceholder: t('submit.datePlaceholder', { defaultValue: 'Select a date' }),
                    submit: t('submit.submit', { defaultValue: 'Submit request' }),
                    requiredField: t('submit.requiredField', { defaultValue: 'This field is required' }),
                  }}
                />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
