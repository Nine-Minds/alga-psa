import React from 'react';

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'default' | 'success' | 'warning' | 'danger';
};

const tones: Record<NonNullable<BadgeProps['tone']>, React.CSSProperties> = {
  default: { background: 'var(--alga-muted)', color: 'var(--alga-fg)', borderColor: 'var(--alga-border)' },
  success: { background: 'color-mix(in oklab, var(--alga-success) 15%, white)', color: 'var(--alga-fg)', borderColor: 'var(--alga-success)' },
  warning: { background: 'color-mix(in oklab, var(--alga-warning) 15%, white)', color: 'var(--alga-fg)', borderColor: 'var(--alga-warning)' },
  danger: { background: 'color-mix(in oklab, var(--alga-danger) 15%, white)', color: 'var(--alga-fg)', borderColor: 'var(--alga-danger)' },
};

export function Badge({ tone = 'default', style, ...rest }: BadgeProps) {
  const merged: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 8px',
    fontSize: 12,
    lineHeight: '18px',
    border: '1px solid',
    borderRadius: '999px',
    fontWeight: 500,
    ...tones[tone],
    ...style,
  };
  return <span style={merged} {...rest} />;
}
