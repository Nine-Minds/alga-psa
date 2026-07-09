'use client';

// App shell: quick-create modal used in the MSP header.

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { buildCreateTicketHref } from '@alga-psa/tickets/lib/createTicketRoute';

export type QuickCreateType = 'ticket' | 'client' | 'contact' | 'project' | 'asset' | 'service' | 'product' | null;

interface QuickCreateDialogProps {
  type: QuickCreateType;
  onClose: () => void;
}

const QUICK_CREATE_HREFS: Record<Exclude<QuickCreateType, null>, () => string> = {
  ticket: () => buildCreateTicketHref(),
  client: () => '/msp/create-client',
  contact: () => '/msp/create-contact',
  project: () => '/msp/create-project',
  asset: () => '/msp/create-asset',
  service: () => '/msp/create-service',
  product: () => '/msp/create-product',
};

export function QuickCreateDialog({ type, onClose }: QuickCreateDialogProps) {
  const router = useRouter();

  // Quick creation is routed so heavy feature dialogs stay out of the app-shell graph.
  // Soft navigation from /msp/* is intercepted by the @modal slot; hard loads render
  // the matching full create page.
  useEffect(() => {
    if (!type) return;

    router.push(QUICK_CREATE_HREFS[type]());
    onClose();
  }, [type, router, onClose]);

  return null;
}
