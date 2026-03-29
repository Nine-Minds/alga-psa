'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  getServiceRequestDefinitionSubmissionDetailAction,
  getServiceRequestDefinitionEditorDataAction,
  listServiceRequestDefinitionSubmissionsAction,
  publishServiceRequestDefinitionAction,
  saveServiceRequestDefinitionDraftAction,
  searchLinkedServicesForDefinitionAction,
  setLinkedServiceForDefinitionAction,
  updateServiceRequestExecutionProviderAction,
  validateServiceRequestDefinitionForPublishAction,
} from './actions';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { toast } from 'react-hot-toast';

interface EditorData {
  definitionId: string;
  lifecycleState: 'draft' | 'published' | 'archived';
  basics: {
    name: string;
    description: string | null;
    icon: string | null;
    categoryId: string | null;
    categoryName: string | null;
    sortOrder: number;
  };
  linkage: {
    linkedServiceId: string | null;
    linkedServiceName: string | null;
  };
  form: {
    schema: Record<string, unknown>;
  };
  execution: {
    executionProvider: string;
    executionConfig: Record<string, unknown>;
    formBehaviorProvider: string;
    formBehaviorConfig: Record<string, unknown>;
    visibilityProvider: string;
    visibilityConfig: Record<string, unknown>;
    availableExecutionProviders: Array<{
      key: string;
      displayName: string;
      executionMode: string;
    }>;
  };
  publish: {
    publishedVersionNumber: number | null;
    publishedAt: string | Date | null;
    draftUpdatedAt: string | Date;
  };
}

interface DefinitionSubmissionRow {
  submission_id: string;
  request_name: string;
  requester_user_id: string | null;
  client_id: string;
  contact_id: string | null;
  execution_status: 'pending' | 'succeeded' | 'failed';
  created_ticket_id: string | null;
  workflow_execution_id: string | null;
  submitted_at: string | Date;
}

interface DefinitionSubmissionDetail extends DefinitionSubmissionRow {
  definition_id: string;
  definition_version_id: string;
  submitted_payload: Record<string, unknown>;
  execution_error_summary: string | null;
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-3 text-sm">
      <div className="font-medium text-[rgb(var(--color-text-700))]">{label}</div>
      <div className="text-[rgb(var(--color-text-900))] break-words">{value}</div>
    </div>
  );
}

function renderFieldPreview(field: any): string {
  const label = typeof field?.label === 'string' ? field.label : field?.key ?? 'Untitled field';
  const type = typeof field?.type === 'string' ? field.type : 'unknown';
  const required = field?.required ? 'required' : 'optional';
  return `${label} (${type}, ${required})`;
}

export default function ServiceRequestDefinitionEditorPage() {
  const params = useParams();
  const definitionId = String(params?.definitionId ?? '');
  const [data, setData] = useState<EditorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [linkedServiceQuery, setLinkedServiceQuery] = useState('');
  const [linkedServiceResults, setLinkedServiceResults] = useState<
    Array<{ service_id: string; service_name: string; description: string | null }>
  >([]);
  const [submissions, setSubmissions] = useState<DefinitionSubmissionRow[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [selectedSubmissionDetail, setSelectedSubmissionDetail] = useState<DefinitionSubmissionDetail | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await getServiceRequestDefinitionEditorDataAction(definitionId);
        setData(result as EditorData | null);
        if (result) {
          const definitionSubmissions = await listServiceRequestDefinitionSubmissionsAction(definitionId);
          setSubmissions(definitionSubmissions as DefinitionSubmissionRow[]);
          if (selectedSubmissionId) {
            const detail = await getServiceRequestDefinitionSubmissionDetailAction(
              definitionId,
              selectedSubmissionId
            );
            setSelectedSubmissionDetail(detail as DefinitionSubmissionDetail | null);
          }
          const validation = await validateServiceRequestDefinitionForPublishAction(definitionId);
          setValidationErrors(validation.errors ?? []);
        } else {
          setValidationErrors([]);
          setSubmissions([]);
          setSelectedSubmissionDetail(null);
        }
      } finally {
        setLoading(false);
      }
    };

    if (definitionId) {
      load();
    }
  }, [definitionId, selectedSubmissionId]);

  if (loading) {
    return <div className="p-6 text-sm text-[rgb(var(--color-text-600))]">Loading definition editor…</div>;
  }

  if (!data) {
    return <div className="p-6 text-sm text-[rgb(var(--color-danger-600))]">Service request definition not found.</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{data.basics.name}</h1>
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          Definition ID: {data.definitionId} · Current state: {data.lifecycleState}
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            id="service-request-editor-save-draft"
            variant="outline"
            onClick={async () => {
              try {
                await saveServiceRequestDefinitionDraftAction(data.definitionId);
                toast.success('Draft saved');
              } catch (error) {
                console.error('Failed to save draft', error);
                toast.error('Failed to save draft');
              }
            }}
          >
            Save Draft
          </Button>
          <Button
            id="service-request-editor-publish"
            onClick={async () => {
              try {
                await publishServiceRequestDefinitionAction(data.definitionId);
                toast.success('Definition published');
                const refreshed = await getServiceRequestDefinitionEditorDataAction(data.definitionId);
                setData(refreshed as EditorData | null);
                const validation = await validateServiceRequestDefinitionForPublishAction(data.definitionId);
                setValidationErrors(validation.errors ?? []);
              } catch (error) {
                console.error('Failed to publish definition', error);
                toast.error(error instanceof Error ? error.message : 'Failed to publish definition');
              }
            }}
          >
            Publish
          </Button>
        </div>
      </div>

      <Card id="service-request-editor-basics" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Basics</h2>
        <FieldRow label="Name" value={data.basics.name} />
        <FieldRow label="Description" value={data.basics.description ?? '-'} />
        <FieldRow label="Icon" value={data.basics.icon ?? '-'} />
        <FieldRow label="Category" value={data.basics.categoryName ?? data.basics.categoryId ?? '-'} />
        <FieldRow label="Sort Order" value={String(data.basics.sortOrder)} />
      </Card>

      <Card id="service-request-editor-service-preview" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Service Card Preview</h2>
        <div className="rounded border p-4 bg-[rgb(var(--color-background-100))]">
          <div className="text-xs uppercase tracking-wide text-[rgb(var(--color-text-500))] mb-1">
            {data.basics.icon ? `Icon: ${data.basics.icon}` : 'No icon selected'}
          </div>
          <div className="text-lg font-semibold">{data.basics.name}</div>
          <div className="text-sm text-[rgb(var(--color-text-700))] mt-1">
            {data.basics.description ?? 'No description provided'}
          </div>
          <div className="text-xs text-[rgb(var(--color-text-500))] mt-2">
            {data.basics.categoryName ?? data.basics.categoryId ?? 'Uncategorized'}
          </div>
        </div>
      </Card>

      <Card id="service-request-editor-linkage" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Linkage</h2>
        <FieldRow label="Linked Service" value={data.linkage.linkedServiceName ?? data.linkage.linkedServiceId ?? '-'} />
        <div className="flex gap-2">
          <input
            id="service-request-linked-service-search"
            className="border rounded px-3 py-2 text-sm flex-1"
            placeholder="Search service catalog"
            value={linkedServiceQuery}
            onChange={(event) => setLinkedServiceQuery(event.target.value)}
          />
          <Button
            id="service-request-linked-service-search-button"
            variant="outline"
            onClick={async () => {
              const results = await searchLinkedServicesForDefinitionAction(linkedServiceQuery);
              setLinkedServiceResults(results);
            }}
          >
            Search
          </Button>
          <Button
            id="service-request-linked-service-clear"
            variant="outline"
            onClick={async () => {
              await setLinkedServiceForDefinitionAction(data.definitionId, null);
              const refreshed = await getServiceRequestDefinitionEditorDataAction(data.definitionId);
              setData(refreshed as EditorData | null);
              toast.success('Linked service cleared');
            }}
          >
            Clear
          </Button>
        </div>
        {linkedServiceResults.length > 0 && (
          <ul className="space-y-2 text-sm">
            {linkedServiceResults.map((result) => (
              <li
                key={result.service_id}
                className="flex items-center justify-between border rounded p-2"
              >
                <div>
                  <div className="font-medium">{result.service_name}</div>
                  <div className="text-xs text-[rgb(var(--color-text-600))]">
                    {result.description ?? 'No description'}
                  </div>
                </div>
                <Button
                  id={`service-request-linked-service-select-${result.service_id}`}
                  variant="outline"
                  onClick={async () => {
                    await setLinkedServiceForDefinitionAction(data.definitionId, result.service_id);
                    const refreshed = await getServiceRequestDefinitionEditorDataAction(data.definitionId);
                    setData(refreshed as EditorData | null);
                    toast.success(`Linked ${result.service_name}`);
                  }}
                >
                  Select
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="service-request-editor-form" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Form</h2>
        <div className="rounded border p-3 bg-[rgb(var(--color-background-100))]">
          <div className="text-sm font-medium mb-2">Rendered Form Preview</div>
          <ul className="space-y-1 text-sm">
            {Array.isArray((data.form.schema as any)?.fields) &&
            (data.form.schema as any).fields.length > 0 ? (
              (data.form.schema as any).fields.map((field: any, index: number) => (
                <li key={`${field?.key ?? 'field'}-${index}`}>{renderFieldPreview(field)}</li>
              ))
            ) : (
              <li>No fields configured.</li>
            )}
          </ul>
        </div>
        <pre className="text-xs bg-[rgb(var(--color-background-100))] p-3 rounded overflow-auto">
          {JSON.stringify(data.form.schema, null, 2)}
        </pre>
      </Card>

      <Card id="service-request-editor-execution" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Execution</h2>
        <div className="grid gap-2">
          <label
            htmlFor="service-request-execution-provider-select"
            className="text-sm font-medium text-[rgb(var(--color-text-700))]"
          >
            Execution Provider
          </label>
          <div className="flex items-center gap-2">
            <select
              id="service-request-execution-provider-select"
              className="border rounded px-3 py-2 text-sm"
              value={data.execution.executionProvider}
              onChange={async (event) => {
                try {
                  await updateServiceRequestExecutionProviderAction(
                    data.definitionId,
                    event.target.value
                  );
                  const refreshed = await getServiceRequestDefinitionEditorDataAction(
                    data.definitionId
                  );
                  setData(refreshed as EditorData | null);
                  toast.success('Execution provider updated');
                } catch (error) {
                  console.error('Failed to update execution provider', error);
                  toast.error('Failed to update execution provider');
                }
              }}
            >
              {data.execution.availableExecutionProviders.map((provider) => (
                <option key={provider.key} value={provider.key}>
                  {provider.displayName} ({provider.executionMode})
                </option>
              ))}
            </select>
          </div>
        </div>
        <FieldRow label="Execution Provider" value={data.execution.executionProvider} />
        <FieldRow label="Execution Config" value={JSON.stringify(data.execution.executionConfig)} />
        <FieldRow label="Form Behavior Provider" value={data.execution.formBehaviorProvider} />
        <FieldRow label="Visibility Provider" value={data.execution.visibilityProvider} />
      </Card>

      <Card id="service-request-editor-publish" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Publish</h2>
        <FieldRow label="Current Draft State" value={data.lifecycleState} />
        <FieldRow
          label="Last Published Version"
          value={data.publish.publishedVersionNumber ? `v${data.publish.publishedVersionNumber}` : 'Never published'}
        />
        <FieldRow
          label="Published At"
          value={data.publish.publishedAt ? new Date(data.publish.publishedAt).toLocaleString() : '-'}
        />
        <FieldRow label="Draft Updated At" value={new Date(data.publish.draftUpdatedAt).toLocaleString()} />
        {validationErrors.length > 0 ? (
          <div className="rounded border border-[rgb(var(--color-danger-400))] bg-[rgb(var(--color-danger-100))] p-3 text-sm">
            <div className="font-semibold mb-1">Publish Validation</div>
            <ul className="list-disc pl-5">
              {validationErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded border border-[rgb(var(--color-success-300))] bg-[rgb(var(--color-success-100))] p-3 text-sm">
            Publish validation passed.
          </div>
        )}
      </Card>

      <Card id="service-request-editor-submissions" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Submissions</h2>
        {submissions.length === 0 ? (
          <div className="text-sm text-[rgb(var(--color-text-600))]">No submissions yet for this definition.</div>
        ) : (
          <div className="space-y-2">
            {submissions.map((submission) => (
              <div
                key={submission.submission_id}
                className="border rounded p-3 flex items-center justify-between gap-3"
              >
                <div className="text-sm">
                  <div className="font-medium">{submission.request_name}</div>
                  <div className="text-[rgb(var(--color-text-600))]">
                    {new Date(submission.submitted_at).toLocaleString()} · {submission.execution_status}
                  </div>
                </div>
                <Button
                  id={`service-request-submission-detail-${submission.submission_id}`}
                  variant="outline"
                  onClick={async () => {
                    const detail = await getServiceRequestDefinitionSubmissionDetailAction(
                      definitionId,
                      submission.submission_id
                    );
                    setSelectedSubmissionId(submission.submission_id);
                    setSelectedSubmissionDetail(detail as DefinitionSubmissionDetail | null);
                  }}
                >
                  View Detail
                </Button>
              </div>
            ))}
          </div>
        )}
        {selectedSubmissionDetail && (
          <div className="rounded border p-3 bg-[rgb(var(--color-background-100))] space-y-2">
            <div className="text-sm font-semibold">Submission Detail</div>
            <FieldRow label="Submission ID" value={selectedSubmissionDetail.submission_id} />
            <FieldRow label="Requester User" value={selectedSubmissionDetail.requester_user_id ?? '-'} />
            <FieldRow label="Client" value={selectedSubmissionDetail.client_id} />
            <FieldRow label="Contact" value={selectedSubmissionDetail.contact_id ?? '-'} />
            <FieldRow label="Ticket Reference" value={selectedSubmissionDetail.created_ticket_id ?? '-'} />
            <FieldRow label="Workflow Reference" value={selectedSubmissionDetail.workflow_execution_id ?? '-'} />
            <FieldRow
              label="Execution Error"
              value={selectedSubmissionDetail.execution_error_summary ?? '-'}
            />
            <pre className="text-xs bg-white p-2 rounded overflow-auto">
              {JSON.stringify(selectedSubmissionDetail.submitted_payload, null, 2)}
            </pre>
          </div>
        )}
      </Card>
    </div>
  );
}
