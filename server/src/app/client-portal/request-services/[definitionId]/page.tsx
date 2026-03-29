import { notFound } from 'next/navigation';
import { getRequestServiceDefinitionDetailAction } from './actions';

interface RequestServiceDetailPageProps {
  params: Promise<{
    definitionId: string;
  }>;
}

function renderFieldPreview(field: any): string {
  const label = typeof field?.label === 'string' ? field.label : field?.key ?? 'Untitled field';
  const type = typeof field?.type === 'string' ? field.type : 'unknown';
  const required = field?.required ? 'required' : 'optional';
  return `${label} (${type}, ${required})`;
}

export default async function RequestServiceDetailPage(props: RequestServiceDetailPageProps) {
  const { definitionId } = await props.params;
  const detail = await getRequestServiceDefinitionDetailAction(definitionId);

  if (!detail) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{detail.title}</h1>
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          Version {detail.versionNumber} · {detail.icon ?? 'service'}
        </p>
      </div>
      {detail.description && (
        <p className="text-sm text-[rgb(var(--color-text-700))]">{detail.description}</p>
      )}

      <section className="rounded border p-4 bg-[rgb(var(--color-background-100))]">
        <h2 className="text-base font-semibold mb-2">Request Form</h2>
        <ul className="space-y-1 text-sm">
          {Array.isArray((detail.formSchema as any)?.fields) &&
          (detail.formSchema as any).fields.length > 0 ? (
            (detail.formSchema as any).fields.map((field: any, index: number) => (
              <li key={`${field?.key ?? 'field'}-${index}`}>{renderFieldPreview(field)}</li>
            ))
          ) : (
            <li>No fields configured.</li>
          )}
        </ul>
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
