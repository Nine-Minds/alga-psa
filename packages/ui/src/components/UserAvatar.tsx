'use client';

import EntityAvatar, { EntityAvatarProps, getDefaultInitials } from './EntityAvatar';
import { useTranslation } from '../lib/i18n/client';

interface UserAvatarProps {
  userId: string;
  userName: string;
  avatarUrl: string | null;
  size?: EntityAvatarProps['size'];
  className?: string;
}

const getUserInitials = (name: string): string => {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].length > 1 ? words[0].substring(0, 2).toUpperCase() : words[0].charAt(0).toUpperCase();
  }
  // Take first letter of first and last word
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
};

const UserAvatar = ({
  userId,
  userName,
  avatarUrl,
  size = 'md',
  className,
}: UserAvatarProps) => {
  const { t } = useTranslation('common');

  return (
    <EntityAvatar
      entityId={userId}
      entityName={userName}
      imageUrl={avatarUrl}
      size={size}
      className={className}
      getInitials={getUserInitials}
      altText={userName ? t('userAvatar.alt', { name: userName }) : t('userAvatar.defaultAlt')}
    />
  );
};

export default UserAvatar;
