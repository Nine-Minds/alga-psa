'use client';

// EE implementation of the `@alga-psa/workflows/ticket-actions` client seam.
// CE resolves the same specifier to packages/ee/src/workflows/createFromTicket/entry.tsx.
import CreateWorkflowFromTicketDialog from './CreateWorkflowFromTicketDialog';

export const createWorkflowFromTicketEnabled = true;

export { CreateWorkflowFromTicketDialog };
export type { CreateWorkflowFromTicketDialogProps } from './CreateWorkflowFromTicketDialog';
