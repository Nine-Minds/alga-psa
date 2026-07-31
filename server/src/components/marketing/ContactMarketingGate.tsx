'use client';

import React from 'react';
import { useFeatureFlag } from '@alga-psa/ui/hooks/useFeatureFlag';
import { ContactMarketingSection } from '@alga-psa/marketing/components';

/**
 * Renders the marketing section on the contact record only when the
 * marketing-module feature flag is on. Kept as a separate gate so the
 * contact detail page (and the clients package) carries no marketing
 * dependency of its own.
 */
export function ContactMarketingGate({ contactId }: { contactId: string }): React.ReactElement | null {
  const flag = useFeatureFlag('marketing-module', { defaultValue: false });
  const enabled = typeof flag === 'boolean' ? flag : flag?.enabled ?? false;
  if (!enabled) return null;
  return (
    <div className="mt-4">
      <ContactMarketingSection contactId={contactId} />
    </div>
  );
}
