import React from 'react';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
};

const baseStyle: React.CSSProperties = {
  borderRadius: 'var(--alga-radius, 8px)',
  border: '1px solid transparent',
  cursor: 'pointer',
  fontWeight: 500,
  fontFamily: 'inherit',
  transition: 'all 0.15s ease',
};

const sizeStyles: Record<NonNullable<ButtonProps['size']>, React.CSSProperties> = {
  sm: { padding: '6px 10px', fontSize: 12, lineHeight: '18px' },
  md: { padding: '8px 12px', fontSize: 14, lineHeight: '20px' },
  lg: { padding: '10px 16px', fontSize: 16, lineHeight: '24px' },
};

const variants: Record<NonNullable<ButtonProps['variant']>, React.CSSProperties> = {
  primary: {
    background: 'var(--alga-primary)',
    color: 'var(--alga-primary-foreground)',
    borderColor: 'transparent',
  },
  secondary: {
    background: 'var(--alga-muted)',
    color: 'var(--alga-fg)',
    borderColor: 'var(--alga-border)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--alga-muted-fg)',
    borderColor: 'transparent',
  },
  danger: {
    background: 'var(--alga-danger)',
    color: '#fff',
    borderColor: 'transparent',
  },
};

export function Button({ variant = 'primary', size = 'md', style, ...rest }: ButtonProps) {
  const merged: React.CSSProperties = { ...baseStyle, ...sizeStyles[size], ...variants[variant], ...style };
  return <button style={merged} {...rest} />;
}
