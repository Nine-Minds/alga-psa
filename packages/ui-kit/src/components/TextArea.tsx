import React, { useRef, useLayoutEffect, useCallback } from 'react';

export type TextAreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> & {
  /** Label text */
  label?: string;
  /** Auto-resize to fit content */
  autoResize?: boolean;
  /** Additional styles */
  style?: React.CSSProperties;
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
  ...props
}: TextAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    ...style,
  };

  return (
    <div style={containerStyle}>
      {label && <label style={labelStyle}>{label}</label>}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        style={textareaStyle}
        {...props}
      />
    </div>
  );
}
