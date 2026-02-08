import React, { useRef, useLayoutEffect, useCallback, useEffect } from 'react';

const focusStyleId = 'alga-textarea-focus-styles';

function ensureFocusStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(focusStyleId)) return;

  const style = document.createElement('style');
  style.id = focusStyleId;
  style.textContent = `
    .alga-textarea:focus {
      outline: none;
      border-color: transparent;
      box-shadow: 0 0 0 2px var(--alga-primary, #8a4dea);
    }
  `;
  document.head.appendChild(style);
}

export type TextAreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> & {
  /** Label text */
  label?: string;
  /** Auto-resize to fit content */
  autoResize?: boolean;
  /** Additional styles */
  style?: React.CSSProperties;
  /** Show error/validation border */
  error?: boolean;
  /** Error message displayed below the textarea */
  errorMessage?: string;
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--alga-fg, #374151)',
};

const baseTextAreaStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: '14px',
  lineHeight: 1.5,
  color: 'var(--alga-fg, #111)',
  backgroundColor: 'var(--alga-bg, #fff)',
  border: '1px solid var(--alga-border, #e5e7eb)',
  borderRadius: 'var(--alga-radius, 6px)',
  outline: 'none',
  resize: 'vertical',
  minHeight: '80px',
  fontFamily: 'inherit',
};

export function TextArea({
  label,
  autoResize = false,
  style,
  value,
  onChange,
  disabled,
  className,
  error,
  errorMessage,
  ...props
}: TextAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ensureFocusStyles();
  }, []);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !autoResize) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [autoResize]);

  useLayoutEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (autoResize) {
      adjustHeight();
    }
    onChange?.(e);
  };

  const textareaStyle: React.CSSProperties = {
    ...baseTextAreaStyle,
    resize: autoResize ? 'none' : 'vertical',
    overflow: autoResize ? 'hidden' : 'auto',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'text',
    ...(error ? { borderColor: 'var(--alga-danger, #dc2626)' } : {}),
    ...style,
  };

  return (
    <div style={containerStyle}>
      {label && <label style={labelStyle}>{label}</label>}
      <textarea
        ref={textareaRef}
        className={`alga-textarea${className ? ` ${className}` : ''}`}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        style={textareaStyle}
        {...props}
      />
      {error && errorMessage && (
        <span style={{ color: 'var(--alga-danger, #dc2626)', fontSize: '12px', marginTop: '4px', display: 'block' }}>
          {errorMessage}
        </span>
      )}
    </div>
  );
}
