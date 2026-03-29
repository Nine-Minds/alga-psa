'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  getServiceRequestDefinitionEditorDataAction,
  publishServiceRequestDefinitionAction,
  saveServiceRequestDefinitionDraftAction,
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
  };
  publish: {
    publishedVersionNumber: number | null;
    publishedAt: string | Date | null;
    draftUpdatedAt: string | Date;
  };
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

  useEffect(() => {
    const load = async () => {
      try {
        const result = await getServiceRequestDefinitionEditorDataAction(definitionId);
        setData(result as EditorData | null);
        if (result) {
          const validation = await validateServiceRequestDefinitionForPublishAction(definitionId);
          setValidationErrors(validation.errors ?? []);
        } else {
          setValidationErrors([]);
        }
      } finally {
        setLoading(false);
      }
    };

    if (definitionId) {
      load();
    }
  }, [definitionId]);

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
    </div>
  );
}
