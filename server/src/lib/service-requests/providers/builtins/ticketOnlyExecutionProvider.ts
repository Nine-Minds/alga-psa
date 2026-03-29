import { SERVICE_REQUEST_EXECUTION_MODES } from '../../domain';
import type { ServiceRequestExecutionProvider } from '../contracts';

export const ticketOnlyExecutionProvider: ServiceRequestExecutionProvider = {
  key: 'ticket-only',
  displayName: 'Ticket Only',
  executionMode: SERVICE_REQUEST_EXECUTION_MODES.TICKET_ONLY,
  validateConfig: () => ({ isValid: true }),
  async execute() {
    return {
      status: 'failed',
      errorSummary: 'Ticket execution is not wired yet.',
    };
  },
};
