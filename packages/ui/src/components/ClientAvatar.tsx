import EntityAvatar, { EntityAvatarProps } from './EntityAvatar';

interface ClientAvatarProps {
  clientId: string | number;
  clientName: string;
  logoUrl: string | null;
  size?: EntityAvatarProps['size'];
  className?: string;
}

// Client-specific initials function that takes first letter of first two words
const getClientInitials = (name: string): string => {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].length > 1 ? words[0].substring(0, 2).toUpperCase() : words[0].charAt(0).toUpperCase();
  }
  // Take first letter of first two words
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
};

const ClientAvatar = ({
  clientId,
  clientName,
  logoUrl,
  size = 'md',
  className,
}: ClientAvatarProps) => {
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
