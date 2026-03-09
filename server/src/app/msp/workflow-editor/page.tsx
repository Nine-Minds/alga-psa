import WorkflowAutomationGate from '../_components/WorkflowAutomationGate';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Workflow Editor',
};

export default function WorkflowEditorListPage() {
  return <WorkflowAutomationGate workflowProps={{ mode: 'editor-list' }} />;
}
