'use client';

import * as React from 'react';
import { generateEntityColor } from '../lib/colorUtils';
import { cn } from '../lib/utils';
import Spinner from './Spinner';

export type EntityAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
export type ImageLoadingStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface EntityAvatarProps {
  entityId: string | number;
  entityName: string;
  imageUrl: string | null;
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
  const initials = getInitials(entityName || '');
  // Use entityName for color generation for consistency if ID changes or isn't stable
  const fallbackColors = generateEntityColor(entityName || String(entityId));
  const { className: sizeClassName, style: sizeStyle } = getSizeStyle(size);

  // Enhanced image loading state management
  const [imageStatus, setImageStatus] = React.useState<ImageLoadingStatus>(imageUrl ? 'loading' : 'idle');
  const imgRef = React.useRef<HTMLImageElement>(null);

  // Check if image is already cached on mount
  React.useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalHeight !== 0) {
      // Image is already loaded from cache
      setImageStatus('loaded');
    }
  }, []);

  // Reset state when imageUrl changes
  React.useEffect(() => {
    if (imageUrl) {
      // Check if the new image is already cached
      if (imgRef.current?.complete && imgRef.current.naturalHeight !== 0) {
        setImageStatus('loaded');
      } else {
        setImageStatus('loading');
      }
    } else {
      setImageStatus('idle');
    }
  }, [imageUrl]);
  
  const handleImgError = () => {
    setImageStatus('error');
  };

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    // Check if image was loaded from cache (already complete)
    // If so, we can skip the loading state to prevent flicker
    setImageStatus('loaded');
  };

  // Combine classes: base + size + custom
  const combinedClassName = cn(
    'inline-flex items-center justify-center rounded-full overflow-hidden',
    sizeClassName,
    className
  );

  // Determine if we should show the shimmer effect
  const showShimmer = imageStatus === 'loading' && imageUrl;
  
  // Determine if we should show the fallback (initials)
  const showFallback = !imageUrl || imageStatus === 'error';

  return (
    <div className={combinedClassName} style={sizeStyle}>
      {/* Fallback with initials */}
      {showFallback && (
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
      
      {/* Image when available */}
      {imageUrl && imageStatus !== 'error' && (
        <div className="relative h-full w-full">
          {/* Loading shimmer effect */}
          {showShimmer && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 animate-pulse rounded-full overflow-hidden">
              <Spinner size="sm" className="opacity-70 scale-75" />
            </div>
          )}
          
          {/* Actual image with transition */}
          <img
            ref={imgRef}
            src={imageUrl}
            alt={altText || `${entityName || 'Entity'} image`}
            className={cn(
              "h-full w-full object-cover transition-opacity duration-300",
              imageStatus === 'loaded' ? 'opacity-100' : 'opacity-0'
            )}
            onError={handleImgError}
            onLoad={handleImgLoad}
            loading="lazy"
          />
        </div>
      )}
    </div>
  );
};

export default EntityAvatar;
