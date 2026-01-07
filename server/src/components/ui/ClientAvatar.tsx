import * as React from 'react';
import EntityAvatar, { EntityAvatarProps } from './EntityAvatar';

interface ClientAvatarProps {
  clientId: string | number;
  clientName: string;
  logoUrl: string | null;
  size?: EntityAvatarProps['size'];
  className?: string;
}

// Client-specific initials function that takes first character of first two words
// Uses Array.from() to properly handle Unicode characters like emojis
const getClientInitials = (name: string): string => {
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
  // Take first character of first two words
  return (getFirstChar(words[0]) + getFirstChar(words[1])).toUpperCase();
};

const ClientAvatar: React.FC<ClientAvatarProps> = ({
  clientId,
  clientName,
  logoUrl,
  size = 'md',
  className,
}) => {
  return (
    <EntityAvatar
      entityId={clientId}
      entityName={clientName}
      imageUrl={logoUrl}
      size={size}
      className={className}
      getInitials={getClientInitials}
      altText={`${clientName} logo`}
    />
  );
};

export default ClientAvatar;
