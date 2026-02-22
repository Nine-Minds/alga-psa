import WorkflowAutomationGate from '../../_components/WorkflowAutomationGate';

interface WorkflowEditorPageProps {
  params: {
    workflowId: string;
  };
}

export default function WorkflowEditorPage({ params }: WorkflowEditorPageProps) {
  return (
    <WorkflowAutomationGate
      workflowProps={{
        mode: 'editor-designer',
        workflowId: params.workflowId
      }}
    />
  );
}
