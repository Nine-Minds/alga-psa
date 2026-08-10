import WorkflowAutomationGate from '../_components/WorkflowAutomationGate';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.workflowEditor.title', { defaultValue: 'Workflow Editor' }),
  };
}

export default function WorkflowEditorListPage() {
  return <WorkflowAutomationGate workflowProps={{ mode: 'editor-list' }} />;
}
