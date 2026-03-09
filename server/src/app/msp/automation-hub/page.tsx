import { redirect } from 'next/navigation';

type AutomationHubPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const getSingleQueryValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

export default async function AutomationHubPage({ searchParams }: AutomationHubPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const params = new URLSearchParams();
  const executionId = getSingleQueryValue(resolvedSearchParams.executionId);
  const tab = getSingleQueryValue(resolvedSearchParams.tab);

  for (const [key, rawValue] of Object.entries(resolvedSearchParams)) {
    if (key === 'tab' || key === 'executionId') continue;
    const value = getSingleQueryValue(rawValue);
    if (value) {
      params.set(key, value);
    }
  }

  if (executionId && (tab === 'logs' || tab === 'logs-history')) {
    const destination = params.toString()
      ? `/msp/workflow-control?section=runs&${params.toString()}`
      : '/msp/workflow-control?section=runs';
    redirect(destination);
  }

  if (tab === 'workflows') {
    const destination = params.toString()
      ? `/msp/workflow-editor?${params.toString()}`
      : '/msp/workflow-editor';
    redirect(destination);
  }

  const section =
    tab === 'schedules' ? 'schedules'
          : tab === 'events-catalog' ? 'event-catalog'
            : tab === 'logs' || tab === 'logs-history' ? 'runs'
              : null;

  if (tab === 'template-library' || tab === 'templates') {
    const destination = params.toString()
      ? `/msp/workflow-editor?${params.toString()}`
      : '/msp/workflow-editor';
    redirect(destination);
  }

  if (section) {
    params.set('section', section);
  }

  const destination = params.toString()
    ? `/msp/workflow-control?${params.toString()}`
    : '/msp/workflow-control';

  redirect(destination);
}
