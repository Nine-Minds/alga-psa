import React from 'react';

export type SkeletonProps = {
  /** Width of the skeleton */
  width?: string | number;
  /** Height of the skeleton */
  height?: string | number;
  /** Border radius */
  borderRadius?: string | number;
  /** Variant type */
  variant?: 'text' | 'circular' | 'rectangular';
  /** Animation type */
  animation?: 'pulse' | 'wave' | 'none';
  /** Additional styles */
  style?: React.CSSProperties;
  /** Number of lines (for text variant) */
  lines?: number;
};

const baseStyle: React.CSSProperties = {
  backgroundColor: 'var(--alga-muted, #e5e7eb)',
  display: 'block',
};

const pulseKeyframes = `
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
`;

const waveKeyframes = `
@keyframes skeleton-wave {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
`;

// Inject keyframes once
if (typeof document !== 'undefined') {
  const styleId = 'alga-skeleton-keyframes';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = pulseKeyframes + waveKeyframes;
    document.head.appendChild(style);
  }
}

export function Skeleton({
  width,
  height,
  borderRadius,
  variant = 'text',
  animation = 'pulse',
  style,
  lines = 1,
}: SkeletonProps) {
  const getVariantStyles = (): React.CSSProperties => {
    switch (variant) {
      case 'circular':
        return {
          borderRadius: '50%',
          width: width || 40,
          height: height || 40,
        };
      case 'rectangular':
        return {
          borderRadius: borderRadius || 'var(--alga-radius, 4px)',
          width: width || '100%',
          height: height || 100,
        };
      case 'text':
      default:
        return {
          borderRadius: borderRadius || 'var(--alga-radius, 4px)',
          width: width || '100%',
          height: height || '1em',
        };
    }
  };

  const getAnimationStyle = (): React.CSSProperties => {
    switch (animation) {
      case 'pulse':
        return {
          animation: 'skeleton-pulse 1.5s ease-in-out infinite',
        };
      case 'wave':
        return {
          position: 'relative',
          overflow: 'hidden',
        };
      case 'none':
      default:
        return {};
    }
  };

  const renderSkeleton = (key?: number) => {
    const skeletonStyle: React.CSSProperties = {
      ...baseStyle,
      ...getVariantStyles(),
      ...getAnimationStyle(),
      ...style,
    };

    if (animation === 'wave') {
      return (
        <span
          key={key}
          style={{
            ...skeletonStyle,
            display: 'block',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background:
                'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent)',
              animation: 'skeleton-wave 1.5s ease-in-out infinite',
            }}
          />
        </span>
      );
    }

    return <span key={key} style={skeletonStyle} />;
  };

  if (variant === 'text' && lines > 1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {Array.from({ length: lines }).map((_, i) =>
          renderSkeleton(i)
        )}
      </div>
    );
  }

  return renderSkeleton();
}

// Convenience components
export function SkeletonText({ lines = 3, ...props }: Omit<SkeletonProps, 'variant'>) {
  return <Skeleton variant="text" lines={lines} {...props} />;
}

export function SkeletonCircle(props: Omit<SkeletonProps, 'variant'>) {
  return <Skeleton variant="circular" {...props} />;
}

export function SkeletonRectangle(props: Omit<SkeletonProps, 'variant'>) {
  return <Skeleton variant="rectangular" {...props} />;
}
