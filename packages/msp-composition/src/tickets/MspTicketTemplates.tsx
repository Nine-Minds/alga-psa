'use client';

import React from 'react';
import { TicketTemplatesPage } from '@alga-psa/tickets/components/templates/TicketTemplatesPage';
import { TicketTemplateEditor } from '@alga-psa/tickets/components/templates/TicketTemplateEditor';

/**
 * MSP-portal wrappers for the ticket template screens. Templates reference no cross-feature pickers
 * (no assets, no clients), so these are thin; they exist so the route files import from composition
 * like every other MSP ticket screen.
 */
export function MspTicketTemplatesPage({ isAlgaDeskMode = false }: { isAlgaDeskMode?: boolean }) {
  return <TicketTemplatesPage isAlgaDeskMode={isAlgaDeskMode} />;
}

export function MspTicketTemplateEditor({ templateId, fromTicketId }: { templateId: string; fromTicketId?: string }) {
  return <TicketTemplateEditor templateId={templateId} fromTicketId={fromTicketId} />;
}
