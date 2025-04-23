import * as React from 'react';
import EntityAvatar, { EntityAvatarProps } from './EntityAvatar';

interface CompanyAvatarProps {
  companyId: string | number;
  companyName: string;
  logoUrl: string | null;
  size?: EntityAvatarProps['size'];
  className?: string;
}

// Company-specific initials function that takes first letter of first two words
const getCompanyInitials = (name: string): string => {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].length > 1 ? words[0].substring(0, 2).toUpperCase() : words[0].charAt(0).toUpperCase();
  }
  // Take first letter of first two words
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
};

const CompanyAvatar: React.FC<CompanyAvatarProps> = ({
  companyId,
  companyName,
  logoUrl,
  size = 'md',
  className,
}) => {
  return (
    <EntityAvatar
      entityId={companyId}
      entityName={companyName}
      imageUrl={logoUrl}
      size={size}
      className={className}
      getInitials={getCompanyInitials}
      altText={`${companyName} logo`}
    />
  );
};

export default CompanyAvatar;
