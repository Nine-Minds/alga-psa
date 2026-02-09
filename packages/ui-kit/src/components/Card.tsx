import React from 'react';

/** Props for the {@link Card} component. Extends standard `<div>` attributes. */
export type CardProps = React.HTMLAttributes<HTMLDivElement>;

const baseStyle: React.CSSProperties = {
  background: 'var(--alga-bg)',
  color: 'var(--alga-fg)',
  border: '1px solid var(--alga-border)',
  borderRadius: 'var(--alga-radius)',
  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
  padding: 16,
};

/** Bordered container with background, shadow, and rounded corners. */
export function Card({ style, ...rest }: CardProps) {
  return <div style={{ ...baseStyle, ...style }} {...rest} />;
}
