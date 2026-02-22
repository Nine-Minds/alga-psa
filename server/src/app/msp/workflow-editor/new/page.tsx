import WorkflowAutomationGate from '../../_components/WorkflowAutomationGate';

export default function WorkflowEditorNewPage() {
  return <WorkflowAutomationGate workflowProps={{ mode: 'editor-designer', isNew: true }} />;
}
