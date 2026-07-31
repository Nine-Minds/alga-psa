'use client';

/**
 * CE stub for the client "Hudu" tab
 * (ee/server/src/components/integrations/hudu/HuduClientTab.tsx, resolved via
 * the edition-swapped `@enterprise` alias). The CE gate never registers the
 * tab; render nothing defensively.
 */

export interface HuduClientTabProps {
  clientId: string;
}

export function HuduClientTab(_props: HuduClientTabProps) {
  return null;
}

export default HuduClientTab;
