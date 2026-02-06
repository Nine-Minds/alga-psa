import React from 'react';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const focusStyleId = 'alga-input-focus-styles';

function ensureFocusStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(focusStyleId)) return;

  const style = document.createElement('style');
  style.id = focusStyleId;
  style.textContent = `
    .alga-input:focus {
      outline: none;
      border-color: var(--alga-primary, #9855ee);
      box-shadow: 0 0 0 2px var(--alga-primary-light, #ede2fd);
    }
  `;
  document.head.appendChild(style);
}

const baseStyle: React.CSSProperties = {
  borderRadius: 'var(--alga-radius)',
  border: '1px solid var(--alga-border)',
  background: 'var(--alga-bg)',
  color: 'var(--alga-fg)',
  padding: '8px 10px',
  fontSize: 14,
  lineHeight: '20px',
  outline: 'none',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
};

export function Input({ style, className, ...rest }: InputProps) {
  React.useEffect(() => {
    ensureFocusStyles();
  }, []);

  return (
    <input
      className={`alga-input${className ? ` ${className}` : ''}`}
      style={{ ...baseStyle, ...style }}
      {...rest}
    />
  );
}
