import WorkflowAutomationGate from '../../_components/WorkflowAutomationGate';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.workflowEditor.detail.title', { defaultValue: 'Edit Workflow' }),
  };
}

interface WorkflowEditorPageProps {
  params: Promise<{
    workflowId: string;
  }>;
}

export default async function WorkflowEditorPage({ params }: WorkflowEditorPageProps) {
  const resolvedParams = await params;

  return (
    <WorkflowAutomationGate
      workflowProps={{
        mode: 'editor-designer',
        workflowId: resolvedParams.workflowId
      }}
    />
  );
}
