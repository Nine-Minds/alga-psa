import WorkflowAutomationGate from '../_components/WorkflowAutomationGate';


export const metadata = {
  title: 'Workflow Editor',
};

export default function WorkflowEditorListPage() {
  return <WorkflowAutomationGate workflowProps={{ mode: 'editor-list' }} />;
}
