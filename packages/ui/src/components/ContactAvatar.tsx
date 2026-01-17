import EntityAvatar, { EntityAvatarProps } from './EntityAvatar';

interface ContactAvatarProps {
  contactId: string;
  contactName: string;
  avatarUrl: string | null;
  size?: EntityAvatarProps['size'];
  className?: string;
}

const getContactInitials = (name: string): string => {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].length > 1 ? words[0].substring(0, 2).toUpperCase() : words[0].charAt(0).toUpperCase();
  }
  // Take first letter of first and last word
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
};

const ContactAvatar = ({
  contactId,
  contactName,
  avatarUrl,
  size = 'md',
  className,
}: ContactAvatarProps) => {
  return (
    <EntityAvatar
      entityId={contactId}
      entityName={contactName}
      imageUrl={avatarUrl}
      size={size}
      className={className}
      getInitials={getContactInitials}
      altText={`${contactName || 'Contact'} avatar`}
    />
  );
};

export default ContactAvatar;
