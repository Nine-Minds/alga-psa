import React from 'react';

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

const baseStyle: React.CSSProperties = {
  background: 'var(--alga-bg)',
  color: 'var(--alga-fg)',
  border: '1px solid var(--alga-border)',
  borderRadius: 'var(--alga-radius)',
  padding: 16,
};

export function Card({ style, ...rest }: CardProps) {
  return <div style={{ ...baseStyle, ...style }} {...rest} />;
}
