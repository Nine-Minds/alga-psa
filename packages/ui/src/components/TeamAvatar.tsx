import EntityAvatar, { EntityAvatarProps, getDefaultInitials } from './EntityAvatar';

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
  return (
    <EntityAvatar
      entityId={teamId}
      entityName={teamName}
      imageUrl={avatarUrl}
      size={size}
      className={className}
      getInitials={getDefaultInitials}
      altText={`${teamName || 'Team'} avatar`}
    />
  );
};

export default TeamAvatar;
