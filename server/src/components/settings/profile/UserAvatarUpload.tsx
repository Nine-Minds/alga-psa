'use client';

import * as React from 'react';
import EntityImageUpload from 'server/src/components/ui/EntityImageUpload';
import { uploadUserAvatar, deleteUserAvatar } from '@product/actions/user-actions/userActions';

interface UserAvatarUploadProps {
  userId: string;
  userName: string;
  avatarUrl: string | null;
  onAvatarChange?: (newAvatarUrl: string | null) => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const UserAvatarUpload: React.FC<UserAvatarUploadProps> = ({
  userId,
  userName,
  avatarUrl,
  onAvatarChange,
  className,
  size,
}) => {
  return (
    <EntityImageUpload
      entityType="user"
      entityId={userId}
      entityName={userName}
      imageUrl={avatarUrl}
      onImageChange={onAvatarChange}
      uploadAction={uploadUserAvatar}
      deleteAction={deleteUserAvatar}
      className={className}
      size={size}
    />
  );
};

export default UserAvatarUpload;
