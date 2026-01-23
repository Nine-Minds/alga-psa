'use client';

import * as React from 'react';
import EntityImageUpload from '@alga-psa/ui/components/EntityImageUpload';
import { uploadContactAvatar, deleteContactAvatar } from '@alga-psa/client-portal/actions';

interface ContactAvatarUploadProps {
  contactId: string;
  contactName: string;
  avatarUrl: string | null;
  onAvatarChange?: (newAvatarUrl: string | null) => void;
  userType: string;
  userContactId?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const ContactAvatarUpload: React.FC<ContactAvatarUploadProps> = ({
  contactId,
  contactName,
  avatarUrl,
  onAvatarChange,
  userType,
  userContactId,
  className,
  size,
}) => {
  // Determine if the current user has permission to modify this contact's avatar
  const canModifyAvatar = userType === 'internal' || (userType === 'client' && userContactId === contactId);

  return (
    <EntityImageUpload
      entityType="contact"
      entityId={contactId}
      entityName={contactName}
      imageUrl={avatarUrl}
      onImageChange={onAvatarChange}
      uploadAction={uploadContactAvatar}
      deleteAction={deleteContactAvatar}
      userType={userType}
      userEntityId={userContactId}
      canModify={canModifyAvatar}
      className={className}
      size={size}
    />
  );
};

export default ContactAvatarUpload;
