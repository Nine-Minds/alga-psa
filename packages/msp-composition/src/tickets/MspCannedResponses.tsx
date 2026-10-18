'use client';

import React from 'react';
import { CannedResponsesPage } from '@alga-psa/tickets/components/cannedResponses/CannedResponsesPage';
import { CannedResponseEditor } from '@alga-psa/tickets/components/cannedResponses/CannedResponseEditor';

/** MSP-portal wrappers for the canned response screens; thin, like MspTicketTemplates. */
export function MspCannedResponsesPage() {
  return <CannedResponsesPage />;
}

export function MspCannedResponseEditor({ cannedResponseId }: { cannedResponseId: string }) {
  return <CannedResponseEditor cannedResponseId={cannedResponseId} />;
}
