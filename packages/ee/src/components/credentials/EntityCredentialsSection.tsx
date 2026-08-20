'use client';

/**
 * CE stub for the entity credentials section
 * (ee/server/src/components/credentials/EntityCredentialsSection.tsx, resolved
 * via the edition-swapped `@enterprise` alias). Render nothing in CE.
 */

interface EntityCredentialsSectionProps {
  entityType: string;
  entityId: string;
  defaultClientId?: string | null;
  titleKey?: string;
}

export function EntityCredentialsSection(_props: EntityCredentialsSectionProps) {
  return null;
}

export default EntityCredentialsSection;
