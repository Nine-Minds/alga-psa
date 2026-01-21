'use client';

import React from 'react';
import { TicketTemplatesManager } from 'server/src/components/settings/tickets/TicketTemplatesManager';

/**
 * Test page for viewing Ticket Templates feature
 * Access at: /msp/test-templates
 *
 * DELETE THIS FILE when ready to integrate into TicketingSettings
 */
export default function TestTemplatesPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-sm text-yellow-800">
          <strong>Test Page:</strong> This is a temporary page for previewing the Ticket Templates feature.
          Delete <code>src/app/(authenticated)/msp/test-templates/page.tsx</code> when ready to integrate.
        </p>
      </div>

      <TicketTemplatesManager />
    </div>
  );
}
