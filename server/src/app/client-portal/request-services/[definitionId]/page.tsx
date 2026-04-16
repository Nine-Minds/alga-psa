import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getRequestServiceDefinitionDetailAction,
  submitRequestServiceDefinitionAction,
} from './actions';
import { ServiceRequestIcon } from '../ServiceRequestIcon';

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
  const detail = await getRequestServiceDefinitionDetailAction(definitionId);

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
          <span>Version {detail.versionNumber}</span>
        </div>
      </div>
      {detail.description && (
        <p className="text-sm text-[rgb(var(--color-text-700))]">{detail.description}</p>
      )}

      {submittedRequestId && (
        <section className="rounded border border-green-500 p-4 bg-green-50">
          <h2 className="text-base font-semibold text-green-800">Request submitted</h2>
          <p className="text-sm text-green-700">
            Request ID: <span className="font-mono">{submittedRequestId}</span>
          </p>
          {submittedTicketId && (
            <p className="text-sm text-green-700">
              Ticket ID:{' '}
              <Link
                href={`/client-portal/tickets/${submittedTicketId}`}
                className="font-mono underline"
              >
                {submittedTicketId}
              </Link>
            </p>
          )}
        </section>
      )}

      {submitError && (
        <section className="rounded border border-red-500 p-4 bg-red-50">
          <h2 className="text-base font-semibold text-red-800">Unable to submit request</h2>
          <p className="text-sm text-red-700">{submitError}</p>
        </section>
      )}

      <section className="rounded border p-4 bg-[rgb(var(--color-background-100))]">
        <h2 className="text-base font-semibold mb-2">Request Form</h2>
        {visibleFields.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-600))]">No fields configured.</p>
        ) : (
          <form action={submitAction} encType="multipart/form-data" noValidate className="space-y-4">
            {visibleFields.map((field: any, index: number) => {
              const key = typeof field?.key === 'string' ? field.key : `field_${index}`;
              const label = typeof field?.label === 'string' ? field.label : key;
              const helpText = typeof field?.helpText === 'string' ? field.helpText : null;
              const required = !!field?.required;
              const initialValue = detail.initialValues[key];

              if (field?.type === 'long-text') {
                return (
                  <label key={key} className="block space-y-1">
                    <span className="text-sm font-medium">
                      {label}
                      {required ? ' *' : ''}
                    </span>
                    <textarea
                      name={key}
                      required={required}
                      defaultValue={typeof initialValue === 'string' ? initialValue : ''}
                      className="w-full rounded border p-2 text-sm"
                      rows={4}
                    />
                    {helpText && <span className="text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>}
                  </label>
                );
              }

              if (field?.type === 'select' && Array.isArray(field?.options)) {
                return (
                  <label key={key} className="block space-y-1">
                    <span className="text-sm font-medium">
                      {label}
                      {required ? ' *' : ''}
                    </span>
                    <select
                      name={key}
                      required={required}
                      defaultValue={typeof initialValue === 'string' ? initialValue : ''}
                      className="w-full rounded border p-2 text-sm"
                    >
                      <option value="">Select an option</option>
                      {field.options.map((option: any, optionIndex: number) => (
                        <option key={`${key}-option-${optionIndex}`} value={option?.value ?? ''}>
                          {option?.label ?? option?.value ?? `Option ${optionIndex + 1}`}
                        </option>
                      ))}
                    </select>
                    {helpText && <span className="text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>}
                  </label>
                );
              }

              if (field?.type === 'checkbox') {
                return (
                  <label key={key} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      name={key}
                      defaultChecked={typeof initialValue === 'boolean' ? initialValue : false}
                      className="mt-1"
                    />
                    <span className="text-sm">
                      <span className="font-medium">
                        {label}
                        {required ? ' *' : ''}
                      </span>
                      {helpText && (
                        <span className="block text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>
                      )}
                    </span>
                  </label>
                );
              }

              if (field?.type === 'file-upload') {
                return (
                  <label key={key} className="block space-y-1">
                    <span className="text-sm font-medium">
                      {label}
                      {required ? ' *' : ''}
                    </span>
                    <input
                      name={key}
                      type="file"
                      required={required}
                      className="w-full rounded border p-2 text-sm"
                    />
                    {helpText && <span className="text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>}
                  </label>
                );
              }

              return (
                <label key={key} className="block space-y-1">
                  <span className="text-sm font-medium">
                    {label}
                    {required ? ' *' : ''}
                  </span>
                  <input
                    type={field?.type === 'date' ? 'date' : 'text'}
                    name={key}
                    required={required}
                    defaultValue={typeof initialValue === 'string' ? initialValue : ''}
                    className="w-full rounded border p-2 text-sm"
                  />
                  {helpText && <span className="text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>}
                </label>
              );
            })}
            <button
              type="submit"
              className="inline-flex items-center rounded bg-[rgb(var(--color-primary-600))] px-4 py-2 text-sm font-medium text-white"
            >
              Submit Request
            </button>
          </form>
        )}
      </section>

      <section className="rounded border p-4 bg-[rgb(var(--color-background-100))]">
        <h2 className="text-base font-semibold mb-2">Initial Values</h2>
        {Object.keys(detail.initialValues).length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            No static defaults configured.
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
