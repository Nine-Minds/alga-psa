export type ServiceRequestExecutionStatus = 'pending' | 'succeeded' | 'failed';

export type ServiceRequestStatusTone = 'success' | 'error' | 'warning';

export interface ServiceRequestStatusLabels {
  pending: string;
  succeeded: string;
  failed: string;
}

/**
 * Single status -> Badge tone + translated label mapping shared by the
 * My Requests list and the submission detail page, so the two always agree.
 * Unknown values fall back to the pending presentation.
 */
export function getSubmissionStatusPresentation(
  status: ServiceRequestExecutionStatus,
  labels: ServiceRequestStatusLabels
): { tone: ServiceRequestStatusTone; label: string } {
  switch (status) {
    case 'succeeded':
      return { tone: 'success', label: labels.succeeded };
    case 'failed':
      return { tone: 'error', label: labels.failed };
    default:
      return { tone: 'warning', label: labels.pending };
  }
}
