'use client';

/**
 * CE stub for the credentials create/edit dialog
 * (ee/server/src/components/credentials/CredentialFormDialog.tsx, resolved via
 * the edition-swapped `@enterprise` alias). Render nothing in Community Edition.
 */

export interface CredentialFormValue {
  clientId: string;
  name: string;
  username: string;
  /** `undefined` = leave unchanged on edit; `null` = explicitly clear. */
  password: string | null | undefined;
  /** `undefined` = leave unchanged on edit; `null` = explicitly clear. */
  otpSecret: string | null | undefined;
  url: string;
  description: string;
  destination: 'alga' | 'hudu';
  assetIds: string[];
}

interface CredentialFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (value: CredentialFormValue) => Promise<void>;
  defaultClientId?: string | null;
  assetId?: string | null;
  editing?: { id: string; clientId: string; name: string; attachedAssetIds: string[] } | null;
  clients?: { client_id: string; client_name: string }[];
  context: { tierOk: boolean; huduConnected: boolean; flagIrrelevantHere: true } | null;
  onError?: () => void;
}

export function CredentialFormDialog(_props: CredentialFormDialogProps) {
  return null;
}

export default CredentialFormDialog;
