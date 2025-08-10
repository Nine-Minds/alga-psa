import React from 'react';

type Tone = 'info' | 'success' | 'warning' | 'danger';
export type AlertProps = React.HTMLAttributes<HTMLDivElement> & { tone?: Tone };

const toneBg: Record<Tone, string> = {
  info: 'var(--alga-muted)',
  success: 'color-mix(in oklab, var(--alga-success) 15%, white)',
  warning: 'color-mix(in oklab, var(--alga-warning) 15%, white)',
  danger: 'color-mix(in oklab, var(--alga-danger) 15%, white)',
};
const toneFg: Record<Tone, string> = {
  info: 'var(--alga-fg)',
  success: 'var(--alga-fg)',
  warning: 'var(--alga-fg)',
  danger: 'var(--alga-fg)',
};

export function Alert({ tone = 'info', style, ...rest }: AlertProps) {
  const merged: React.CSSProperties = {
    background: toneBg[tone],
    color: toneFg[tone],
    border: '1px solid var(--alga-border)',
    borderRadius: 'var(--alga-radius)',
    padding: 12,
    ...style,
  };
  return <div role="alert" style={merged} {...rest} />;
}
