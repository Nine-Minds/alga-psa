import React from 'react';

type Tone = 'info' | 'success' | 'warning' | 'danger';
export type AlertProps = React.HTMLAttributes<HTMLDivElement> & { tone?: Tone };

const toneBorder: Record<Tone, string> = {
  info: 'var(--alga-primary, #9855ee)',
  success: 'var(--alga-success, #16a34a)',
  warning: 'var(--alga-warning, #d97706)',
  danger: 'var(--alga-danger, #dc2626)',
};

const toneBg: Record<Tone, string> = {
  info: 'var(--alga-primary-soft, #f6f0fe)',
  success: '#f0fdf4',
  warning: '#fffbeb',
  danger: '#fef2f2',
};

const toneFg: Record<Tone, string> = {
  info: 'var(--alga-primary-soft-fg, #6e3dbb)',
  success: '#166534',
  warning: '#92400e',
  danger: '#991b1b',
};

export function Alert({ tone = 'info', style, ...rest }: AlertProps) {
  const merged: React.CSSProperties = {
    background: toneBg[tone],
    color: toneFg[tone],
    border: 'none',
    borderLeft: `4px solid ${toneBorder[tone]}`,
    borderRadius: 'var(--alga-radius)',
    padding: '12px 16px',
    fontSize: '14px',
    lineHeight: '1.5',
    ...style,
  };
  return <div role="alert" style={merged} {...rest} />;
}
