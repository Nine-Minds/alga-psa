'use client';

import EntityImageUpload from '@alga-psa/ui/components/EntityImageUpload';

// Dynamic imports to avoid circular dependency (clients -> client-portal -> clients)
// TODO: Consolidate after circular dependency is resolved
const getClientPortalModule = () => '@alga-psa/' + 'client-portal/actions';

const uploadContactAvatar = async (
  contactId: string,
  formData: FormData
): Promise<{ success: boolean; message?: string; imageUrl?: string | null; error?: string }> => {
  const mod = await import(/* webpackIgnore: true */ getClientPortalModule());
  return mod.uploadContactAvatar(contactId, formData);
};

const deleteContactAvatar = async (
  contactId: string
): Promise<{ success: boolean; message?: string; error?: string }> => {
  const mod = await import(/* webpackIgnore: true */ getClientPortalModule());
  return mod.deleteContactAvatar(contactId);
};

interface ContactAvatarUploadProps {
  contactId: string;
  currentAvatarUrl?: string | null;
  onAvatarUpdated?: (newUrl: string | null) => void;
}

export default function ContactAvatarUpload({
  contactId,
  currentAvatarUrl,
  onAvatarUpdated,
}: ContactAvatarUploadProps) {
  return (
    <EntityImageUpload
      entityType="contact"
      entityId={contactId}
      entityName=""
      imageUrl={currentAvatarUrl || null}
      onImageChange={onAvatarUpdated}
      uploadAction={uploadContactAvatar}
      deleteAction={deleteContactAvatar}
      size="md"
    />
  );
}

