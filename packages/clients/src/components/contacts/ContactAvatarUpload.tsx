'use client';

import EntityImageUpload from '@alga-psa/ui/components/EntityImageUpload';
import { uploadContactAvatar, deleteContactAvatar } from '@alga-psa/client-portal/actions';

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

