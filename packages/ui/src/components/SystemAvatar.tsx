'use client';

import * as React from 'react';
import { Cog, Layers } from 'lucide-react';
import { getSizeStyle, type EntityAvatarSize } from './EntityAvatar';
import { cn } from '../lib/utils';

export type SystemAvatarGlyph = 'system' | 'bundle';

export interface SystemAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  glyph?: SystemAvatarGlyph;
  label: string;
  size?: EntityAvatarSize;
  className?: string;
}

const GLYPHS = {
  system: Cog,
  bundle: Layers,
} as const;

const SystemAvatar = ({
  glyph = 'system',
  label,
  size = 'md',
  className,
  ...rest
}: SystemAvatarProps) => {
  const { className: sizeClassName, style: sizeStyle } = getSizeStyle(size);
  const isSquare = size === 'xs' || (typeof size === 'number' && size <= 24);
  const radiusClass = isSquare ? 'rounded-md' : 'rounded-full';
  const Glyph = GLYPHS[glyph];

  return (
    <div
      {...rest}
      role="img"
      aria-label={label}
      data-avatar-kind={glyph}
      style={sizeStyle}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        radiusClass,
        sizeClassName,
        'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-500))]',
        className
      )}
    >
      <Glyph className="h-1/2 w-1/2" aria-hidden="true" />
    </div>
  );
};

export default SystemAvatar;
