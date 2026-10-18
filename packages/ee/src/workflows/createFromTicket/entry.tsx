'use client';

// CE stub for the `@alga-psa/workflows/ticket-actions` client seam. The feature is
// disabled in CE: callers must check `createWorkflowFromTicketEnabled` and never render this.
export const createWorkflowFromTicketEnabled = false;

export interface CreateWorkflowFromTicketDialogProps {
  ticketId: string;
  ticketNumber: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateWorkflowFromTicketDialog(_props: CreateWorkflowFromTicketDialogProps): null {
  return null;
}
