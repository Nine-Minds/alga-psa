'use client';

/**
 * CE stub for the per-credential audit History panel
 * (ee/server/src/components/credentials/CredentialAuditPanel.tsx, resolved via
 * the edition-swapped `@enterprise` alias). The credentials vault is an
 * EE-only feature; render nothing in Community Edition.
 */

export interface CredentialAuditPanelProps {
  credentialId: string;
}

export function CredentialAuditPanel(_props: CredentialAuditPanelProps) {
  return null;
}

export default CredentialAuditPanel;
