import React from 'react';

export interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical';
  style?: React.CSSProperties;
}

export function Separator({ orientation = 'horizontal', style }: SeparatorProps) {
  const baseStyle: React.CSSProperties =
    orientation === 'horizontal'
      ? {
          height: 1,
          width: '100%',
          background: 'var(--alga-border)',
        }
      : {
          height: '100%',
          width: 1,
          background: 'var(--alga-border)',
        };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      style={{ ...baseStyle, ...style }}
    />
  );
}
