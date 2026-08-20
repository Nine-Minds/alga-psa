'use client';

/**
 * CE stub for the global credentials vault screen
 * (ee/server/src/components/credentials/CredentialsScreen.tsx, resolved via
 * the edition-swapped `@enterprise` alias). The credentials vault is an
 * EE-only feature; render nothing in Community Edition.
 */

export interface CredentialsScreenProps {
  /** Optional client scope for the unified client Passwords tab. */
  clientId?: string;
  /** Optional asset scope for the asset detail Passwords section. */
  assetId?: string;
}

export function CredentialsScreen(_props: CredentialsScreenProps) {
  return null;
}

export default CredentialsScreen;
