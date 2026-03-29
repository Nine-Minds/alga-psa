'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  addServiceRequestFormFieldAction,
  getServiceRequestDefinitionSubmissionDetailAction,
  getServiceRequestDefinitionEditorDataAction,
  listServiceRequestDefinitionSubmissionsAction,
  publishServiceRequestDefinitionAction,
  removeServiceRequestFormFieldAction,
  reorderServiceRequestFormFieldsAction,
  saveServiceRequestDefinitionDraftAction,
  searchLinkedServicesForDefinitionAction,
  updateServiceRequestFormFieldAction,
  updateServiceRequestExecutionConfigAction,
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
    availableFormBehaviorProviders: Array<{
      key: string;
      displayName: string;
    }>;
    showWorkflowExecutionConfigPanel: boolean;
    showAdvancedFormBehaviorConfigPanel: boolean;
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

interface FormFieldOption {
  label: string;
  value: string;
}

interface FormField {
  key: string;
  type: 'short-text' | 'long-text' | 'select' | 'checkbox' | 'date' | 'file-upload';
  label: string;
  helpText?: string | null;
  required?: boolean;
  defaultValue?: string | boolean | null;
  options?: FormFieldOption[];
}

const FORM_FIELD_TYPES: Array<FormField['type']> = [
  'short-text',
  'long-text',
  'select',
  'checkbox',
  'date',
  'file-upload',
];

function getSchemaFields(schema: Record<string, unknown>): FormField[] {
  if (!Array.isArray((schema as any)?.fields)) {
    return [];
  }
  return (schema as any).fields.filter((field: unknown) => field && typeof field === 'object');
}

function parseSelectOptionsText(optionsText: string): FormFieldOption[] {
  return optionsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex <= 0 || separatorIndex >= line.length - 1) {
        return null;
      }
      const value = line.slice(0, separatorIndex).trim();
      const label = line.slice(separatorIndex + 1).trim();
      if (!value || !label) {
        return null;
      }
      return { value, label };
    })
    .filter((option): option is FormFieldOption => option !== null);
}

function formatSelectOptionsText(options: FormFieldOption[] | undefined): string {
  if (!Array.isArray(options) || options.length === 0) {
    return '';
  }
  return options.map((option) => `${option.value}:${option.label}`).join('\n');
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
  const [workflowIdInput, setWorkflowIdInput] = useState('');
  const [workflowInputMappingText, setWorkflowInputMappingText] = useState('{}');
  const [ticketRoutingConfigInput, setTicketRoutingConfigInput] = useState({
    boardId: '',
    statusId: '',
    priorityId: '',
    categoryId: '',
    subcategoryId: '',
    assignedToUserId: '',
    titleFieldKey: '',
    descriptionPrefix: '',
  });
  const [newFieldType, setNewFieldType] = useState<FormField['type']>('short-text');

  const isWorkflowBackedExecution = data?.execution.showWorkflowExecutionConfigPanel === true;
  const isTicketOnlyExecution = data?.execution.executionProvider === 'ticket-only';

  const reloadDefinitionEditorState = async (
    targetDefinitionId: string,
    includeSubmissionDetail: boolean = false
  ) => {
    const refreshed = await getServiceRequestDefinitionEditorDataAction(targetDefinitionId);
    setData(refreshed as EditorData | null);
    const validation = await validateServiceRequestDefinitionForPublishAction(targetDefinitionId);
    setValidationErrors(validation.errors ?? []);

    if (refreshed) {
      const definitionSubmissions = await listServiceRequestDefinitionSubmissionsAction(targetDefinitionId);
      setSubmissions(definitionSubmissions as DefinitionSubmissionRow[]);

      if (includeSubmissionDetail && selectedSubmissionId) {
        const detail = await getServiceRequestDefinitionSubmissionDetailAction(
          targetDefinitionId,
          selectedSubmissionId
        );
        setSelectedSubmissionDetail(detail as DefinitionSubmissionDetail | null);
      }
    }
  };

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

  useEffect(() => {
    if (!data) {
      return;
    }

    const executionConfig = data.execution.executionConfig ?? {};
    const workflowId =
      typeof executionConfig.workflowId === 'string' ? executionConfig.workflowId : '';
    const inputMapping =
      executionConfig.inputMapping &&
      typeof executionConfig.inputMapping === 'object' &&
      !Array.isArray(executionConfig.inputMapping)
        ? executionConfig.inputMapping
        : {};

    setWorkflowIdInput(workflowId);
    setWorkflowInputMappingText(JSON.stringify(inputMapping, null, 2));
  }, [data]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const config = data.execution.executionConfig ?? {};
    const resolveConfigString = (key: string): string =>
      typeof config[key] === 'string' ? (config[key] as string) : '';

    setTicketRoutingConfigInput({
      boardId: resolveConfigString('boardId'),
      statusId: resolveConfigString('statusId'),
      priorityId: resolveConfigString('priorityId'),
      categoryId: resolveConfigString('categoryId'),
      subcategoryId: resolveConfigString('subcategoryId'),
      assignedToUserId: resolveConfigString('assignedToUserId'),
      titleFieldKey: resolveConfigString('titleFieldKey'),
      descriptionPrefix: resolveConfigString('descriptionPrefix'),
    });
  }, [data]);

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
                await reloadDefinitionEditorState(data.definitionId, true);
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
              await reloadDefinitionEditorState(data.definitionId);
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
                    await reloadDefinitionEditorState(data.definitionId);
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
        <div className="rounded border p-3 bg-[rgb(var(--color-background-100))] space-y-3">
          <div className="text-sm font-semibold">Author Fields</div>
          <div className="flex items-center gap-2">
            <select
              id="service-request-form-new-field-type"
              className="border rounded px-3 py-2 text-sm"
              value={newFieldType}
              onChange={(event) => setNewFieldType(event.target.value as FormField['type'])}
            >
              {FORM_FIELD_TYPES.map((fieldType) => (
                <option key={fieldType} value={fieldType}>
                  {fieldType}
                </option>
              ))}
            </select>
            <Button
              id="service-request-form-add-field"
              variant="outline"
              onClick={async () => {
                try {
                  await addServiceRequestFormFieldAction(data.definitionId, newFieldType);
                  await reloadDefinitionEditorState(data.definitionId);
                  toast.success('Field added');
                } catch (error) {
                  console.error('Failed to add form field', error);
                  toast.error('Failed to add form field');
                }
              }}
            >
              Add Field
            </Button>
          </div>
          <div className="space-y-3">
            {getSchemaFields(data.form.schema).length === 0 ? (
              <div className="text-sm text-[rgb(var(--color-text-600))]">No fields configured.</div>
            ) : (
              getSchemaFields(data.form.schema).map((field, index, allFields) => {
                const key = field.key ?? `field_${index}`;
                const optionsText = formatSelectOptionsText(field.options);
                return (
                  <div key={`${key}-${index}`} className="rounded border bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">
                        {field.type} · <span className="font-mono">{key}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          id={`service-request-form-move-up-${key}`}
                          variant="outline"
                          onClick={async () => {
                            const nextKeys = allFields.map((candidate) => candidate.key);
                            const currentIndex = nextKeys.indexOf(key);
                            if (currentIndex <= 0) {
                              return;
                            }
                            [nextKeys[currentIndex - 1], nextKeys[currentIndex]] = [
                              nextKeys[currentIndex],
                              nextKeys[currentIndex - 1],
                            ];
                            await reorderServiceRequestFormFieldsAction(data.definitionId, nextKeys);
                            await reloadDefinitionEditorState(data.definitionId);
                          }}
                        >
                          Move Up
                        </Button>
                        <Button
                          id={`service-request-form-move-down-${key}`}
                          variant="outline"
                          onClick={async () => {
                            const nextKeys = allFields.map((candidate) => candidate.key);
                            const currentIndex = nextKeys.indexOf(key);
                            if (currentIndex < 0 || currentIndex >= nextKeys.length - 1) {
                              return;
                            }
                            [nextKeys[currentIndex], nextKeys[currentIndex + 1]] = [
                              nextKeys[currentIndex + 1],
                              nextKeys[currentIndex],
                            ];
                            await reorderServiceRequestFormFieldsAction(data.definitionId, nextKeys);
                            await reloadDefinitionEditorState(data.definitionId);
                          }}
                        >
                          Move Down
                        </Button>
                        <Button
                          id={`service-request-form-remove-field-${key}`}
                          variant="outline"
                          onClick={async () => {
                            await removeServiceRequestFormFieldAction(data.definitionId, key);
                            await reloadDefinitionEditorState(data.definitionId);
                            toast.success('Field removed');
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium">Label</span>
                        <input
                          defaultValue={field.label ?? key}
                          className="border rounded px-2 py-1"
                          onBlur={async (event) => {
                            await updateServiceRequestFormFieldAction(data.definitionId, key, {
                              label: event.target.value.trim() || key,
                            });
                            await reloadDefinitionEditorState(data.definitionId);
                          }}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium">Help Text</span>
                        <input
                          defaultValue={field.helpText ?? ''}
                          className="border rounded px-2 py-1"
                          onBlur={async (event) => {
                            const value = event.target.value.trim();
                            await updateServiceRequestFormFieldAction(data.definitionId, key, {
                              helpText: value.length > 0 ? value : null,
                            });
                            await reloadDefinitionEditorState(data.definitionId);
                          }}
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          defaultChecked={Boolean(field.required)}
                          onChange={async (event) => {
                            await updateServiceRequestFormFieldAction(data.definitionId, key, {
                              required: event.target.checked,
                            });
                            await reloadDefinitionEditorState(data.definitionId);
                          }}
                        />
                        <span>Required</span>
                      </label>
                      {field.type !== 'file-upload' && (
                        <label className="grid gap-1 text-sm">
                          <span className="font-medium">Default Value</span>
                          {field.type === 'checkbox' ? (
                            <select
                              defaultValue={
                                typeof field.defaultValue === 'boolean'
                                  ? String(field.defaultValue)
                                  : ''
                              }
                              className="border rounded px-2 py-1"
                              onChange={async (event) => {
                                const value = event.target.value;
                                await updateServiceRequestFormFieldAction(data.definitionId, key, {
                                  defaultValue:
                                    value === ''
                                      ? null
                                      : value === 'true',
                                });
                                await reloadDefinitionEditorState(data.definitionId);
                              }}
                            >
                              <option value="">No default</option>
                              <option value="true">Checked</option>
                              <option value="false">Unchecked</option>
                            </select>
                          ) : (
                            <input
                              defaultValue={
                                typeof field.defaultValue === 'string' ? field.defaultValue : ''
                              }
                              className="border rounded px-2 py-1"
                              onBlur={async (event) => {
                                const value = event.target.value.trim();
                                await updateServiceRequestFormFieldAction(data.definitionId, key, {
                                  defaultValue: value.length > 0 ? value : null,
                                });
                                await reloadDefinitionEditorState(data.definitionId);
                              }}
                            />
                          )}
                        </label>
                      )}
                    </div>
                    {field.type === 'select' && (
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium">Options (one per line: value:label)</span>
                        <textarea
                          className="border rounded px-2 py-1 font-mono min-h-[84px]"
                          defaultValue={optionsText}
                          onBlur={async (event) => {
                            await updateServiceRequestFormFieldAction(data.definitionId, key, {
                              options: parseSelectOptionsText(event.target.value),
                            });
                            await reloadDefinitionEditorState(data.definitionId);
                          }}
                        />
                      </label>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="rounded border p-3 bg-[rgb(var(--color-background-100))]">
          <div className="text-sm font-medium mb-2">Rendered Form Preview</div>
          {getSchemaFields(data.form.schema).length > 0 ? (
            <form className="space-y-3">
              {getSchemaFields(data.form.schema).map((field, index) => {
                const key = field.key ?? `field_${index}`;
                const label = field.label ?? key;
                const helpText = field.helpText ?? null;
                const required = Boolean(field.required);
                const defaultStringValue =
                  typeof field.defaultValue === 'string' ? field.defaultValue : '';
                const defaultBooleanValue =
                  typeof field.defaultValue === 'boolean' ? field.defaultValue : false;

                if (field.type === 'long-text') {
                  return (
                    <label key={key} className="block space-y-1">
                      <span className="text-sm font-medium">
                        {label}
                        {required ? ' *' : ''}
                      </span>
                      <textarea
                        disabled
                        rows={4}
                        defaultValue={defaultStringValue}
                        className="w-full rounded border p-2 text-sm bg-gray-50"
                      />
                      {helpText && <span className="text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>}
                    </label>
                  );
                }

                if (field.type === 'select') {
                  return (
                    <label key={key} className="block space-y-1">
                      <span className="text-sm font-medium">
                        {label}
                        {required ? ' *' : ''}
                      </span>
                      <select
                        disabled
                        defaultValue={defaultStringValue}
                        className="w-full rounded border p-2 text-sm bg-gray-50"
                      >
                        <option value="">Select an option</option>
                        {(field.options ?? []).map((option, optionIndex) => (
                          <option key={`${key}-option-${optionIndex}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {helpText && <span className="text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>}
                    </label>
                  );
                }

                if (field.type === 'checkbox') {
                  return (
                    <label key={key} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        disabled
                        defaultChecked={defaultBooleanValue}
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

                if (field.type === 'file-upload') {
                  return (
                    <label key={key} className="block space-y-1">
                      <span className="text-sm font-medium">
                        {label}
                        {required ? ' *' : ''}
                      </span>
                      <input
                        disabled
                        type="file"
                        className="w-full rounded border p-2 text-sm bg-gray-50"
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
                      disabled
                      type={field.type === 'date' ? 'date' : 'text'}
                      defaultValue={defaultStringValue}
                      className="w-full rounded border p-2 text-sm bg-gray-50"
                    />
                    {helpText && <span className="text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>}
                  </label>
                );
              })}
            </form>
          ) : (
            <ul className="space-y-1 text-sm">
              <li>No fields configured.</li>
            </ul>
          )}
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
                  await reloadDefinitionEditorState(data.definitionId);
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
        {isTicketOnlyExecution && (
          <div className="space-y-3 rounded border p-3 bg-[rgb(var(--color-background-100))]">
            <h3 className="text-sm font-semibold">Ticket Routing Configuration</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Board ID</span>
                <input
                  id="service-request-ticket-board-id"
                  className="border rounded px-3 py-2 text-sm"
                  value={ticketRoutingConfigInput.boardId}
                  onChange={(event) =>
                    setTicketRoutingConfigInput((previous) => ({
                      ...previous,
                      boardId: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Status ID</span>
                <input
                  id="service-request-ticket-status-id"
                  className="border rounded px-3 py-2 text-sm"
                  value={ticketRoutingConfigInput.statusId}
                  onChange={(event) =>
                    setTicketRoutingConfigInput((previous) => ({
                      ...previous,
                      statusId: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Priority ID</span>
                <input
                  id="service-request-ticket-priority-id"
                  className="border rounded px-3 py-2 text-sm"
                  value={ticketRoutingConfigInput.priorityId}
                  onChange={(event) =>
                    setTicketRoutingConfigInput((previous) => ({
                      ...previous,
                      priorityId: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Category ID</span>
                <input
                  id="service-request-ticket-category-id"
                  className="border rounded px-3 py-2 text-sm"
                  value={ticketRoutingConfigInput.categoryId}
                  onChange={(event) =>
                    setTicketRoutingConfigInput((previous) => ({
                      ...previous,
                      categoryId: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Subcategory ID</span>
                <input
                  id="service-request-ticket-subcategory-id"
                  className="border rounded px-3 py-2 text-sm"
                  value={ticketRoutingConfigInput.subcategoryId}
                  onChange={(event) =>
                    setTicketRoutingConfigInput((previous) => ({
                      ...previous,
                      subcategoryId: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Assigned User ID</span>
                <input
                  id="service-request-ticket-assigned-user-id"
                  className="border rounded px-3 py-2 text-sm"
                  value={ticketRoutingConfigInput.assignedToUserId}
                  onChange={(event) =>
                    setTicketRoutingConfigInput((previous) => ({
                      ...previous,
                      assignedToUserId: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Title Field Key</span>
                <input
                  id="service-request-ticket-title-field-key"
                  className="border rounded px-3 py-2 text-sm"
                  value={ticketRoutingConfigInput.titleFieldKey}
                  onChange={(event) =>
                    setTicketRoutingConfigInput((previous) => ({
                      ...previous,
                      titleFieldKey: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm md:col-span-2">
                <span className="font-medium">Description Prefix</span>
                <textarea
                  id="service-request-ticket-description-prefix"
                  className="border rounded px-3 py-2 text-sm min-h-[72px]"
                  value={ticketRoutingConfigInput.descriptionPrefix}
                  onChange={(event) =>
                    setTicketRoutingConfigInput((previous) => ({
                      ...previous,
                      descriptionPrefix: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div>
              <Button
                id="service-request-ticket-config-save"
                variant="outline"
                onClick={async () => {
                  const nextExecutionConfig = Object.entries(ticketRoutingConfigInput).reduce<
                    Record<string, unknown>
                  >((result, [key, value]) => {
                    const trimmedValue = value.trim();
                    if (trimmedValue.length > 0) {
                      result[key] = trimmedValue;
                    }
                    return result;
                  }, {});

                  await updateServiceRequestExecutionConfigAction(
                    data.definitionId,
                    nextExecutionConfig
                  );
                  await reloadDefinitionEditorState(data.definitionId);
                  toast.success('Ticket routing configuration updated');
                }}
              >
                Save Ticket Routing
              </Button>
            </div>
          </div>
        )}
        {isWorkflowBackedExecution && (
          <div className="space-y-3 rounded border p-3 bg-[rgb(var(--color-background-100))]">
            <h3 className="text-sm font-semibold">Workflow Configuration</h3>
            <div className="grid gap-2">
              <label
                htmlFor="service-request-workflow-id-input"
                className="text-sm font-medium text-[rgb(var(--color-text-700))]"
              >
                Workflow ID
              </label>
              <input
                id="service-request-workflow-id-input"
                className="border rounded px-3 py-2 text-sm"
                placeholder="workflow-id"
                value={workflowIdInput}
                onChange={(event) => setWorkflowIdInput(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <label
                htmlFor="service-request-workflow-input-mapping"
                className="text-sm font-medium text-[rgb(var(--color-text-700))]"
              >
                Workflow Input Mapping (JSON object)
              </label>
              <textarea
                id="service-request-workflow-input-mapping"
                className="border rounded px-3 py-2 text-sm font-mono min-h-[140px]"
                value={workflowInputMappingText}
                onChange={(event) => setWorkflowInputMappingText(event.target.value)}
              />
              <p className="text-xs text-[rgb(var(--color-text-600))]">
                Example: &#123;&quot;requestedBy&quot;:&quot;payload.request_title&quot;,&quot;ticketReference&quot;:&quot;ticketId&quot;&#125;
              </p>
            </div>
            <div>
              <Button
                id="service-request-workflow-config-save"
                variant="outline"
                onClick={async () => {
                  try {
                    const parsedInputMapping = workflowInputMappingText.trim()
                      ? JSON.parse(workflowInputMappingText)
                      : {};
                    if (
                      !parsedInputMapping ||
                      typeof parsedInputMapping !== 'object' ||
                      Array.isArray(parsedInputMapping)
                    ) {
                      toast.error('Workflow input mapping must be a JSON object');
                      return;
                    }

                    const nextExecutionConfig: Record<string, unknown> = {
                      ...data.execution.executionConfig,
                      workflowId: workflowIdInput.trim(),
                      inputMapping: parsedInputMapping as Record<string, string>,
                    };

                    await updateServiceRequestExecutionConfigAction(
                      data.definitionId,
                      nextExecutionConfig
                    );
                    await reloadDefinitionEditorState(data.definitionId);
                    toast.success('Workflow configuration updated');
                  } catch (error) {
                    console.error('Failed to update workflow configuration', error);
                    toast.error('Invalid workflow configuration JSON');
                  }
                }}
              >
                Save Workflow Settings
              </Button>
            </div>
          </div>
        )}
        {data.execution.showAdvancedFormBehaviorConfigPanel && (
          <div className="rounded border p-3 bg-[rgb(var(--color-background-100))] text-sm text-[rgb(var(--color-text-700))]">
            <div className="font-semibold mb-1">Advanced Form Behavior</div>
            <div>
              Conditional visibility and context-aware defaults are enabled via the registered
              enterprise form-behavior provider.
            </div>
          </div>
        )}
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
