'use client';

/**
 * CE stub for the "link existing" credential picker
 * (ee/server/src/components/credentials/CredentialLinkDialog.tsx, resolved via
 * the edition-swapped `@enterprise` alias). Render nothing in CE.
 */

interface CredentialLinkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  clientId?: string | null;
  excludeCredentialIds?: string[];
  onSelect: (credential: unknown) => Promise<void>;
}

export function CredentialLinkDialog(_props: CredentialLinkDialogProps) {
  return null;
}

export default CredentialLinkDialog;
