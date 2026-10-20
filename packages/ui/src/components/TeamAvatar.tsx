'use client';

import EntityAvatar, { EntityAvatarProps, getDefaultInitials } from './EntityAvatar';
import { useTranslation } from '../lib/i18n/client';

interface TeamAvatarProps {
  teamId: string;
  teamName: string;
  avatarUrl: string | null;
  size?: EntityAvatarProps['size'];
  className?: string;
}

const TeamAvatar = ({
  teamId,
  teamName,
  avatarUrl,
  size = 'md',
  className,
}: TeamAvatarProps) => {
  const { t } = useTranslation('common');

  return (
    <EntityAvatar
      entityId={teamId}
      entityName={teamName}
      imageUrl={avatarUrl}
      size={size}
      className={className}
      getInitials={getDefaultInitials}
      altText={teamName ? t('teamAvatar.alt', { name: teamName }) : t('teamAvatar.defaultAlt')}
    />
  );
};

export default TeamAvatar;
