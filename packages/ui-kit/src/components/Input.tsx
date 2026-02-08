import React from 'react';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /** Show error/validation border */
  error?: boolean;
  /** Error message displayed below the input */
  errorMessage?: string;
};

const focusStyleId = 'alga-input-focus-styles';

function ensureFocusStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(focusStyleId)) return;

  const style = document.createElement('style');
  style.id = focusStyleId;
  style.textContent = `
    .alga-input:focus {
      outline: none;
      border-color: transparent;
      box-shadow: 0 0 0 2px var(--alga-primary, #8a4dea);
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

export function Input({ style, className, error, errorMessage, ...rest }: InputProps) {
  React.useEffect(() => {
    ensureFocusStyles();
  }, []);

  const mergedStyle: React.CSSProperties = {
    ...baseStyle,
    ...(error ? { borderColor: 'var(--alga-danger, #dc2626)' } : {}),
    ...style,
  };

  return (
    <div>
      <input
        className={`alga-input${className ? ` ${className}` : ''}`}
        style={mergedStyle}
        {...rest}
      />
      {error && errorMessage && (
        <span style={{ color: 'var(--alga-danger, #dc2626)', fontSize: '12px', marginTop: '4px', display: 'block' }}>
          {errorMessage}
        </span>
      )}
    </div>
  );
}
