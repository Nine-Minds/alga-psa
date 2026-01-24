// Empty module fallback for CE builds
import type { WorkflowProps } from '@alga-psa/workflows/components/WorkflowComponentLoader';

export default function EmptyDnDFlow(props: WorkflowProps) {
  return null;
}
