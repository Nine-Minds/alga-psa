'use client';

/**
 * CE stub for the credentials restrict dialog
 * (ee/server/src/components/credentials/CredentialRestrictDialog.tsx, resolved
 * via the edition-swapped `@enterprise` alias). Render nothing in CE.
 */

interface CredentialRestrictDialogProps {
  credential: { id: string; source: 'alga' | 'hudu'; isRestricted: boolean } | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function CredentialRestrictDialog(_props: CredentialRestrictDialogProps) {
  return null;
}

export default CredentialRestrictDialog;
