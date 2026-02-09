import React from 'react';

export type StackProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Flex direction.
   * @default 'column'
   */
  direction?: 'row' | 'column';
  /** Gap between children. Numbers are treated as pixels.
   * @default 8
   */
  gap?: number | string;
  /** Cross-axis alignment (`align-items`). */
  align?: 'stretch' | 'flex-start' | 'center' | 'flex-end' | 'baseline';
  /** Main-axis alignment (`justify-content`). */
  justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly';
};

/** Flexbox layout helper for stacking children with consistent spacing. */
export function Stack({ direction = 'column', gap = 8, align, justify, style, ...rest }: StackProps) {
  const merged: React.CSSProperties = {
    display: 'flex',
    flexDirection: direction,
    gap: typeof gap === 'number' ? `${gap}px` : gap,
    alignItems: align,
    justifyContent: justify,
    ...style,
  } as React.CSSProperties;
  return <div style={merged} {...rest} />;
}
