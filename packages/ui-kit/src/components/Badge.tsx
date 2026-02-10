import React from 'react';

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  /** Colour scheme of the badge.
   * @default 'default'
   */
  tone?: 'default' | 'info' | 'success' | 'warning' | 'danger';
};

const tones: Record<NonNullable<BadgeProps['tone']>, React.CSSProperties> = {
  default: { background: 'var(--alga-muted, #f3f4f6)', color: 'var(--alga-fg)', borderColor: 'var(--alga-border)' },
  info: { background: 'var(--alga-primary-50, #f0e6fd)', color: 'var(--alga-primary-dark, #6b3dab)', borderColor: 'var(--alga-primary, #8a4dea)' },
  success: { background: '#dcfce7', color: '#166534', borderColor: 'var(--alga-success, #16a34a)' },
  warning: { background: '#fef3c7', color: '#92400e', borderColor: 'var(--alga-warning, #d97706)' },
  danger: { background: '#fef2f2', color: '#991b1b', borderColor: 'var(--alga-danger, #dc2626)' },
};

/** Small pill-shaped label for status indicators and tags. */
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
