'use client';

/**
 * CE stub for the client Documents tab "Hudu Documentation" section
 * (ee/server/src/components/integrations/hudu/HuduClientDocumentsSection.tsx,
 * resolved via the edition-swapped `@enterprise` alias). The CE gate never
 * renders the section; render nothing defensively.
 */

export interface HuduClientDocumentsSectionProps {
  clientId: string;
}

export function HuduClientDocumentsSection(_props: HuduClientDocumentsSectionProps) {
  return null;
}

export default HuduClientDocumentsSection;
