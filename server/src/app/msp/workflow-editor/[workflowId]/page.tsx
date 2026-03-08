import WorkflowAutomationGate from '../../_components/WorkflowAutomationGate';


export async function generateMetadata() {
  return {
    title: 'Edit Workflow',
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
