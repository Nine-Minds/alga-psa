'use client';

/**
 * CE stub for the client "Passwords" tab
 * (ee/server/src/components/integrations/hudu/HuduClientPasswordsTab.tsx,
 * resolved via the edition-swapped `@enterprise` alias). The CE gate never
 * registers the tab; render nothing defensively.
 */

export interface HuduClientPasswordsTabProps {
  clientId: string;
}

export function HuduClientPasswordsTab(_props: HuduClientPasswordsTabProps) {
  return null;
}

export default HuduClientPasswordsTab;
