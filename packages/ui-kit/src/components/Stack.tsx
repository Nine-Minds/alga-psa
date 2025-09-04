import React from 'react';

export type StackProps = React.HTMLAttributes<HTMLDivElement> & {
  direction?: 'row' | 'column';
  gap?: number | string;
  align?: 'stretch' | 'flex-start' | 'center' | 'flex-end' | 'baseline';
  justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly';
};

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
