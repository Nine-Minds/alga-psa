'use client';

import React, { useMemo } from 'react';
import { generateAvatarColor } from '../lib/colorUtils';

interface AvatarIconProps {
  userId: string;
  firstName: string;
  lastName: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const AvatarIcon = ({ userId, firstName, lastName, size = 'md' }: AvatarIconProps) => {
  const getInitial = () => {
    if (firstName) {
      return firstName.charAt(0).toUpperCase();
    }
    return '?';
  };

  // Generate consistent colors based on userId
  const avatarColors = useMemo(() => {
    // Provide a default/fallback color if userId is missing, though it shouldn't happen in practice
    return generateAvatarColor(userId || 'default');
  }, [userId]);

  const sizeClasses = {
    xs: 'w-4 h-4 text-xs',
    sm: 'w-6 h-6 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
  };

  return (
    <div
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center text-white font-bold`}
      style={{ backgroundColor: avatarColors.background }}
    >
      {getInitial()}
    </div>
  );
};

export default AvatarIcon;
