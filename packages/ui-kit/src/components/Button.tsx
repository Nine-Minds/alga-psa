import React from 'react';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link' | 'soft' | 'dashed';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon';
};

const baseStyle: React.CSSProperties = {
  borderRadius: 'var(--alga-radius, 8px)',
  border: '1px solid transparent',
  cursor: 'pointer',
  fontWeight: 500,
  fontFamily: 'inherit',
  transition: 'all 0.15s ease',
  outline: 'none',
};

const sizeStyles: Record<NonNullable<ButtonProps['size']>, React.CSSProperties> = {
  xs: { padding: '4px 8px', fontSize: 11, lineHeight: '16px' },
  sm: { padding: '6px 10px', fontSize: 12, lineHeight: '18px' },
  md: { padding: '8px 12px', fontSize: 14, lineHeight: '20px' },
  lg: { padding: '10px 16px', fontSize: 16, lineHeight: '24px' },
  icon: { padding: '6px', fontSize: 14, lineHeight: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
};

const variants: Record<NonNullable<ButtonProps['variant']>, React.CSSProperties> = {
  primary: {
    background: 'var(--alga-primary)',
    color: 'var(--alga-primary-foreground)',
    borderColor: 'transparent',
  },
  secondary: {
    background: 'var(--alga-secondary)',
    color: 'var(--alga-secondary-foreground)',
    borderColor: 'transparent',
  },
  destructive: {
    background: 'var(--alga-accent)',
    color: 'var(--alga-accent-foreground)',
    borderColor: 'transparent',
  },
  outline: {
    background: 'transparent',
    color: 'var(--alga-fg)',
    borderColor: 'var(--alga-border)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--alga-muted-fg)',
    borderColor: 'transparent',
  },
  link: {
    background: 'transparent',
    color: 'var(--alga-primary)',
    borderColor: 'transparent',
    textDecoration: 'underline',
  },
  soft: {
    background: 'var(--alga-primary-soft)',
    color: 'var(--alga-primary-soft-fg)',
    borderColor: 'transparent',
  },
  dashed: {
    background: 'var(--alga-primary-soft)',
    color: 'var(--alga-primary-soft-fg)',
    borderColor: 'var(--alga-primary-border)',
    borderStyle: 'dashed',
  },
};

const hoverStyles: Record<NonNullable<ButtonProps['variant']>, React.CSSProperties> = {
  primary: { filter: 'brightness(0.9)' },
  secondary: { filter: 'brightness(0.9)' },
  destructive: { filter: 'brightness(0.9)' },
  outline: { background: 'var(--alga-primary-soft)', color: 'var(--alga-primary-soft-fg)' },
  ghost: { background: 'var(--alga-primary-soft)', color: 'var(--alga-primary-soft-fg)' },
  link: {},
  soft: { background: 'var(--alga-primary-soft-hover)' },
  dashed: { background: 'var(--alga-primary-soft-hover)' },
};

export function Button({ variant = 'primary', size = 'md', style, disabled, onMouseEnter, onMouseLeave, onFocus, onBlur, ...rest }: ButtonProps) {
  const [hovered, setHovered] = React.useState(false);
  const [focusVisible, setFocusVisible] = React.useState(false);

  const merged: React.CSSProperties = {
    ...baseStyle,
    ...sizeStyles[size],
    ...variants[variant],
    ...(hovered && !disabled ? hoverStyles[variant] : {}),
    ...(focusVisible && !disabled ? { boxShadow: '0 0 0 2px var(--alga-bg, #fff), 0 0 0 4px var(--alga-primary, #8a4dea)' } : {}),
    ...(disabled ? { cursor: 'not-allowed', opacity: 0.5 } : {}),
    ...style,
  };

  return (
    <button
      style={merged}
      disabled={disabled}
      onMouseEnter={(e) => {
        setHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHovered(false);
        onMouseLeave?.(e);
      }}
      onFocus={(e) => {
        // Only show focus ring for keyboard navigation, not mouse clicks
        if (e.target.matches(':focus-visible')) {
          setFocusVisible(true);
        }
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocusVisible(false);
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}
