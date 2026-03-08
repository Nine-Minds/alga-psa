import WorkflowAutomationGate from '../../_components/WorkflowAutomationGate';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'New Workflow',
};

export default function WorkflowEditorNewPage() {
  return <WorkflowAutomationGate workflowProps={{ mode: 'editor-designer', isNew: true }} />;
}
