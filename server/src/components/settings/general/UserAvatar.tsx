import * as React from 'react';
import { generateEntityColor } from 'server/src/utils/colorUtils';
import { cn } from 'server/src/lib/utils';

interface UserAvatarProps {
  userId: string;
  userName: string;
  avatarUrl: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
  className?: string;
}

// Helper function to get initials
const getInitials = (name: string): string => {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    // Take first two letters if single word is long enough, otherwise just the first
    return words[0].length > 1 ? words[0].substring(0, 2).toUpperCase() : words[0].charAt(0).toUpperCase();
  }
  // Take first letter of first and last word
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
};

// Helper function to map size prop to Tailwind classes or style object
const getSizeStyle = (size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number): { className: string; style: React.CSSProperties } => {
  const style: React.CSSProperties = {};
  let className = '';

  if (typeof size === 'number') {
    // Using style for arbitrary pixel values
    style.height = `${size}px`;
    style.width = `${size}px`;
    // Estimate font size based on avatar size, adjust as needed
    style.fontSize = `${Math.max(10, Math.round(size * 0.4))}px`;
  } else {
    // Using classes for predefined sizes
    switch (size) {
      case 'xs':
        className = 'h-6 w-6 text-xs';
        break;
      case 'sm':
        className = 'h-8 w-8 text-xs';
        break;
      case 'lg':
        className = 'h-12 w-12 text-base';
        break;
      case 'xl':
        className = 'h-16 w-16 text-xl';
        break;
      case 'md':
      default:
        className = 'h-10 w-10 text-sm';
        break;
    }
  }
  return { className, style };
};

const UserAvatar: React.FC<UserAvatarProps> = ({
  userId,
  userName,
  avatarUrl,
  size = 'md',
  className,
}) => {
  const initials = getInitials(userName || '');
  // Use userName for color generation for consistency if ID changes or isn't stable
  const fallbackColors = generateEntityColor(userName || String(userId));
  const { className: sizeClassName, style: sizeStyle } = getSizeStyle(size);

  // Handle image load error
  const [imgError, setImgError] = React.useState(false);
  const handleImgError = () => setImgError(true);

  // Combine classes: base + size + custom
  const combinedClassName = cn(
    'inline-flex items-center justify-center rounded-full overflow-hidden', // Base styles
    sizeClassName, // Size class
    className // Custom classes passed via props
  );

  return (
    <div className={combinedClassName} style={sizeStyle}>
      {avatarUrl && !imgError ? (
        <img
          src={avatarUrl}
          alt={`${userName || 'User'} avatar`}
          className="h-full w-full object-cover"
          onError={handleImgError}
        />
      ) : (
        <div
          style={{
            backgroundColor: fallbackColors.background,
            color: fallbackColors.text,
            fontSize: sizeStyle.fontSize,
          }}
          className={cn(
            'flex h-full w-full items-center justify-center font-semibold',
            sizeClassName
          )}
        >
          {initials}
        </div>
      )}
    </div>
  );
};

export default UserAvatar;