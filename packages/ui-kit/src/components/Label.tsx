import React from 'react';

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement> & {
  /** Whether the associated field is required */
  required?: boolean;
  /** Whether the label should appear disabled */
  disabled?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
};

const sizes = {
  sm: { fontSize: '12px' },
  md: { fontSize: '14px' },
  lg: { fontSize: '16px' },
};

export function Label({
  children,
  required,
  disabled,
  size = 'md',
  style,
  ...props
}: LabelProps) {
  const labelStyle: React.CSSProperties = {
    display: 'inline-block',
    fontSize: sizes[size].fontSize,
    fontWeight: 500,
    color: disabled ? 'var(--alga-muted-fg, #6b7280)' : 'var(--alga-fg, #374151)',
    cursor: disabled ? 'not-allowed' : 'default',
    ...style,
  };

  const requiredStyle: React.CSSProperties = {
    color: 'var(--alga-danger, #dc2626)',
    marginLeft: '4px',
  };

  return (
    <label style={labelStyle} {...props}>
      {children}
      {required && <span style={requiredStyle}>*</span>}
    </label>
  );
}
