'use client';

import EntityImageUpload from '@alga-psa/ui/components/EntityImageUpload';
import {
  uploadContactAvatar as uploadContactAvatarAction,
  deleteContactAvatar as deleteContactAvatarAction
} from '../../actions/contactAvatarActions';

// Wrapper functions to match the expected signature
const uploadContactAvatar = async (
  contactId: string,
  formData: FormData
): Promise<{ success: boolean; message?: string; imageUrl?: string | null; error?: string }> => {
  return uploadContactAvatarAction(contactId, formData);
};

const deleteContactAvatar = async (
  contactId: string
): Promise<{ success: boolean; message?: string; error?: string }> => {
  return deleteContactAvatarAction(contactId);
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
