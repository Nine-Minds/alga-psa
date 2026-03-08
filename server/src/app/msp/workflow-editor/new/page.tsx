import WorkflowAutomationGate from '../../_components/WorkflowAutomationGate';


export const metadata = {
  title: 'New Workflow',
};

export default function WorkflowEditorNewPage() {
  return <WorkflowAutomationGate workflowProps={{ mode: 'editor-designer', isNew: true }} />;
}
