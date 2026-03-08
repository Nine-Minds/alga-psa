import WorkflowAutomationGate from '../_components/WorkflowAutomationGate';


export const metadata = {
  title: 'Workflow Control',
};

export default function WorkflowControlPage() {
  return <WorkflowAutomationGate workflowProps={{ mode: 'control-panel' }} />;
}
