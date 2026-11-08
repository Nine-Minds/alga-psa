'use client';

import {
  duplicateTicketBatch,
  getTicketDuplicateSource,
  type TicketDuplicateBatchResult,
  type TicketDuplicateBatchCopy,
} from '../actions/ticketActions';
import { getContactsByClient } from '../actions/clientLookupActions';

/** Client entry point for the batch duplicate dialog's server actions. */
export function useBatchDuplicateTicketActions() {
  return {
    getSource: getTicketDuplicateSource,
    getContacts: getContactsByClient,
    duplicate: duplicateTicketBatch,
  };
}

export type { TicketDuplicateBatchCopy, TicketDuplicateBatchResult };
