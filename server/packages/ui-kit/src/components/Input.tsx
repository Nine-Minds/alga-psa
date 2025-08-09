import React from 'react';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const baseStyle: React.CSSProperties = {
  borderRadius: 'var(--alga-radius)',
  border: '1px solid var(--alga-border)',
  background: 'var(--alga-bg)',
  color: 'var(--alga-fg)',
  padding: '8px 10px',
  fontSize: 14,
  lineHeight: '20px',
};

export function Input({ style, ...rest }: InputProps) {
  return <input style={{ ...baseStyle, ...style }} {...rest} />;
}
