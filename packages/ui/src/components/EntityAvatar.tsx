'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { generateEntityColor, adaptColorsForDarkMode } from '../lib/colorUtils';
import { cn } from '../lib/utils';

export type EntityAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
export type ImageLoadingStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface EntityAvatarProps {
  entityId: string | number;
  entityName: string;
  imageUrl: string | null;
  /**
   * Shape follows size automatically: `xs` renders as a rounded square,
   * `sm` and larger render as a circle. There is no shape override — this is
   * the single avatar shape rule across the app.
   */
  size?: EntityAvatarSize;
  className?: string;
  getInitials?: (name: string) => string;
  altText?: string;
}

// Default helper function to get initials
export const getDefaultInitials = (name: string): string => {
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
export const getSizeStyle = (size?: EntityAvatarSize): { className: string; style: React.CSSProperties } => {
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

export const EntityAvatar = ({
  entityId,
  entityName,
  imageUrl,
  size = 'md',
  className,
  getInitials = getDefaultInitials,
  altText,
}: EntityAvatarProps) => {
  const { resolvedTheme } = useTheme();
  // Track mount state to avoid hydration mismatch - useTheme returns undefined on server
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);
  const isDark = mounted && resolvedTheme === 'dark';

  const initials = getInitials(entityName || '');
  // Use entityName for color generation for consistency if ID changes or isn't stable
  const fallbackColors = React.useMemo(() => {
    const raw = generateEntityColor(entityName || String(entityId));
    return isDark ? adaptColorsForDarkMode(raw) : raw;
  }, [entityName, entityId, isDark]);
  const { className: sizeClassName, style: sizeStyle } = getSizeStyle(size);

  // Enhanced image loading state management
  const [imageStatus, setImageStatus] = React.useState<ImageLoadingStatus>(imageUrl ? 'loading' : 'idle');
  const imgRef = React.useRef<HTMLImageElement>(null);

  // A request that finished before React attached load/error (server-rendered
  // markup, a warm cache, a remount) never fires either handler, so read the
  // outcome straight off the element instead of waiting forever.
  const syncStatusFromElement = React.useCallback(() => {
    const img = imgRef.current;
    if (!img?.complete || !img.getAttribute('src')) return;
    setImageStatus(img.naturalWidth === 0 ? 'error' : 'loaded');
  }, []);

  // Check if image is already resolved on mount
  React.useEffect(() => {
    syncStatusFromElement();
  }, [syncStatusFromElement]);

  // Reset state when imageUrl changes
  React.useEffect(() => {
    if (imageUrl) {
      setImageStatus('loading');
      syncStatusFromElement();
    } else {
      setImageStatus('idle');
    }
  }, [imageUrl, syncStatusFromElement]);

  const handleImgError = () => {
    setImageStatus('error');
  };

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    // Check if image was loaded from cache (already complete)
    // If so, we can skip the loading state to prevent flicker
    setImageStatus('loaded');
  };

  // Shape is derived from size, never from entity type: the smallest avatars
  // (xs, or any pixel size at/below the xs 24px footprint) render as rounded
  // squares — a tight circle clips the corners of two-letter initials — and
  // everything sm and larger renders as a circle. One rule for every entity.
  const isSquare = size === 'xs' || (typeof size === 'number' && size <= 24);
  const radiusClass = isSquare ? 'rounded-md' : 'rounded-full';

  // Combine classes: base + size + custom. shrink-0 keeps the avatar a fixed
  // square in flex rows (e.g. next to a long client name) instead of letting the
  // layout compress it into a clipped, off-aspect-ratio oval.
  const combinedClassName = cn(
    'inline-flex shrink-0 items-center justify-center overflow-hidden',
    radiusClass,
    sizeClassName,
    className
  );

  const showImage = Boolean(imageUrl) && imageStatus !== 'error';

  // Initials are the placeholder, not a spinner: an avatar whose file is slow,
  // missing or forbidden still has to say who it belongs to. They stay mounted
  // underneath until the image has actually painted.
  const showFallback = !showImage || imageStatus !== 'loaded';

  return (
    <div className={combinedClassName} style={sizeStyle}>
      <div className="relative h-full w-full">
        {/* Fallback with initials */}
        {showFallback && (
          <div
            style={{
              backgroundColor: fallbackColors.background,
              color: fallbackColors.text,
              fontSize: sizeStyle.fontSize,
            }}
            className={cn(
              'absolute inset-0 flex h-full w-full items-center justify-center font-semibold',
              sizeClassName
            )}
          >
            {initials}
          </div>
        )}

        {/* Image when available */}
        {showImage && (
          <img
            ref={imgRef}
            src={imageUrl!}
            alt={altText || `${entityName || 'Entity'} image`}
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-300',
              imageStatus === 'loaded' ? 'opacity-100' : 'opacity-0'
            )}
            onError={handleImgError}
            onLoad={handleImgLoad}
            loading="lazy"
          />
        )}
      </div>
    </div>
  );
};

export default EntityAvatar;
