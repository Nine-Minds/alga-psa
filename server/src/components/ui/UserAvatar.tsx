import * as React from 'react';
import EntityAvatar, { EntityAvatarProps, getDefaultInitials } from './EntityAvatar';

interface UserAvatarProps {
  userId: string;
  userName: string;
  avatarUrl: string | null;
  size?: EntityAvatarProps['size'];
  className?: string;
}

// Uses Array.from() to properly handle Unicode characters like emojis
const getUserInitials = (name: string): string => {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);

  // Use Array.from to properly handle multi-byte Unicode characters (emojis, etc.)
  const getFirstChar = (str: string) => {
    const chars = Array.from(str);
    return chars[0] || '';
  };

  if (words.length === 1) {
    const chars = Array.from(words[0]);
    return chars.length > 1
      ? (chars[0] + chars[1]).toUpperCase()
      : (chars[0] || '?').toUpperCase();
  }
  // Take first character of first and last word
  return (getFirstChar(words[0]) + getFirstChar(words[words.length - 1])).toUpperCase();
};

const UserAvatar: React.FC<UserAvatarProps> = ({
  userId,
  userName,
  avatarUrl,
  size = 'md',
  className,
}) => {
  return (
    <EntityAvatar
      entityId={userId}
      entityName={userName}
      imageUrl={avatarUrl}
      size={size}
      className={className}
      getInitials={getUserInitials}
      altText={`${userName || 'User'} avatar`}
    />
  );
};

export default UserAvatar;
