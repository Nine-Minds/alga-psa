import { redirect } from 'next/navigation';
import WorkflowAutomationGate from '../_components/WorkflowAutomationGate';

type WorkflowControlPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const getSingleQueryValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

export default async function WorkflowControlPage({ searchParams }: WorkflowControlPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const section = getSingleQueryValue(resolvedSearchParams.section);

  if ((section ?? '').trim().toLowerCase() === 'workflows') {
    const params = new URLSearchParams();
    for (const [key, rawValue] of Object.entries(resolvedSearchParams)) {
      if (key === 'section') continue;
      const value = getSingleQueryValue(rawValue);
      if (value) {
        params.set(key, value);
      }
    }

    const destination = params.toString()
      ? `/msp/workflow-editor?${params.toString()}`
      : '/msp/workflow-editor';

    redirect(destination);
  }

  return <WorkflowAutomationGate workflowProps={{ mode: 'control-panel' }} />;
}
