import WorkflowAutomationGate from '../../_components/WorkflowAutomationGate';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.workflowEditor.new.title', { defaultValue: 'New Workflow' }),
  };
}

export default function WorkflowEditorNewPage() {
  return <WorkflowAutomationGate workflowProps={{ mode: 'editor-designer', isNew: true }} />;
}
