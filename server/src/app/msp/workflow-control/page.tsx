import WorkflowAutomationGate from '../_components/WorkflowAutomationGate';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Workflow Control',
};

export default function WorkflowControlPage() {
  return <WorkflowAutomationGate workflowProps={{ mode: 'control-panel' }} />;
}
